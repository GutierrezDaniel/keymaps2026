//! Independent verification probes for RUST-AUDIT F12, F13, F14, F15 and F16.

use std::sync::{Arc, Mutex};

use secrecy::{ExposeSecret, SecretString};
use tempfile::TempDir;

use keymaps2026_lib::adapters::backup::{BackupError, BackupService};
use keymaps2026_lib::adapters::crypto::argon2_aes::Argon2Aes;
use keymaps2026_lib::adapters::persistence::sqlite::SqliteVaultRepository;
use keymaps2026_lib::core::application::gate::{Confirmation, SessionGate};
use keymaps2026_lib::core::application::vault_import_service::{
    ImportResult, ImportServiceError, VaultImportService,
};
use keymaps2026_lib::core::application::vault_service::{
    ServiceError, UpdateCategoryResult, VaultService,
};
use keymaps2026_lib::core::domain::entry::{
    EncryptedField, EntryInput, EntryRecord, Filters, RecordId,
};
use keymaps2026_lib::core::ports::cipher::{CipherPort, CryptoError, VaultKey};
use keymaps2026_lib::core::ports::key_derivation::KeyDerivationPort;
use keymaps2026_lib::core::ports::vault_repository::VaultRepository;

const PW: &str = "hunter2";

fn rid(n: u8) -> RecordId {
    RecordId([n; 16])
}

fn secret(s: &str) -> SecretString {
    SecretString::from(s.to_string())
}

fn test_key() -> VaultKey {
    Argon2Aes.derive(secret(PW), &[7u8; 16]).unwrap()
}

fn other_key() -> VaultKey {
    Argon2Aes
        .derive(secret("not-the-vault-password"), &[7u8; 16])
        .unwrap()
}

fn validation(key: &VaultKey) -> EncryptedField {
    Argon2Aes
        .encrypt(&rid(200), key, secret("vault-validation"))
        .unwrap()
}

fn init_repo(path: &std::path::Path, key: &VaultKey) -> SqliteVaultRepository {
    let repo = SqliteVaultRepository::open(path).unwrap();
    repo.init_vault(vec![7u8; 16], &validation(key)).unwrap();
    repo
}

fn seeded_shared(
    path: &std::path::Path,
    key: &VaultKey,
    site: &str,
) -> Arc<Mutex<SqliteVaultRepository>> {
    let repo = init_repo(path, key);
    repo.save(&EntryRecord {
        id: rid(1),
        site: site.into(),
        link: format!("https://{site}"),
        category: "servicios".into(),
        email: "a@b.c".into(),
        username: "u".into(),
        password: Argon2Aes.encrypt(&rid(1), key, secret("pw")).unwrap(),
    })
    .unwrap();
    Arc::new(Mutex::new(repo))
}

fn sites(repo: &Arc<Mutex<SqliteVaultRepository>>) -> Vec<String> {
    repo.list(&Filters::new())
        .unwrap()
        .into_iter()
        .map(|e| e.site)
        .collect()
}

fn entry(category: &str, site: &str, email: &str, username: &str) -> EntryInput {
    EntryInput {
        site: site.to_string(),
        link: format!("https://{site}"),
        password: secret("pw"),
        email: email.to_string(),
        username: username.to_string(),
        category: category.to_string(),
    }
}

/// F12: two distinct `&str` arguments used to swap silently when `EntryInput`
/// had a positional constructor. With a struct literal they cannot.
#[test]
fn f12_distinct_email_and_username_land_in_their_own_columns() {
    let dir = TempDir::new().unwrap();
    let key = test_key();
    let svc = VaultService::new(init_repo(&dir.path().join("v.db"), &key), Argon2Aes);

    svc.create_entry(
        rid(1),
        &key,
        entry("trabajo", "github", "alice@example.com", "alice-user"),
    )
    .unwrap();
    let s = svc.get_entry_summary(&rid(1)).unwrap();
    assert_eq!(
        (s.email.as_str(), s.username.as_str()),
        ("alice@example.com", "alice-user")
    );

    svc.update_entry(
        rid(1),
        &key,
        entry("trabajo", "github", "bob@example.com", "bob-user"),
    )
    .unwrap();
    let s = svc.get_entry_summary(&rid(1)).unwrap();
    assert_eq!(
        (s.email.as_str(), s.username.as_str()),
        ("bob@example.com", "bob-user")
    );
}

/// F13: the service never derives, so the key comes from the caller and a
/// different one must fail authentication rather than silently work.
#[test]
fn f13_derived_key_comes_from_the_caller() {
    let dir = TempDir::new().unwrap();
    let key = test_key();
    let svc = VaultService::new(init_repo(&dir.path().join("v.db"), &key), Argon2Aes);
    svc.create_entry(rid(1), &key, entry("trabajo", "github", "a@b.c", "u"))
        .unwrap();

    let d = svc.get_entry_details(&rid(1), &key).unwrap();
    assert_eq!(d.password.expose_secret(), "pw");

    let err = svc.get_entry_details(&rid(1), &other_key()).unwrap_err();
    assert!(
        matches!(err, ServiceError::Crypto(CryptoError::AuthenticationFailed)),
        "a wrong caller key must fail authentication, got {err:?}"
    );
}

