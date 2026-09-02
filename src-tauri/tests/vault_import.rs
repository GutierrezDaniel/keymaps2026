//! Vault-import integration tests (spec: `openspec/specs/vault-import/spec.md`).
//!
//! These tests exercise the SQLite import storage through the real crypto
//! adapter, proving read-only validation, atomic replacement, rollback
//! restoration, and the service's preview/confirm flow against real files.

use std::path::Path;
use std::sync::{Arc, Mutex};

use secrecy::SecretString;
use tempfile::TempDir;

use keymaps2026_lib::adapters::crypto::argon2_aes::Argon2Aes;
use keymaps2026_lib::adapters::persistence::sqlite::SqliteVaultRepository;
use keymaps2026_lib::core::application::vault_import_service::{
    ImportResult, ImportServiceError, VaultImportService,
};
use keymaps2026_lib::core::domain::entry::{EntryRecord, Filters, RecordId};
use keymaps2026_lib::core::ports::cipher::CipherPort;
use keymaps2026_lib::core::ports::key_derivation::KeyDerivationPort;
use keymaps2026_lib::core::ports::vault_import_storage::ImportStorageError;
use keymaps2026_lib::core::ports::vault_repository::VaultRepository;

const MASTER_PASSWORD: &str = "correct horse battery staple";

fn crypto() -> Argon2Aes {
    Argon2Aes
}

fn secret(s: &str) -> SecretString {
    SecretString::from(s.to_string())
}

fn rid(n: u8) -> RecordId {
    RecordId([n; 16])
}

/// Build a file-backed initialized vault at `path` holding one entry for
/// `site`, returned as the shared, mutex-guarded repository the Tauri layer
/// uses (and that implements the import storage port).
fn seeded_vault(path: &Path, site: &str) -> Arc<Mutex<SqliteVaultRepository>> {
    let repo = SqliteVaultRepository::open(path).unwrap();
    let salt = crypto().random_salt();
    let key = crypto()
        .derive(secret(MASTER_PASSWORD), &salt)
        .unwrap();
    let validation = crypto()
        .encrypt(&rid(9), &key, secret("vault-validation"))
        .unwrap();
    repo.init_vault(salt, &validation).unwrap();
    let encrypted = crypto().encrypt(&rid(1), &key, secret("pw")).unwrap();
    repo.save(&EntryRecord {
        id: rid(1),
        site: site.into(),
        link: format!("https://{site}"),
        category: "servicios".into(),
        email: "a@b.c".into(),
        username: "user".into(),
        password: encrypted,
    })
    .unwrap();
    Arc::new(Mutex::new(repo))
}

/// Write a *closed* initialized vault at `path` (the connection is dropped,
/// checkpointing on close) — the exact shape a real exported backup has.
fn write_closed_vault(path: &Path, site: &str) {
    drop(seeded_vault(path, site));
}

/// The sites currently stored in the shared repository, ascending.
fn sites(repo: &Arc<Mutex<SqliteVaultRepository>>) -> Vec<String> {
    repo.list(&Filters::new())
        .unwrap()
        .into_iter()
        .map(|e| e.site)
        .collect()
}

// ---------------------------------------------------------------------------
// Read-only validation (vault-import "Validate before replacement").
// ---------------------------------------------------------------------------

#[test]
fn validate_backup_accepts_an_initialized_vault_backup() {
    let dir = TempDir::new().unwrap();
    let backup = dir.path().join("backup.db");
    write_closed_vault(&backup, "github");
    SqliteVaultRepository::validate_backup(&backup).unwrap();
}

#[test]
fn validate_backup_rejects_garbage_empty_and_missing_files() {
    let dir = TempDir::new().unwrap();

    let garbage = dir.path().join("garbage.db");
    std::fs::write(&garbage, b"this is not a sqlite database").unwrap();
    assert_eq!(
        SqliteVaultRepository::validate_backup(&garbage).unwrap_err(),
        ImportStorageError::InvalidVault
    );

    let empty = dir.path().join("empty.db");
    std::fs::write(&empty, []).unwrap();
    assert_eq!(
        SqliteVaultRepository::validate_backup(&empty).unwrap_err(),
        ImportStorageError::InvalidVault
    );

    let missing = dir.path().join("missing.db");
    assert!(matches!(
        SqliteVaultRepository::validate_backup(&missing).unwrap_err(),
        ImportStorageError::Open(_)
    ));
}

