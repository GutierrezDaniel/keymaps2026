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
//! - `categories` (schema v2) — one row per user-managed category: a unique
//!   name (primary key, no foreign key by design) plus its palette color.
//!   Pre-v2 vaults are migrated and seeded with the four current categories
//!   (`ON CONFLICT DO NOTHING`, so reruns preserve custom values).
//!
//! Guarantees:
//! - metadata stays queryable; the password is never written in plaintext;
//! - `save` upserts atomically and `delete` reports [`RepositoryError::NotFound`];
//! - filters (site search, category, email) combine conjunctively in SQL;
//! - the connection is `!Sync` and never shared: every mutating operation runs
//!   inside a private transaction, so PR 3 can wrap this adapter in a `Mutex`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::types::ToSql;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::core::domain::entry::{
    seed_categories, Category, EncryptedField, EntryRecord, Filters, RecordId,
};
use crate::core::ports::vault_import_storage::{ImportStorageError, VaultImportStorage};
use crate::core::ports::vault_repository::{RepositoryError, VaultRepository};

/// Bumped whenever the schema changes; stored in `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 2;

/// Minimum salt length accepted for an initialized vault (matches the
/// `init_vault` guard).
const MIN_SALT_LEN: usize = 16;
/// AES-256-GCM nonce length used by the crypto adapter (the standard 96-bit
/// nonce).
const GCM_NONCE_LEN: usize = 12;
/// AES-256-GCM authentication tag length appended to ciphertext.
const GCM_TAG_LEN: usize = 16;

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

