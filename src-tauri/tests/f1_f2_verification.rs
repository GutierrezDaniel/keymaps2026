//! Regression probes for RUST-AUDIT F1 (atomic vault swap recovery) and
//! F2 (update of a missing entry must be NotFound, not an upsert).
//!
//! These exercise the real SQLite adapter and the real service through their
//! public API, so they assert observable effects: persisted bytes, what a
//! fresh reopen sees, and whether the repository still points at the vault.

use std::fs;
use std::path::{Path, PathBuf};

use secrecy::{ExposeSecret, SecretString};
use tempfile::TempDir;

use keymaps2026_lib::adapters::crypto::argon2_aes::Argon2Aes;
use keymaps2026_lib::adapters::persistence::sqlite::SqliteVaultRepository;
use keymaps2026_lib::core::application::vault_service::{ServiceError, VaultService};
use keymaps2026_lib::core::domain::entry::{
    EncryptedField, EntryInput, EntryRecord, Filters, RecordId,
};
use keymaps2026_lib::core::ports::cipher::{CipherPort, VaultKey};
use keymaps2026_lib::core::ports::key_derivation::KeyDerivationPort;
use keymaps2026_lib::core::ports::vault_repository::VaultRepository;

fn rid(n: u8) -> RecordId {
    RecordId::new([n; 16])
}

fn field(seed: u8) -> EncryptedField {
    EncryptedField {
        nonce: vec![seed; 12],
        ciphertext: vec![seed; 32],
    }
}

fn record(id: u8, site: &str) -> EntryRecord {
    EntryRecord {
        id: rid(id),
        site: site.into(),
        link: format!("https://{site}"),
        category: "servicios".into(),
        email: "a@b.c".into(),
        username: "u".into(),
        password: field(id),
    }
}

fn input(site: &str, pwd: &str) -> EntryInput {
    EntryInput {
        site: site.to_string(),
        link: format!("https://{site}"),
        password: SecretString::from(pwd.to_string()),
        email: "a@b.c".to_string(),
        username: "u".to_string(),
        category: "servicios".to_string(),
    }
}

fn sibling(db: &Path, suffix: &str) -> PathBuf {
    let mut name = db.file_name().unwrap().to_os_string();
    name.push(suffix);
    db.with_file_name(name)
}

fn service(
    dir: &Path,
) -> (
    VaultService<SqliteVaultRepository, Argon2Aes>,
    VaultKey,
    PathBuf,
) {
    let path = dir.join("vault.db");
    let repo = SqliteVaultRepository::open(&path).unwrap();
    let salt = vec![7u8; 16];
    let key = Argon2Aes
        .derive(SecretString::from("hunter2".to_string()), &salt)
        .unwrap();
    let validation = Argon2Aes
        .encrypt(
            &rid(200),
            &key,
            SecretString::from("vault-validation".to_string()),
        )
        .unwrap();
    repo.init_vault(salt, &validation).unwrap();
    (VaultService::new(repo, Argon2Aes), key, path)
}

fn sites(repo: &SqliteVaultRepository) -> Vec<String> {
    repo.list(&Filters::new())
        .unwrap()
        .into_iter()
        .map(|e| e.site)
        .collect()
}

fn seeded(path: &Path, id: u8, site: &str) -> SqliteVaultRepository {
    let repo = SqliteVaultRepository::open(path).unwrap();
    repo.init_vault(vec![9u8; 16], &field(9)).unwrap();
    repo.save(&record(id, site)).unwrap();
    repo
}

/// Main database file plus its WAL sidecar: committed rows may still live in
/// the WAL, so byte identity must cover both.
fn snapshot(db: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut out = Vec::new();
    for p in [db.to_path_buf(), sibling(db, "-wal")] {
        if let Ok(bytes) = fs::read(&p) {
            out.push((p, bytes));
        }
    }
    out
}

