//! SQLite persistence adapter.
//!
//! Implements the [`VaultRepository`] port against a local SQLite database and
//! owns the vault schema:
//!
//! - `vault_metadata` — singleton row (id = 1) holding the random salt and the
//!   validation record (a nonce + ciphertext) used to authenticate the master
//!   password at unlock without ever storing the password itself.
//! - `entries` — one row per vault record: plaintext indexable metadata
//!   (site, link, category, email, username) plus the password as
//!   nonce + ciphertext. The 16-byte record ID is stored verbatim so the
//!   crypto layer can use it as AES-256-GCM AAD on every decrypt.
//!
//! Guarantees:
//! - metadata stays queryable; the password is never written in plaintext;
//! - `save` upserts atomically and `delete` reports [`RepositoryError::NotFound`];
//! - filters (site search, category, email) combine conjunctively in SQL;
//! - the connection is `!Sync` and never shared: every mutating operation runs
//!   inside a private transaction, so PR 3 can wrap this adapter in a `Mutex`.

use std::path::{Path, PathBuf};

use rusqlite::types::ToSql;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::core::domain::entry::{EncryptedField, EntryRecord, Filters, RecordId};
use crate::core::ports::vault_repository::{RepositoryError, VaultRepository};

/// Bumped whenever the schema changes; stored in `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 1;

/// Schema v1: vault metadata singleton + encrypted entries.
const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS vault_metadata (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    salt                    BLOB NOT NULL,
    validation_nonce        BLOB NOT NULL,
    validation_ciphertext   BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
    id                      BLOB PRIMARY KEY NOT NULL,
    site                    TEXT NOT NULL,
    link                    TEXT NOT NULL,
    category                TEXT NOT NULL,
    email                   TEXT NOT NULL,
    username                TEXT NOT NULL,
    password_nonce          BLOB NOT NULL,
    password_ciphertext     BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
CREATE INDEX IF NOT EXISTS idx_entries_email ON entries(email);
";

/// Vault initialization data: the salt and the authenticated validation record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultMetadata {
    /// Random salt (>= 16 bytes) used to derive the vault key with Argon2id.
    pub salt: Vec<u8>,
    /// Validation value encrypted under the derived key; decrypting it proves
    /// the master password is correct without persisting the password.
    pub validation: EncryptedField,
}

/// SQLite-backed [`VaultRepository`].
///
/// `rusqlite::Connection` provides interior mutability, so all port methods
/// take `&self` while remaining single-threaded. The adapter is `Send` but not
/// `Sync`; the Tauri command layer (PR 3) will guard it with a `Mutex`.
pub struct SqliteVaultRepository {
    conn: Connection,
    /// The database file this repository was opened from, when file-backed.
    /// In-memory repositories have no file and cannot be exported.
    path: Option<PathBuf>,
}

impl SqliteVaultRepository {
    /// Open (creating if needed) the vault database at `path`, applying
    /// migrations. The parent directory must exist.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RepositoryError> {
        let path = path.as_ref().to_path_buf();
        let conn = Connection::open(&path).map_err(store_err)?;
        let repo = Self::from_conn(conn)?;
        Ok(Self {
            conn: repo.conn,
            path: Some(path),
        })
    }

    /// Open an ephemeral in-memory vault (used by tests).
    pub fn open_in_memory() -> Result<Self, RepositoryError> {
        let repo = Self::from_conn(Connection::open_in_memory().map_err(store_err)?)?;
        Ok(Self {
            conn: repo.conn,
            path: None,
        })
    }

    fn from_conn(conn: Connection) -> Result<Self, RepositoryError> {
        // WAL + FULL synchronous keeps committed transactions durable on a
        // desktop app while allowing the future backup command to read safely.
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;")
            .map_err(store_err)?;
        migrate(&conn)?;
        Ok(Self { conn, path: None })
    }

    /// Store (or replace) the vault initialization metadata: a random salt and
    /// the authenticated validation record. Re-initializing with a new salt
    /// invalidates previously derived keys, so callers must only do so for a
    /// fresh vault.
    pub fn init_vault(
        &self,
        salt: Vec<u8>,
        validation: &EncryptedField,
    ) -> Result<(), RepositoryError> {
        if salt.len() < 16 {
            return Err(RepositoryError::Store(
                "vault salt must be at least 16 bytes".into(),
            ));
        }
        let tx = self.conn.unchecked_transaction().map_err(store_err)?;
        tx.execute(
            "INSERT INTO vault_metadata (id, salt, validation_nonce, validation_ciphertext)
             VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                 salt = excluded.salt,
                 validation_nonce = excluded.validation_nonce,
                 validation_ciphertext = excluded.validation_ciphertext",
            params![salt, validation.nonce, validation.ciphertext],
        )
        .map_err(store_err)?;
        tx.commit().map_err(store_err)
    }

    /// Read the vault initialization metadata, or `None` when the vault has
    /// not been initialized yet.
    pub fn vault_metadata(&self) -> Result<Option<VaultMetadata>, RepositoryError> {
        let row = self
            .conn
            .query_row(
                "SELECT salt, validation_nonce, validation_ciphertext
                 FROM vault_metadata WHERE id = 1",
                [],
                |r| {
                    Ok(VaultMetadata {
                        salt: r.get(0)?,
                        validation: EncryptedField {
                            nonce: r.get(1)?,
                            ciphertext: r.get(2)?,
                        },
                    })
                },
            )
            .optional()
            .map_err(store_err)?;
        Ok(row)
    }

    /// True once [`SqliteVaultRepository::init_vault`] has been called.
    pub fn is_initialized(&self) -> Result<bool, RepositoryError> {
        Ok(self.vault_metadata()?.is_some())
    }

    /// The database file this repository was opened from, or `None` for
    /// in-memory repositories (which cannot be exported to a native backup).
    pub fn db_path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Force a WAL checkpoint so every committed transaction is present in the
    /// main database file. Required before copying the file as a backup:
    /// without it, recent writes could still live only in the `-wal` file.
    pub fn checkpoint(&self) -> Result<(), RepositoryError> {
        self.conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(store_err)?;
        Ok(())
    }

    fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntryRecord> {
        let id_bytes: Vec<u8> = row.get("id")?;
        let id: [u8; 16] = id_bytes.try_into().map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Blob,
                Box::new(RecordIdLengthError),
            )
        })?;
        Ok(EntryRecord {
            id: RecordId(id),
            site: row.get("site")?,
            link: row.get("link")?,
            category: row.get("category")?,
            email: row.get("email")?,
            username: row.get("username")?,
            password: EncryptedField {
                nonce: row.get("password_nonce")?,
                ciphertext: row.get("password_ciphertext")?,
            },
        })
    }
}