/// Schema v2: user-managed categories with unique names and palette colors.
/// No foreign key on `entries.category` (design decision): the service guards
/// references, and SQLite owns atomic persistence.
const SCHEMA_V2: &str = "
CREATE TABLE IF NOT EXISTS categories (
    name    TEXT PRIMARY KEY NOT NULL,
    color   TEXT NOT NULL
);
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

    /// Read-only validation of a candidate vault backup (vault-import
    /// "Validate before replacement").
    ///
    /// The candidate is opened normally — a plain read-only open cannot read a
    /// WAL vault without its `-shm` file — and immediately switched to
    /// `PRAGMA query_only`, so this connection can never write, migrate, or
    /// checkpoint the file. Only schema, metadata, and length checks run:
    /// the vault's own tables must exist (`vault_metadata`, `entries`,
    /// `categories`), the initialization singleton must carry a salt of at
    /// least 16 bytes, and the validation field must use valid AEAD lengths
    /// (12-byte nonce, ciphertext at least the 16-byte GCM tag). A backup
    /// produced by this app is a post-checkpoint copy of a v2 vault, so all
    /// three tables must be present.
    pub fn validate_backup(source: impl AsRef<Path>) -> Result<(), ImportStorageError> {
        // Open without SQLITE_OPEN_CREATE: a missing candidate must fail, and
        // validation must never create files. A normal read-write open (rather
        // than a read-only one) lets WAL candidates be read without a
        // pre-existing `-shm` file.
        let conn = Connection::open_with_flags(
            source.as_ref(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        )
        .map_err(map_import_err)?;
        conn.pragma_update(None, "query_only", true)
            .map_err(import_store_err)?;
        for table in ["vault_metadata", "entries", "categories"] {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    params![table],
                    |r| r.get(0),
                )
                .map_err(import_store_err)?;
            if !exists {
                return Err(ImportStorageError::InvalidVault);
            }
        }
        let row: Option<(Vec<u8>, Vec<u8>, Vec<u8>)> = conn
            .query_row(
                "SELECT salt, validation_nonce, validation_ciphertext
                 FROM vault_metadata WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(import_store_err)?;
        let (salt, nonce, ciphertext) = row.ok_or(ImportStorageError::InvalidVault)?;
        if salt.len() < MIN_SALT_LEN
            || nonce.len() != GCM_NONCE_LEN
            || ciphertext.len() < GCM_TAG_LEN
        {
            return Err(ImportStorageError::InvalidVault);
        }
        Ok(())
    }

    /// Atomically replace the vault database with `source` (vault-import
    /// "Confirmed atomic replacement"). The previous database is preserved as
    /// a rollback file until the installed vault verifies.
    ///
    /// Sequence (design "File replacement"): stage a fully synced copy beside
    /// `vault.db`; revalidate the staged bytes (the selected file may have
    /// changed since the preview); checkpoint and close the active connection
    /// so the rollback file holds every committed write; rename the current
    /// database to `.rollback` and the stage into place; reopen and verify the
    /// installed vault; delete the rollback only after success. On any
    /// failure the previous database is restored, or the repository is left
    /// with no usable connection so the command layer locks the app instead of
    /// serving a partial vault.
    pub fn replace_with_backup(&mut self, source: impl AsRef<Path>) -> Result<(), RepositoryError> {
        let db_path = self
            .path
            .clone()
            .ok_or_else(|| RepositoryError::Store("vault has no backing database file".into()))?;
        let stage = stage_sibling(&db_path);
        let rollback = rollback_sibling(&db_path);

        // 1. Stage a fully synced copy beside the vault file: the final rename
        //    stays on one filesystem and the imported bytes are durable before
        //    anything is replaced.
        fs::copy(source.as_ref(), &stage).map_err(io_err)?;
        let staged = fs::File::open(&stage).map_err(io_err)?;
        staged.sync_all().map_err(io_err)?;
        drop(staged);

        // 2. Revalidate the staged bytes before touching the vault (guards
        //    against the selected file changing between preview and confirm).
        if let Err(e) = Self::validate_backup(&stage) {
            let _ = fs::remove_file(&stage);
            return Err(RepositoryError::Store(e.to_string()));
        }

        // 3. Checkpoint so every committed write lives in the main file, then
        //    close the active connection: no live connection may reference the
        //    files being renamed (renames over open files are not portable to
        //    Windows).
        self.checkpoint()?;
        self.conn = Connection::open_in_memory().map_err(store_err)?;

        // 4. Swap: current -> rollback, stage -> current.
        fs::rename(&db_path, &rollback).map_err(io_err)?;
        if let Err(e) = fs::rename(&stage, &db_path) {
            let _ = fs::remove_file(&stage);
            return self.restore_after_failed_swap(
                &db_path,
                &rollback,
                RepositoryError::Store(format!("could not install the imported vault: {e}")),
            );
        }

        // 5. Reopen and verify the installed vault; only then delete the
        //    rollback. Any failure restores the previous vault.
        let installed = match Self::open_connection(&db_path) {
            Ok(conn) => conn,
            Err(e) => return self.restore_after_failed_swap(&db_path, &rollback, e),
        };
        self.conn = installed;
        if !self.is_initialized().unwrap_or(false) {
            return self.restore_after_failed_swap(
                &db_path,
                &rollback,
                RepositoryError::Store("installed vault failed verification".into()),
            );
        }
        fs::remove_file(&rollback).map_err(io_err)?;
        Ok(())
    }

    /// Restore the previous vault after a failed swap: close the failed
    /// installation's connection, remove its file, rename the rollback back
    /// into place, and reopen it. Returns `cause` when restoration succeeds;
    /// when it does not, the repository keeps an empty placeholder connection
    /// so the app stays locked rather than serving a partial vault.
    fn restore_after_failed_swap(
        &mut self,
        db_path: &Path,
        rollback: &Path,
        cause: RepositoryError,
    ) -> Result<(), RepositoryError> {
        // Close any connection to the failed installation before touching the
        // files (removing/renaming open files is not portable to Windows).
        self.conn = Connection::open_in_memory().map_err(store_err)?;
        let _ = fs::remove_file(db_path);
        match fs::rename(rollback, db_path) {
            Ok(()) => {
                self.conn = Self::open_connection(db_path)?;
                Err(cause)
            }
            Err(restore_err) => Err(io_err(restore_err)),
        }
    }

    /// Open a file-backed repository connection through the standard
    /// initialization path (WAL, sync mode, foreign keys, migrations).
    fn open_connection(path: &Path) -> Result<Connection, RepositoryError> {
        let conn = Connection::open(path).map_err(store_err)?;
        Ok(Self::from_conn(conn)?.conn)
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

    fn list_emails(&self) -> Result<Vec<String>, RepositoryError> {
        // DISTINCT collapses entries sharing an email; empty strings (an
        // optional field) are excluded; ORDER BY yields ascending (BINARY)
        // collation. Feeds the email filter selector, which must stay complete
        // even while a filter shrinks the loaded entry list.
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT email FROM entries WHERE email <> '' ORDER BY email")
            .map_err(store_err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(store_err)?;
        rows.collect::<rusqlite::Result<Vec<String>>>()
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

    // -- category administration ---------------------------------------------

    fn list_categories(&self) -> Result<Vec<Category>, RepositoryError> {
        let mut stmt = self
            .conn
            .prepare("SELECT name, color FROM categories")
            .map_err(store_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Category {
                    name: r.get(0)?,
                    color: r.get(1)?,
                })
            })
            .map_err(store_err)?;
        let mut categories: Vec<Category> =
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(store_err)?;
        // Deterministic order: case-normalized name ascending, exact name as
        // the tie-breaker (category-administration "Resolve ordering ties").
        categories.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(categories)
    }

    fn category_exists(&self, name: &str) -> Result<bool, RepositoryError> {
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE name = ?1)",
                params![name],
                |r| r.get(0),
            )
            .map_err(store_err)?;
        Ok(exists)
    }

    fn create_category(&self, category: &Category) -> Result<(), RepositoryError> {
        self.conn
            .execute(
                "INSERT INTO categories (name, color) VALUES (?1, ?2)",
                params![category.name, category.color],
            )
            .map_err(store_err)?;
        Ok(())
    }

    fn update_category(&self, old: &str, category: &Category) -> Result<usize, RepositoryError> {
        // One transaction: rename/recolor the category AND cascade the rename
        // to every referencing entry, so both commit or both roll back.
        let tx = self.conn.unchecked_transaction().map_err(store_err)?;
        let updated = tx
            .execute(
                "UPDATE categories SET name = ?1, color = ?2 WHERE name = ?3",
                params![category.name, category.color, old],
            )
            .map_err(store_err)?;
        if updated == 0 {
            // Missing target: dropping the transaction rolls back and reports
            // the absent category without touching any entry.
            return Err(RepositoryError::NotFound);
        }
        let affected = tx
            .execute(
                "UPDATE entries SET category = ?1 WHERE category = ?2",
                params![category.name, old],
            )
            .map_err(store_err)?;
        tx.commit().map_err(store_err)?;
        Ok(affected)
    }

    fn delete_category(&self, name: &str) -> Result<(), RepositoryError> {
        let removed = self
            .conn
            .execute("DELETE FROM categories WHERE name = ?1", params![name])
            .map_err(store_err)?;
        if removed == 0 {
            return Err(RepositoryError::NotFound);
        }
        Ok(())
    }

    fn category_in_use(&self, name: &str) -> Result<usize, RepositoryError> {
        let count: usize = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM entries WHERE category = ?1",
                params![name],
                |r| r.get(0),
            )
            .map_err(store_err)?;
        Ok(count)
    }
}