// F2: a rejected update returns NotFound, writes nothing, and leaves the
// stored bytes untouched.
#[test]
fn f2_update_of_missing_id_is_not_found_and_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let (svc, key, db) = service(dir.path());
    svc.create_entry(rid(1), &key, input("alpha", "pw"))
        .unwrap();
    let before = snapshot(&db);

    let err = svc
        .update_entry(rid(9), &key, input("ghost", "p"))
        .unwrap_err();

    assert!(matches!(err, ServiceError::NotFound));
    assert_eq!(before, snapshot(&db), "rejected update changed vault bytes");
    assert_eq!(svc.list_entries(&Filters::new()).unwrap().len(), 1);
    drop(svc);
    let reopened = SqliteVaultRepository::open(&db).unwrap();
    assert_eq!(sites(&reopened), vec!["alpha".to_string()]);
}

// F2: the existence check must not block a real update — the record is
// re-encrypted in place and still round-trips under the same key.
#[test]
fn f2_update_of_known_id_replaces_in_place() {
    let dir = TempDir::new().unwrap();
    let (svc, key, db) = service(dir.path());
    svc.create_entry(rid(1), &key, input("github", "old"))
        .unwrap();
    let old = SqliteVaultRepository::open(&db)
        .unwrap()
        .list(&Filters::new())
        .unwrap()
        .remove(0)
        .password;

    svc.update_entry(rid(1), &key, input("gitlab", "new"))
        .unwrap();

    let listed = svc.list_entries(&Filters::new()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].site, "gitlab");
    let new = SqliteVaultRepository::open(&db)
        .unwrap()
        .list(&Filters::new())
        .unwrap()
        .remove(0)
        .password;
    assert_ne!(old.nonce, new.nonce);
    assert_ne!(old.ciphertext, new.ciphertext);
    let plain = Argon2Aes.decrypt(&rid(1), &key, &new).unwrap();
    assert_eq!(plain.expose_secret(), "new");
}

// F1: a successful swap installs the vault, leaves no transient files, and the
// repository's connection follows the installed database.
#[test]
fn f1_successful_replace_installs_verified_vault() {
    let dir = TempDir::new().unwrap();
    let current = dir.path().join("vault.db");
    let source = dir.path().join("source.db");
    let mut repo = seeded(&current, 1, "alpha");
    {
        let src = seeded(&source, 2, "beta");
        src.checkpoint().unwrap();
    }

    repo.replace_with_backup(&source).unwrap();

    assert!(!sibling(&current, ".rollback").exists());
    assert!(!sibling(&current, ".import-stage").exists());
    assert!(repo.is_initialized().unwrap());
    assert_eq!(sites(&repo), vec!["beta".to_string()]);
    repo.save(&record(3, "gamma")).unwrap();
    drop(repo);
    let mut got = sites(&SqliteVaultRepository::open(&current).unwrap());
    got.sort();
    assert_eq!(got, vec!["beta".to_string(), "gamma".to_string()]);
}

// F1: when the `current -> rollback` rename fails, the original vault must stay
// readable AND writable. Returning with the in-memory placeholder would leave
// every later read and write failing.
#[test]
fn f1_failed_rename_keeps_original_vault_readable_and_writable() {
    let dir = TempDir::new().unwrap();
    let current = dir.path().join("vault.db");
    let source = dir.path().join("source.db");
    let mut repo = seeded(&current, 1, "alpha");
    {
        let src = seeded(&source, 2, "beta");
        src.checkpoint().unwrap();
    }
    // A directory cannot be removed by `remove_file` and cannot be renamed
    // onto, so the `current -> rollback` rename fails.
    fs::create_dir(sibling(&current, ".rollback")).unwrap();

    let err = repo.replace_with_backup(&source).unwrap_err();

    assert!(current.exists());
    assert!(format!("{err:?}").contains("rename current to rollback"));
    assert_eq!(sites(&repo), vec!["alpha".to_string()], "original vault lost");
    repo.save(&record(3, "gamma")).unwrap();
    drop(repo);
    let mut got = sites(&SqliteVaultRepository::open(&current).unwrap());
    got.sort();
    assert_eq!(got, vec!["alpha".to_string(), "gamma".to_string()]);
}