/// Marker error for a stored record ID that is not exactly 16 bytes.
#[derive(Debug)]
struct RecordIdLengthError;

impl std::fmt::Display for RecordIdLengthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "stored record id is not 16 bytes")
    }
}

impl std::error::Error for RecordIdLengthError {}

impl VaultRepository for SqliteVaultRepository {
    fn list(&self, filters: &Filters) -> Result<Vec<EntryRecord>, RepositoryError> {
        let mut sql = String::from(
            "SELECT id, site, link, category, email, username, password_nonce, password_ciphertext
             FROM entries",
        );
        let mut clauses: Vec<&str> = Vec::new();
        let mut params: Vec<&dyn ToSql> = Vec::new();
        // Site search is a substring match (SQL LIKE, case-insensitive for
        // ASCII); category and email filters are exact equality matches.
        if let Some(site) = &filters.site {
            clauses.push("site LIKE '%' || ? || '%'");
            params.push(site);
        }
        if let Some(category) = &filters.category {
            clauses.push("category = ?");
            params.push(category);
        }
        if let Some(email) = &filters.email {
            clauses.push("email = ?");
            params.push(email);
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY site, username");

        let mut stmt = self.conn.prepare(&sql).map_err(store_err)?;
        let rows = stmt
            .query_map(params_from_iter(params), Self::row_to_entry)
            .map_err(store_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(store_err)
    }

    fn save(&self, entry: &EntryRecord) -> Result<(), RepositoryError> {
        let tx = self.conn.unchecked_transaction().map_err(store_err)?;
        tx.execute(
            "INSERT INTO entries
                 (id, site, link, category, email, username, password_nonce, password_ciphertext)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                 site = excluded.site,
                 link = excluded.link,
                 category = excluded.category,
                 email = excluded.email,
                 username = excluded.username,
                 password_nonce = excluded.password_nonce,
                 password_ciphertext = excluded.password_ciphertext",
            params![
                entry.id.as_bytes().as_slice(),
                entry.site,
                entry.link,
                entry.category,
                entry.email,
                entry.username,
                entry.password.nonce,
                entry.password.ciphertext,
            ],
        )
        .map_err(store_err)?;
        tx.commit().map_err(store_err)
    }

    fn delete(&self, id: &RecordId) -> Result<(), RepositoryError> {
        let tx = self.conn.unchecked_transaction().map_err(store_err)?;
        let removed = tx
            .execute(
                "DELETE FROM entries WHERE id = ?",
                params![id.as_bytes().as_slice()],
            )
            .map_err(store_err)?;
        if removed == 0 {
            // Dropping the transaction rolls back (a no-op here), keeping the
            // delete atomic and signalling the missing record.
            return Err(RepositoryError::NotFound);
        }
        tx.commit().map_err(store_err)
    }
}

/// Apply pending migrations, tracked by `PRAGMA user_version`.
fn migrate(conn: &Connection) -> Result<(), RepositoryError> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(store_err)?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1).map_err(store_err)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(store_err)?;
    }
    Ok(())
}

/// Wrap a `rusqlite` error as a secret-free repository error.
fn store_err(e: rusqlite::Error) -> RepositoryError {
    RepositoryError::Store(e.to_string())
}
