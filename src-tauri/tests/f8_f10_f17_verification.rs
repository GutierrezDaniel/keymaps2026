//! Regression probes for RUST-AUDIT F8 (primary-key lookup), F10 (no
//! unprotected plaintext copies) and F17 (`EntryInput` taken by value).
//!
//! They exercise the real SQLite adapter and the real service through their
//! public API, so they assert observable effects rather than implementation
//! details.

use std::sync::{Arc, Mutex};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use secrecy::{ExposeSecret, SecretString};
use tempfile::TempDir;

use keymaps2026_lib::adapters::backup::BackupService;
use keymaps2026_lib::adapters::crypto::argon2_aes::Argon2Aes;
use keymaps2026_lib::adapters::persistence::sqlite::SqliteVaultRepository;
use keymaps2026_lib::core::application::vault_service::{ServiceError, VaultService};
use keymaps2026_lib::core::domain::entry::{
    EncryptedField, EntryInput, EntryRecord, Filters, RecordId,
};
use keymaps2026_lib::core::ports::cipher::{CipherPort, CryptoError, VaultKey};
use keymaps2026_lib::core::ports::key_derivation::KeyDerivationPort;
use keymaps2026_lib::core::ports::vault_repository::VaultRepository;
use keymaps2026_lib::core::application::gate::SessionGate;

const MASTER_PASSWORD: &str = "hunter2";

fn rid(n: u8) -> RecordId {
    RecordId::new([n; 16])
}

fn secret(s: &str) -> SecretString {
    SecretString::from(s.to_string())
}

fn test_key() -> VaultKey {
    Argon2Aes.derive(secret(MASTER_PASSWORD), &[7u8; 16]).unwrap()
}

fn validation(key: &VaultKey) -> EncryptedField {
    Argon2Aes
        .encrypt(&rid(200), key, secret("vault-validation"))
        .unwrap()
}

/// A stored record with distinct metadata, encrypted under `key`.
fn stored_record(key: &VaultKey, id: RecordId, site: &str) -> EntryRecord {
    EntryRecord {
        id,
        site: site.to_string(),
        link: format!("https://{site}"),
        category: "servicios".to_string(),
        email: format!("{site}@example.com"),
        username: format!("user-{site}"),
        password: Argon2Aes.encrypt(&id, key, secret("stored-pw")).unwrap(),
    }
}

type Service = VaultService<SqliteVaultRepository, Argon2Aes>;

/// A file-backed service over an initialized vault plus its derived key.
fn service(dir: &TempDir) -> (Service, VaultKey) {
    let key = test_key();
    let repo = SqliteVaultRepository::open(&dir.path().join("vault.db")).unwrap();
    repo.init_vault(vec![7u8; 16], &validation(&key)).unwrap();
    (VaultService::new(repo, Argon2Aes), key)
}

fn github_input(password: &str) -> EntryInput {
    EntryInput {
        site: "github".to_string(),
        link: "https://github.com/x".to_string(),
        password: secret(password),
        email: "dev@example.com".to_string(),
        username: "octocat".to_string(),
        category: "trabajo".to_string(),
    }
}

/// F8: `get` returns exactly the stored row for a known id and `None` for an
/// unknown one.
#[test]
fn f8_get_returns_the_stored_entry_and_none_for_an_unknown_id() {
    let key = test_key();
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    repo.init_vault(vec![7u8; 16], &validation(&key)).unwrap();
    let first = stored_record(&key, rid(1), "github");
    let second = stored_record(&key, rid(2), "gitlab");
    repo.save(&first).unwrap();
    repo.save(&second).unwrap();

    assert_eq!(
        repo.get(&rid(2)).unwrap(),
        Some(second),
        "get must return the stored row verbatim, ciphertext included"
    );
    assert_eq!(repo.get(&rid(9)).unwrap(), None, "unknown id must be None");

    let got = repo.get(&rid(1)).unwrap().unwrap();
    assert_eq!(
        Argon2Aes
            .decrypt(&got.id, &key, &got.password)
            .unwrap()
            .expose_secret(),
        "stored-pw"
    );
}

