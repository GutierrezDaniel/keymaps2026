//! Encrypted native-format backup adapter (spec: `openspec/specs/vault-backup/spec.md`).
//!
//! The vault's native format IS its SQLite database: metadata is plaintext and
//! indexable, passwords are stored only as AES-256-GCM nonce + ciphertext bound
//! to their record ID (vault-storage). Exporting therefore means producing a
//! consistent copy of that database — the backup is encrypted in exactly the
//! same sense the vault is encrypted at rest, contains no plaintext passwords,
//! and preserves every nonce/AAD the restore path needs.
//!
//! Guarantees:
//! - refuses export when the vault is locked or when serialization cannot
//!   complete, returning an error instead of a truncated artifact;
//! - never leaves a partial file: bytes are written to a temp sibling and
//!   atomically renamed into place, with the temp file removed on failure;
//! - a WAL checkpoint runs before copying so recent commits are not stranded
//!   in the `-wal` file.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::adapters::persistence::sqlite::SqliteVaultRepository;

/// Backup-specific errors. Never carries secret material.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BackupError {
    #[error("vault is locked; unlock before exporting")]
    Locked,
    #[error("vault has no backing database file and cannot be exported")]
    NoVaultFile,
    #[error("could not checkpoint the vault: {0}")]
    Store(String),
    #[error("backup failed: {0}")]
    Io(String),
}

/// Produces encrypted native-format vault backups.
pub struct BackupService {
    repo: Arc<Mutex<SqliteVaultRepository>>,
}

impl BackupService {
    pub fn new(repo: Arc<Mutex<SqliteVaultRepository>>) -> Self {
        Self { repo }
    }

    /// Export the vault to `dest` in its native encrypted format.
    ///
    /// `unlocked` is the session state reported by the command layer: a locked
    /// vault is refused up front (vault-backup "Safe export availability").
    ///
    /// On success `dest` holds a complete, valid vault database. On any error
    /// `dest` is left untouched and no temp file remains.
    pub fn export(&self, unlocked: bool, dest: &Path) -> Result<(), BackupError> {
        if !unlocked {
            return Err(BackupError::Locked);
        }

        // Hold the repository lock for the whole copy so no write can
        // interleave between the checkpoint and the file read.
        let repo = self.repo.lock().unwrap();
        let db_path = repo.db_path().ok_or(BackupError::NoVaultFile)?;
        repo.checkpoint().map_err(|e| BackupError::Store(e.to_string()))?;
        let bytes = fs::read(db_path).map_err(io_err)?;
        atomic_write(dest, &bytes)
    }
}