#[test]
fn validate_backup_is_read_only_and_never_touches_the_candidate() {
    let dir = TempDir::new().unwrap();
    let backup = dir.path().join("backup.db");
    write_closed_vault(&backup, "github");
    let before = std::fs::read(&backup).unwrap();

    SqliteVaultRepository::validate_backup(&backup).unwrap();
    // Repeated validation stays a no-op on the candidate file.
    SqliteVaultRepository::validate_backup(&backup).unwrap();
    assert_eq!(
        std::fs::read(&backup).unwrap(),
        before,
        "validation must never write to the candidate"
    );

    // No stage/rollback artifacts may appear next to the candidate.
    assert!(!dir.path().join("backup.db.import-stage").exists());
    assert!(!dir.path().join("backup.db.rollback").exists());
}

// ---------------------------------------------------------------------------
// Service flow through real storage (preview, cancel, confirm, locked).
// ---------------------------------------------------------------------------

#[test]
fn preview_confirms_without_writing_and_confirmed_import_applies() {
    let dir = TempDir::new().unwrap();
    let a_path = dir.path().join("vault.db");
    let repo = seeded_vault(&a_path, "github");
    let backup = dir.path().join("backup.db");
    write_closed_vault(&backup, "gitlab");
    let service = VaultImportService::new(Arc::clone(&repo));

    // Preview (cancel path): validated, nothing written, vault unchanged.
    let result = service.import(true, false, &backup).unwrap();
    assert_eq!(result, ImportResult::ConfirmationRequired);
    assert_eq!(sites(&repo), vec!["github"]);

    // Confirm: revalidated and applied; the imported vault is now active.
    let result = service.import(true, true, &backup).unwrap();
    assert_eq!(result, ImportResult::Applied);
    assert_eq!(sites(&repo), vec!["gitlab"]);
    assert!(repo.lock().unwrap().is_initialized().unwrap());
}

#[test]
fn locked_import_is_refused_with_real_storage() {
    let dir = TempDir::new().unwrap();
    let a_path = dir.path().join("vault.db");
    let repo = seeded_vault(&a_path, "github");
    let backup = dir.path().join("backup.db");
    write_closed_vault(&backup, "gitlab");
    let service = VaultImportService::new(Arc::clone(&repo));

    assert!(matches!(
        service.import(false, true, &backup).unwrap_err(),
        ImportServiceError::Locked
    ));
    assert_eq!(sites(&repo), vec!["github"], "locked import must not swap");
}

// ---------------------------------------------------------------------------
// Atomic replacement and failure safety (vault-import "Confirmed atomic
// replacement", "Import failure safety").
// ---------------------------------------------------------------------------

#[test]
fn confirmed_import_swaps_atomically_and_deletes_rollback_only_after_success() {
    let dir = TempDir::new().unwrap();
    let a_path = dir.path().join("vault.db");
    let repo = seeded_vault(&a_path, "github");
    let backup = dir.path().join("backup.db");
    write_closed_vault(&backup, "gitlab");
    let backup_bytes = std::fs::read(&backup).unwrap();
    let service = VaultImportService::new(Arc::clone(&repo));

    service.import(true, true, &backup).unwrap();

    // The active vault file is the imported backup, byte-for-byte.
    assert_eq!(std::fs::read(&a_path).unwrap(), backup_bytes);
    // The rollback file existed only until the replacement verified; nothing
    // may remain after success.
    assert!(!dir.path().join("vault.db.rollback").exists());
    assert!(!dir.path().join("vault.db.import-stage").exists());
}

#[test]
fn failed_import_leaves_the_current_vault_intact_and_usable() {
    let dir = TempDir::new().unwrap();
    let a_path = dir.path().join("vault.db");
    let repo = seeded_vault(&a_path, "github");
    let garbage = dir.path().join("garbage.db");
    std::fs::write(&garbage, b"not a database").unwrap();
    let service = VaultImportService::new(Arc::clone(&repo));

    let err = service.import(true, true, &garbage).unwrap_err();
    assert!(matches!(err, ImportServiceError::Storage(_)));

    // The current vault is preserved and the repository still serves it.
    assert_eq!(sites(&repo), vec!["github"]);
    assert!(!dir.path().join("vault.db.rollback").exists());
    assert!(!dir.path().join("vault.db.import-stage").exists());
}