/// Import storage for the shared, mutex-guarded repository (the shape the
/// Tauri layer manages). Validation opens the candidate independently and
/// needs no lock; the atomic swap takes the repository lock so no write can
/// interleave with the file replacement.
impl VaultImportStorage for Arc<Mutex<SqliteVaultRepository>> {
    fn validate_initialized(&self, source: &Path) -> Result<(), ImportStorageError> {
        SqliteVaultRepository::validate_backup(source)
    }

    fn replace_atomically(&self, source: &Path) -> Result<(), ImportStorageError> {
        self.lock()
            .unwrap()
            .replace_with_backup(source)
            .map_err(|e| ImportStorageError::Store(e.to_string()))
    }
}

/// `<db>.import-stage`: the synced copy of the imported backup installed by
/// the atomic swap, kept beside the vault so every rename stays on one
/// filesystem.
fn stage_sibling(db_path: &Path) -> PathBuf {
    let mut name = db_path.file_name().unwrap_or_default().to_os_string();
    name.push(".import-stage");
    db_path.with_file_name(name)
}

/// `<db>.rollback`: the previous vault kept until the installed replacement
/// verifies, then deleted.
fn rollback_sibling(db_path: &Path) -> PathBuf {
    let mut name = db_path.file_name().unwrap_or_default().to_os_string();
    name.push(".rollback");
    db_path.with_file_name(name)
}