/// Write `bytes` to `dest` through a temp sibling plus atomic rename, removing
/// the temp file on any failure so no partial backup is ever presented.
fn atomic_write(dest: &Path, bytes: &[u8]) -> Result<(), BackupError> {
    let tmp = temp_sibling(dest);
    let result = (|| -> Result<(), BackupError> {
        let mut file = fs::File::create(&tmp).map_err(io_err)?;
        file.write_all(bytes).map_err(io_err)?;
        file.sync_all().map_err(io_err)?;
        replace_file(&tmp, dest)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Move the fully-written temp file onto `dest`, replacing an existing file.
/// `fs::rename` already replaces atomically on Unix; on Windows it fails when
/// the destination exists, so the old destination is removed first — only
/// after the temp bytes are written and synced (vault-backup "Direct
/// overwrite").
#[cfg(windows)]
fn replace_file(tmp: &Path, dest: &Path) -> Result<(), BackupError> {
    if dest.exists() {
        fs::remove_file(dest).map_err(io_err)?;
    }
    fs::rename(tmp, dest).map_err(io_err)
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, dest: &Path) -> Result<(), BackupError> {
    fs::rename(tmp, dest).map_err(io_err)
}

/// `<dest>.tmp` next to the destination, so the rename stays on one filesystem.
fn temp_sibling(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    dest.with_file_name(name)
}

fn io_err(e: io::Error) -> BackupError {
    BackupError::Io(e.to_string())
}

#[cfg(test)]
mod tests {
    use secrecy::{ExposeSecret, SecretString};
    use tempfile::TempDir;

    use super::*;
    use crate::adapters::crypto::argon2_aes::Argon2Aes;
    use crate::core::domain::entry::{EncryptedField, EntryRecord, Filters, RecordId};
    use crate::core::ports::cipher::CipherPort;
    use crate::core::ports::key_derivation::KeyDerivationPort;
    use crate::core::ports::vault_repository::VaultRepository;

    const MASTER_PASSWORD: &str = "correct horse battery staple";
    const SECRET_VALUE: &str = "backup-secret-value";

    fn secret(s: &str) -> SecretString {
        SecretString::from(s.to_string())
    }

    fn rid(n: u8) -> RecordId {
        RecordId([n; 16])
    }

    /// A file-backed vault with one encrypted entry, plus the salt used to
    /// derive its key (so tests can decrypt through the persisted context).
    fn seeded_vault(dir: &TempDir) -> (Arc<Mutex<SqliteVaultRepository>>, Vec<u8>) {
        let path = dir.path().join("vault.db");
        let repo = SqliteVaultRepository::open(&path).unwrap();

        let salt = Argon2Aes.random_salt();
        let key = Argon2Aes.derive(secret(MASTER_PASSWORD), &salt).unwrap();
        let validation = Argon2Aes
            .encrypt(&rid(9), &key, secret("vault-validation"))
            .unwrap();
        repo.init_vault(salt.clone(), &validation).unwrap();

        let password = Argon2Aes.encrypt(&rid(1), &key, secret(SECRET_VALUE)).unwrap();
        let entry = EntryRecord {
            id: rid(1),
            site: "github".into(),
            link: "https://github".into(),
            category: "servicios".into(),
            email: "a@b.c".into(),
            username: "user".into(),
            password,
        };
        repo.save(&entry).unwrap();

        (Arc::new(Mutex::new(repo)), salt)
    }

    /// Rust `slice::windows`-based byte search (same helper as vault_repo.rs).
    fn find_subslice(haystack: &[u8], needle: &[u8]) -> bool {
        if needle.is_empty() {
            return true;
        }
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    // -----------------------------------------------------------------------
    // vault-backup "Safe export availability": refuse locked, no partial file.
    // -----------------------------------------------------------------------

    #[test]
    fn export_refused_when_locked() {
        let dir = TempDir::new().unwrap();
        let (repo, _salt) = seeded_vault(&dir);
        let backup = BackupService::new(repo);
        let dest = dir.path().join("backup.db");

        let err = backup.export(false, &dest).unwrap_err();
        assert_eq!(err, BackupError::Locked);
        assert!(!dest.exists(), "no backup may be produced while locked");
        assert!(!temp_sibling(&dest).exists(), "no temp file may remain");
    }

    #[test]
    fn export_refuses_vault_without_backing_file() {
        let repo = SqliteVaultRepository::open_in_memory().unwrap();
        let backup = BackupService::new(Arc::new(Mutex::new(repo)));
        let dir = TempDir::new().unwrap();
        let dest = dir.path().join("backup.db");

        let err = backup.export(true, &dest).unwrap_err();
        assert_eq!(err, BackupError::NoVaultFile);
        assert!(!dest.exists());
    }

    #[test]
    fn export_failure_leaves_no_partial_file() {
        let dir = TempDir::new().unwrap();
        let (repo, _salt) = seeded_vault(&dir);
        let backup = BackupService::new(repo);

        // Destination inside a directory that does not exist: every write path
        // fails, and neither a partial backup nor a temp file may survive.
        let dest = dir.path().join("missing-dir").join("backup.db");
        assert!(backup.export(true, &dest).is_err());
        assert!(!dest.exists(), "no partial backup may be reported as valid");
        assert!(!temp_sibling(&dest).exists(), "no temp file may remain");
    }

    // -----------------------------------------------------------------------
    // vault-backup "Encrypted native-format export": valid, restorable, and
    // free of plaintext passwords.
    // -----------------------------------------------------------------------

    #[test]
    fn export_produces_valid_native_backup_without_plaintext() {
        let dir = TempDir::new().unwrap();
        let (repo, salt) = seeded_vault(&dir);
        let backup = BackupService::new(repo);
        let dest = dir.path().join("backup.db");

        backup.export(true, &dest).unwrap();
        assert!(dest.exists());

        // The exported file must be a real vault: reopen it as the source of a
        // fresh repository and read the entry back.
        let reopened = SqliteVaultRepository::open(&dest).unwrap();
        assert!(reopened.is_initialized().unwrap());
        let all = reopened.list(&Filters::new()).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].site, "github");

        // Restore path: the key derived from the *exported* salt decrypts the
        // exported password field, proving the encrypted context is preserved.
        let key = Argon2Aes.derive(secret(MASTER_PASSWORD), &salt).unwrap();
        let recovered = Argon2Aes.decrypt(&all[0].id, &key, &all[0].password).unwrap();
        assert_eq!(recovered.expose_secret(), SECRET_VALUE);

        // No plaintext password anywhere in the raw backup bytes.
        let raw = fs::read(&dest).unwrap();
        assert!(
            !find_subslice(&raw, SECRET_VALUE.as_bytes()),
            "plaintext password leaked into the backup file"
        );
    }

    /// vault-backup "Export preserves encrypted context": per-entry nonces and
    /// ciphertext must round-trip through the export verbatim.
    #[test]
    fn export_preserves_encrypted_field_context() {
        let dir = TempDir::new().unwrap();
        let (repo, _salt) = seeded_vault(&dir);
        let source = repo.lock().unwrap();
        let original: Vec<EncryptedField> = source
            .list(&Filters::new())
            .unwrap()
            .into_iter()
            .map(|e| e.password)
            .collect();
        drop(source);

        let dest = dir.path().join("backup.db");
        BackupService::new(repo).export(true, &dest).unwrap();

        let reopened = SqliteVaultRepository::open(&dest).unwrap();
        let exported: Vec<EncryptedField> = reopened
            .list(&Filters::new())
            .unwrap()
            .into_iter()
            .map(|e| e.password)
            .collect();
        assert_eq!(original, exported, "exported ciphertext/nonce must match the source");
    }

    // -----------------------------------------------------------------------
    // vault-backup "Direct overwrite": an existing destination is replaced by
    // a complete, valid backup (no stale or partial content survives).
    // -----------------------------------------------------------------------

    #[test]
    fn export_overwrites_an_existing_destination_file() {
        let dir = TempDir::new().unwrap();
        let (repo, _salt) = seeded_vault(&dir);
        let backup = BackupService::new(repo);
        let dest = dir.path().join("backup.db");

        // A previous backup (or any pre-existing file) occupies the path.
        fs::write(&dest, b"stale previous backup bytes").unwrap();

        backup.export(true, &dest).unwrap();

        // The destination now holds a complete, valid vault: stale bytes are
        // gone and the file reopens as an initialized repository.
        let reopened = SqliteVaultRepository::open(&dest).unwrap();
        assert!(reopened.is_initialized().unwrap());
        assert_eq!(reopened.list(&Filters::new()).unwrap().len(), 1);
        assert!(!temp_sibling(&dest).exists(), "no temp file may remain after overwrite");
    }
}