/// F16: a locked export is refused before anything is written.
#[test]
fn f16_locked_export_is_refused_and_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let key = test_key();
    let repo = seeded_shared(&dir.path().join("vault.db"), &key, "github");
    let backup = BackupService::new(repo);
    let dest = dir.path().join("export.db");

    let err = backup.export(SessionGate::Locked, &dest).unwrap_err();
    assert!(matches!(err, BackupError::Locked));
    assert!(!dest.exists(), "locked export must not create a file");
    assert!(
        !dir.path().join("export.db.tmp").exists(),
        "locked export must not leave a temp file"
    );
}

/// F16: an unconfirmed rename previews and writes nothing.
#[test]
fn f16_unconfirmed_rename_previews_and_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let key = test_key();
    let svc = VaultService::new(init_repo(&dir.path().join("v.db"), &key), Argon2Aes);
    for n in 1..=2u8 {
        svc.create_entry(
            rid(n),
            &key,
            entry("trabajo", &format!("site{n}"), "a@b.c", "u"),
        )
        .unwrap();
    }
    let categories_before = svc.list_categories().unwrap();

    let result = svc
        .update_category("trabajo", "laburo", "#ad3a2d", Confirmation::Pending)
        .unwrap();
    assert_eq!(
        result,
        UpdateCategoryResult::RenamePreview {
            affected_entries: 2
        }
    );
    assert_eq!(svc.list_categories().unwrap(), categories_before);
    assert!(
        svc.list_entries(&Filters::new())
            .unwrap()
            .iter()
            .all(|e| e.category == "trabajo"),
        "an unconfirmed rename must not rewrite the entries"
    );
}

/// F16: an unconfirmed import validates only; a locked import is refused.
#[test]
fn f16_unconfirmed_import_validates_only_and_locked_import_is_refused() {
    let dir = TempDir::new().unwrap();
    let key = test_key();
    let target = seeded_shared(&dir.path().join("vault.db"), &key, "github");
    let backup_path = dir.path().join("backup.db");
    write_closed_vault(&backup_path, &key, "gitlab");
    let backup_bytes = std::fs::read(&backup_path).unwrap();
    let svc = VaultImportService::new(Arc::clone(&target));

    let result = svc
        .import(SessionGate::Unlocked, Confirmation::Pending, &backup_path)
        .unwrap();
    assert_eq!(result, ImportResult::ConfirmationRequired);
    assert_eq!(sites(&target), vec!["github".to_string()]);
    assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);

    let err = svc
        .import(SessionGate::Locked, Confirmation::Confirmed, &backup_path)
        .unwrap_err();
    assert!(matches!(err, ImportServiceError::Locked));
    assert_eq!(sites(&target), vec!["github".to_string()]);
    assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
}

fn write_closed_vault(path: &std::path::Path, key: &VaultKey, site: &str) {
    drop(seeded_shared(path, key, site));
}

/// F15: the attribute has no compiler enforcement inside the crate, so the
/// invariant is pinned at the source.
#[test]
fn f15_public_error_enums_carry_non_exhaustive() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let targets = [
        ("src/adapters/backup.rs", "pub enum BackupError {"),
        (
            "src/core/application/vault_import_service.rs",
            "pub enum ImportServiceError {",
        ),
        (
            "src/core/application/vault_service.rs",
            "pub enum ServiceError {",
        ),
        ("src/core/ports/cipher.rs", "pub enum CryptoError {"),
        ("src/core/ports/clipboard.rs", "pub enum ClipboardError {"),
        (
            "src/core/ports/vault_import_storage.rs",
            "pub enum ImportStorageError {",
        ),
        (
            "src/core/ports/vault_repository.rs",
            "pub enum RepositoryError {",
        ),
    ];
    for (rel, decl) in targets {
        let src = std::fs::read_to_string(root.join(rel)).unwrap();
        let idx = src
            .find(decl)
            .unwrap_or_else(|| panic!("{rel}: {decl} not found"));
        let before = src[..idx].trim_end();
        assert!(
            before.ends_with("#[non_exhaustive]"),
            "{rel}: {decl} lost #[non_exhaustive]"
        );
    }
}

/// F14: the core unit tests must not reach back into a crypto adapter.
#[test]
fn f14_the_core_service_does_not_import_the_crypto_adapter() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let src =
        std::fs::read_to_string(root.join("src/core/application/vault_service.rs")).unwrap();
    assert!(
        !src.contains("adapters::crypto::argon2_aes"),
        "core test reached back into the adapter"
    );
    assert!(
        src.contains("FakeCipher") && src.contains("FakeKdf"),
        "port fakes must stay in the unit tests"
    );
}