/// Wrap an I/O error as a secret-free repository error.
fn io_err(e: io::Error) -> RepositoryError {
    RepositoryError::Store(e.to_string())
}

/// Map a candidate open failure: a file that is not a database is simply not
/// an initialized vault; anything else (missing file, permissions) is an open
/// failure.
fn map_import_err(e: rusqlite::Error) -> ImportStorageError {
    if matches!(
        e,
        rusqlite::Error::SqliteFailure(ref f, _) if f.code == rusqlite::ErrorCode::NotADatabase
    ) {
        ImportStorageError::InvalidVault
    } else {
        ImportStorageError::Open(e.to_string())
    }
}

/// Wrap a validation `rusqlite` error as a secret-free import error. A file
/// that is not a database (header check fails mid-query) is simply not an
/// initialized vault.
fn import_store_err(e: rusqlite::Error) -> ImportStorageError {
    if matches!(
        e,
        rusqlite::Error::SqliteFailure(ref f, _) if f.code == rusqlite::ErrorCode::NotADatabase
    ) {
        ImportStorageError::InvalidVault
    } else {
        ImportStorageError::Store(e.to_string())
    }
}

/// Apply pending migrations, tracked by `PRAGMA user_version`. Each step runs
/// only when the recorded version is older, so re-running on an up-to-date
/// database (or a partially migrated one) is a safe no-op.
fn migrate(conn: &Connection) -> Result<(), RepositoryError> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(store_err)?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1).map_err(store_err)?;
    }
    if version < 2 {
        conn.execute_batch(SCHEMA_V2).map_err(store_err)?;
        seed_categories_table(conn)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(store_err)?;
    }
    Ok(())
}

/// Insert the four seeded categories with their migration colors. `ON CONFLICT
/// DO NOTHING` keeps an existing row (including a custom color or a rerun on a
/// migrated vault) untouched (vault-storage "Category schema migration").
fn seed_categories_table(conn: &Connection) -> Result<(), RepositoryError> {
    for category in seed_categories() {
        conn.execute(
            "INSERT INTO categories (name, color) VALUES (?1, ?2)
             ON CONFLICT(name) DO NOTHING",
            params![category.name, category.color],
        )
        .map_err(store_err)?;
    }
    Ok(())
}

/// Wrap a `rusqlite` error as a secret-free repository error.
fn store_err(e: rusqlite::Error) -> RepositoryError {
    RepositoryError::Store(e.to_string())
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    /// The rollback restore path is not reachable through the public API (the
    /// swap only needs it after the installation rename, which fails solely on
    /// I/O faults), so the restore primitive is verified directly: a previous
    /// vault moved aside must come back byte-for-byte and reopen.
    #[test]
    fn restore_after_failed_swap_reinstates_the_previous_vault() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("vault.db");
        let mut repo = SqliteVaultRepository::open(&path).unwrap();
        let original = fs::read(&path).unwrap();

        // Simulate the swap point: the current vault was renamed to rollback
        // and a broken installation sits at the vault path.
        let rollback = rollback_sibling(&path);
        fs::rename(&path, &rollback).unwrap();
        fs::write(&path, b"corrupt installation").unwrap();

        let cause = RepositoryError::Store("swap failed".into());
        let err = repo.restore_after_failed_swap(&path, &rollback, cause.clone());
        assert_eq!(err, Err(cause), "restore must surface the original failure");
        assert!(!rollback.exists(), "rollback file must be consumed by the restore");
        assert_eq!(
            fs::read(&path).unwrap(),
            original,
            "the previous vault must be restored byte-for-byte"
        );
        // The repository is usable again and points at the restored file.
        assert_eq!(repo.db_path(), Some(path.as_path()));
        assert!(!repo.is_initialized().unwrap());
    }
}