/// F8: every single-entry read (details, summary, the update existence check)
/// is a primary-key lookup; the update of a missing id is still NotFound and
/// writes nothing.
#[test]
fn f8_single_entry_reads_and_the_update_guard() {
    let dir = TempDir::new().unwrap();
    let (svc, key) = service(&dir);
    let id = rid(1);
    svc.create_entry(id, &key, github_input("s3cr3t-pw")).unwrap();

    let details = svc.get_entry_details(&id, &key).unwrap();
    assert_eq!(details.summary.id, id);
    assert_eq!(details.summary.site, "github");
    assert_eq!(details.summary.link, "https://github.com/x");
    assert_eq!(details.summary.email, "dev@example.com");
    assert_eq!(details.summary.username, "octocat");
    assert_eq!(details.summary.category, "trabajo");
    assert_eq!(details.password.expose_secret(), "s3cr3t-pw");

    let summary = svc.get_entry_summary(&id).unwrap();
    assert_eq!(summary.site, "github");
    assert_eq!(summary.email, "dev@example.com");

    assert!(matches!(
        svc.get_entry_details(&rid(9), &key).unwrap_err(),
        ServiceError::NotFound
    ));
    assert!(matches!(
        svc.get_entry_summary(&rid(9)).unwrap_err(),
        ServiceError::NotFound
    ));
    assert!(matches!(
        svc.update_entry(rid(9), &key, github_input("p")).unwrap_err(),
        ServiceError::NotFound
    ));
    assert_eq!(
        svc.list_entries(&Filters::new()).unwrap().len(),
        1,
        "the rejected update must not create the missing entry"
    );
}

/// F8: a hand-edited row whose id blob is not 16 bytes makes the scan fail with
/// an error, never a panic, and does not break primary-key reads of good rows.
#[test]
fn f8_short_stored_id_blob_errors_without_panicking() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("vault.db");
    let key = test_key();
    let repo = SqliteVaultRepository::open(&path).unwrap();
    repo.init_vault(vec![7u8; 16], &validation(&key)).unwrap();
    let good = stored_record(&key, rid(1), "github");
    repo.save(&good).unwrap();

    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO entries (id, site, link, category, email, username, password_nonce, password_ciphertext)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                &[9u8; 15][..],
                "bad",
                "https://bad",
                "trabajo",
                "bad@example.com",
                "bad",
                vec![1u8; 12],
                vec![2u8; 32]
            ],
        )
        .unwrap();
    }

    assert_eq!(repo.get(&rid(1)).unwrap(), Some(good));
    assert!(repo.list(&Filters::new()).is_err());
}

/// F10: the decrypted buffer is validated in place and every failure keeps its
/// exact `CryptoError` variant (malformed nonce/ciphertext/non-UTF-8 plaintext
/// vs. authentication failure).
#[test]
fn f10_decrypt_keeps_its_error_variants() {
    let key = test_key();
    let id = rid(1);
    let good = Argon2Aes.encrypt(&id, &key, secret("s3cr3t")).unwrap();
    assert_eq!(
        Argon2Aes
            .decrypt(&id, &key, &good)
            .unwrap()
            .expose_secret(),
        "s3cr3t"
    );

    for len in [0usize, 11, 13] {
        let field = EncryptedField {
            nonce: vec![0; len],
            ciphertext: good.ciphertext.clone(),
        };
        assert_eq!(
            Argon2Aes.decrypt(&id, &key, &field).unwrap_err(),
            CryptoError::MalformedField,
            "nonce length {len}"
        );
    }

    let short = EncryptedField {
        nonce: good.nonce.clone(),
        ciphertext: vec![0; 15],
    };
    assert_eq!(
        Argon2Aes.decrypt(&id, &key, &short).unwrap_err(),
        CryptoError::MalformedField
    );

    let mut tampered = good.ciphertext.clone();
    tampered[0] ^= 0xff;
    let field = EncryptedField {
        nonce: good.nonce.clone(),
        ciphertext: tampered,
    };
    assert_eq!(
        Argon2Aes.decrypt(&id, &key, &field).unwrap_err(),
        CryptoError::AuthenticationFailed
    );
    assert_eq!(
        Argon2Aes.decrypt(&rid(2), &key, &good).unwrap_err(),
        CryptoError::AuthenticationFailed,
        "the record id is authenticated additional data"
    );

    // Authentic AES-GCM ciphertext whose plaintext is not valid UTF-8: the
    // branch F21 said no test exercised, reachable only from corrupted storage.
    let cipher = Aes256Gcm::new_from_slice(key.expose_secret()).unwrap();
    let nonce = [9u8; 12];
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &[0xff, 0xfe, 0x80],
                aad: id.as_bytes(),
            },
        )
        .unwrap();
    let field = EncryptedField {
        nonce: nonce.to_vec(),
        ciphertext,
    };
    assert_eq!(
        Argon2Aes.decrypt(&id, &key, &field).unwrap_err(),
        CryptoError::MalformedField
    );
}

/// F17: taking `EntryInput` by value keeps the old field mapping (every field
/// lands in its own column) and keeps the record id as the ciphertext AAD; the
/// created data still flows through backup export unchanged.
#[test]
fn f17_create_and_update_map_every_field_and_bind_the_id() {
    let dir = TempDir::new().unwrap();
    let (svc, key) = service(&dir);
    let id = rid(3);
    svc.create_entry(
        id,
        &key,
        EntryInput {
            site: "site-x".to_string(),
            link: "https://x.example/path".to_string(),
            password: secret("p@ss w0rd \u{2603}"),
            email: "x@example.com".to_string(),
            username: "user-x".to_string(),
            category: "estudio".to_string(),
        },
    )
    .unwrap();

    let rec = SqliteVaultRepository::open(&dir.path().join("vault.db"))
        .unwrap()
        .get(&id)
        .unwrap()
        .expect("created entry must be stored under the requested id");
    assert_eq!(rec.id, id);
    assert_eq!(rec.site, "site-x");
    assert_eq!(rec.link, "https://x.example/path");
    assert_eq!(rec.email, "x@example.com");
    assert_eq!(rec.username, "user-x");
    assert_eq!(rec.category, "estudio");
    assert_eq!(
        Argon2Aes
            .decrypt(&rec.id, &key, &rec.password)
            .unwrap()
            .expose_secret(),
        "p@ss w0rd \u{2603}"
    );
    assert_eq!(
        Argon2Aes.decrypt(&rid(9), &key, &rec.password).unwrap_err(),
        CryptoError::AuthenticationFailed
    );

    svc.update_entry(
        id,
        &key,
        EntryInput {
            site: "site-y".to_string(),
            link: "https://y.example".to_string(),
            password: secret("new-pw"),
            email: "y@example.com".to_string(),
            username: "user-y".to_string(),
            category: "trabajo".to_string(),
        },
    )
    .unwrap();
    let updated = SqliteVaultRepository::open(&dir.path().join("vault.db"))
        .unwrap()
        .get(&id)
        .unwrap()
        .unwrap();
    assert_eq!(updated.site, "site-y");
    assert_eq!(updated.link, "https://y.example");
    assert_eq!(updated.email, "y@example.com");
    assert_eq!(updated.username, "user-y");
    assert_eq!(updated.category, "trabajo");
    assert_eq!(
        Argon2Aes
            .decrypt(&updated.id, &key, &updated.password)
            .unwrap()
            .expose_secret(),
        "new-pw"
    );

    // The entry created on the by-value path survives a backup export intact.
    drop(svc);
    let repo = Arc::new(Mutex::new(
        SqliteVaultRepository::open(&dir.path().join("vault.db")).unwrap(),
    ));
    let dest = dir.path().join("backup.db");
    BackupService::new(Arc::clone(&repo))
        .export(SessionGate::Unlocked, &dest)
        .unwrap();
    let exported = SqliteVaultRepository::open(&dest)
        .unwrap()
        .get(&id)
        .unwrap()
        .expect("exported entry must be found");
    assert_eq!(exported.site, "site-y");
    assert_eq!(
        Argon2Aes
            .decrypt(&exported.id, &key, &exported.password)
            .unwrap()
            .expose_secret(),
        "new-pw"
    );
}
