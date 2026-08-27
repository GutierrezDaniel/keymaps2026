//! Vault-storage integration tests (spec: `openspec/specs/vault-storage/spec.md`).
//!
//! These tests exercise the SQLite adapter through the real crypto adapter
//! (Argon2id KDF + AES-256-GCM), proving:
//! - CRUD and conjunctive filters against a real database;
//! - duplicate metadata is allowed with distinct record IDs;
//! - identity survives a close/reopen (restart);
//! - the password is never stored in plaintext and stays bound to its record
//!   ID (AAD mismatch fails authentication).

use std::path::PathBuf;

use secrecy::{ExposeSecret, SecretString};
use tempfile::TempDir;

use keymaps2026_lib::adapters::crypto::argon2_aes::Argon2Aes;
use keymaps2026_lib::adapters::persistence::sqlite::SqliteVaultRepository;
use keymaps2026_lib::core::domain::entry::{EncryptedField, EntryRecord, Filters, RecordId};
use keymaps2026_lib::core::ports::cipher::{CipherPort, CryptoError, VaultKey};
use keymaps2026_lib::core::ports::key_derivation::KeyDerivationPort;
use keymaps2026_lib::core::ports::vault_repository::{RepositoryError, VaultRepository};

const MASTER_PASSWORD: &str = "correct horse battery staple";

/// A crypto adapter used both as KDF and as cipher.
fn crypto() -> Argon2Aes {
    Argon2Aes
}

/// Derive a deterministic key from a fixed salt (independent of vault init).
fn test_key() -> VaultKey {
    crypto().derive(secret(MASTER_PASSWORD), &[7u8; 16]).unwrap()
}

fn secret(s: &str) -> SecretString {
    SecretString::from(s.to_string())
}

fn rid(n: u8) -> RecordId {
    RecordId([n; 16])
}

/// Build a full encrypted record for `site`, encrypting `password` under `key`.
fn record(key: &VaultKey, id: RecordId, site: &str, email: &str, category: &str, password: &str) -> EntryRecord {
    let encrypted = crypto()
        .encrypt(&id, key, secret(password))
        .expect("encryption must succeed");
    EntryRecord {
        id,
        site: site.to_string(),
        link: format!("https://{site}"),
        category: category.to_string(),
        email: email.to_string(),
        username: "user".to_string(),
        password: encrypted,
    }
}

/// Convenience: save a record and return it.
fn save(repo: &SqliteVaultRepository, key: &VaultKey, id: RecordId, site: &str, password: &str) -> EntryRecord {
    let e = record(key, id, site, "a@b.c", "servicios", password);
    repo.save(&e).expect("save must succeed");
    e
}

/// Save a record with a specific email (the `save` helper fixes "a@b.c").
fn save_with_email(
    repo: &SqliteVaultRepository,
    key: &VaultKey,
    id: RecordId,
    site: &str,
    email: &str,
) -> EntryRecord {
    let e = record(key, id, site, email, "servicios", "pw");
    repo.save(&e).expect("save must succeed");
    e
}

/// A file-backed repository plus the temp dir that owns its database file.
struct Db {
    _dir: TempDir,
    path: PathBuf,
}

impl Db {
    fn new() -> Self {
        let dir = TempDir::new().expect("temp dir must be creatable");
        let path = dir.path().join("vault.db");
        Self { _dir: dir, path }
    }
}

/// The stored password ciphertext of `entry` read directly from SQLite,
/// bypassing the adapter — used to assert plaintext absence.
fn stored_ciphertext(path: &std::path::Path, id: &RecordId) -> Vec<u8> {
    let conn = rusqlite::Connection::open(path).expect("raw open must succeed");
    conn.query_row(
        "SELECT password_ciphertext FROM entries WHERE id = ?1",
        [id.as_bytes().as_slice()],
        |r| r.get(0),
    )
    .expect("entry must exist")
}

// ---------------------------------------------------------------------------
// CRUD and filters (vault-storage: "Persist a complete entry", vault-entries
// "Search and filters").
// ---------------------------------------------------------------------------

#[test]
fn save_list_update_delete_roundtrip() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();

    // Create three entries in different categories.
    let a = save(&repo, &key, rid(1), "github", "gh-secret");
    let b = save(&repo, &key, rid(2), "gitlab", "gl-secret");
    save(&repo, &key, rid(3), "amazon", "am-secret");

    // Full list returns everything.
    let all = repo.list(&Filters::new()).unwrap();
    assert_eq!(all.len(), 3);

    // Site search is a substring match.
    let hits = repo.list(&Filters::new().with_site("git")).unwrap();
    assert_eq!(hits.len(), 2);
    assert!(hits.iter().all(|e| e.site.contains("git")));

    // Category filter is exact.
    let cats = repo.list(&Filters::new().with_category("servicios")).unwrap();
    assert_eq!(cats.len(), 3);
    let none = repo
        .list(&Filters::new().with_category("entretenimiento"))
        .unwrap();
    assert!(none.is_empty());

    // Email filter is exact and combines conjunctively with site search.
    let em = repo.list(&Filters::new().with_email("a@b.c")).unwrap();
    assert_eq!(em.len(), 3);
    let combined = repo
        .list(&Filters::new().with_site("git").with_category("servicios"))
        .unwrap();
    assert_eq!(combined.len(), 2);

    // Update b: same id, new metadata and a re-encrypted password.
    let updated = EntryRecord {
        site: "gitlab-ce".into(),
        link: "https://gitlab-ce".into(),
        category: "trabajo".into(),
        email: "b@b.c".into(),
        username: "user".into(),
        password: crypto()
            .encrypt(&b.id, &key, secret("new-secret"))
            .unwrap(),
        ..b.clone()
    };
    repo.save(&updated).unwrap();

    let after = repo.list(&Filters::new().with_site("gitlab-ce")).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, b.id);
    assert_eq!(after[0].category, "trabajo");
    let recovered = crypto()
        .decrypt(&after[0].id, &key, &after[0].password)
        .unwrap();
    assert_eq!(recovered.expose_secret(), "new-secret");

    // The other records are untouched by the update.
    let a_after = repo.list(&Filters::new().with_site("github")).unwrap();
    assert_eq!(a_after.len(), 1);
    assert_eq!(a_after[0].id, a.id);

    // Delete removes only the targeted record.
    repo.delete(&rid(3)).unwrap();
    assert!(repo.list(&Filters::new().with_site("amazon")).unwrap().is_empty());
    assert_eq!(repo.list(&Filters::new()).unwrap().len(), 2);

    // Deleting a missing id reports NotFound.
    assert_eq!(
        repo.delete(&rid(3)).unwrap_err(),
        RepositoryError::NotFound
    );
}

#[test]
fn list_without_filters_is_empty_on_fresh_db() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    assert!(repo.list(&Filters::new()).unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Distinct email list (email selector source).
// ---------------------------------------------------------------------------

#[test]
fn list_emails_returns_each_distinct_email_once() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();

    save_with_email(&repo, &key, rid(1), "site-a", "a@example.com");
    save_with_email(&repo, &key, rid(2), "site-b", "a@example.com");

    let emails = repo.list_emails().unwrap();
    assert_eq!(emails, vec!["a@example.com".to_string()]);
}

#[test]
fn list_emails_excludes_empty_emails() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();

    save_with_email(&repo, &key, rid(1), "site-a", "a@example.com");
    save_with_email(&repo, &key, rid(2), "site-b", "");

    let emails = repo.list_emails().unwrap();
    assert_eq!(emails, vec!["a@example.com".to_string()]);
}

#[test]
fn list_emails_orders_ascending() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();

    save_with_email(&repo, &key, rid(1), "site-a", "z@example.com");
    save_with_email(&repo, &key, rid(2), "site-b", "m@example.com");
    save_with_email(&repo, &key, rid(3), "site-c", "a@example.com");

    let emails = repo.list_emails().unwrap();
    assert_eq!(
        emails,
        vec![
            "a@example.com".to_string(),
            "m@example.com".to_string(),
            "z@example.com".to_string(),
        ]
    );
}

#[test]
fn list_emails_is_empty_on_fresh_vault() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    assert!(repo.list_emails().unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Duplicates (vault-storage: "Duplicate metadata is allowed").
// ---------------------------------------------------------------------------

#[test]
fn identical_metadata_saves_twice_with_distinct_ids() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();

    let e1 = save(&repo, &key, rid(1), "dupesite", "one");
    let e2 = save(&repo, &key, rid(2), "dupesite", "two");

    let hits = repo.list(&Filters::new().with_site("dupesite")).unwrap();
    assert_eq!(hits.len(), 2);
    assert_ne!(hits[0].id, hits[1].id);

    // Updating one does not change the other.
    let mut patch = e1.clone();
    patch.password = crypto().encrypt(&e1.id, &key, secret("updated")).unwrap();
    repo.save(&patch).unwrap();

    let hits = repo.list(&Filters::new().with_site("dupesite")).unwrap();
    assert_eq!(hits.len(), 2);
    let other = hits.iter().find(|e| e.id == e2.id).unwrap();
    assert_eq!(
        crypto().decrypt(&other.id, &key, &other.password).unwrap().expose_secret(),
        "two"
    );
}

// ---------------------------------------------------------------------------
// Restart identity (vault-storage: "Read after restart") + salt/validation
// persistence (vault-crypto: "Create a vault key").
// ---------------------------------------------------------------------------

#[test]
fn records_and_metadata_survive_reopen() {
    let db = Db::new();

    {
        let repo = SqliteVaultRepository::open(&db.path).unwrap();
        assert!(!repo.is_initialized().unwrap());

        // Initialize the vault with a random salt and derive the key from it,
        // exactly like the future unlock flow will.
        let salt = crypto().random_salt();
        assert!(salt.len() >= 16);
        let key = crypto().derive(secret(MASTER_PASSWORD), &salt).unwrap();
        let validation = crypto()
            .encrypt(&rid(9), &key, secret("vault-validation"))
            .unwrap();
        repo.init_vault(salt.clone(), &validation).unwrap();
        assert!(repo.is_initialized().unwrap());

        // Persist entries encrypted under the vault key.
        let a = save(&repo, &key, rid(1), "github", "gh-secret");
        let b = save(&repo, &key, rid(2), "gitlab", "gl-secret");
        assert_eq!(repo.list(&Filters::new()).unwrap().len(), 2);

        // Simulate a restart: drop the connection (repo goes out of scope).
        drop(repo);
        // Keep the ciphertexts alive to prove identity across the restart.
        let _ = (a.password.clone(), b.password.clone());
    }

    // Reopen the same file — a brand new process-level connection.
    let repo = SqliteVaultRepository::open(&db.path).unwrap();

    // Salt + validation metadata survived.
    let meta = repo.vault_metadata().unwrap().expect("vault must be initialized");
    assert!(meta.salt.len() >= 16);

    // Same record IDs and encrypted context are available.
    let all = repo.list(&Filters::new()).unwrap();
    assert_eq!(all.len(), 2);
    let github = all.iter().find(|e| e.site == "github").unwrap();
    assert_eq!(github.id, rid(1));

    // The key derived from the persisted salt recovers the password.
    let reopened_key = crypto().derive(secret(MASTER_PASSWORD), &meta.salt).unwrap();
    let recovered = crypto()
        .decrypt(&github.id, &reopened_key, &github.password)
        .unwrap();
    assert_eq!(recovered.expose_secret(), "gh-secret");
}

// ---------------------------------------------------------------------------
// Plaintext absence + record identity (vault-storage: "Inspect stored data",
// "Record identity mismatch").
// ---------------------------------------------------------------------------

#[test]
fn password_is_not_stored_in_plaintext() {
    let db = Db::new();
    let repo = SqliteVaultRepository::open(&db.path).unwrap();
    let key = test_key();
    let e = save(&repo, &key, rid(1), "github", "super-secret-value");

    let ciphertext = stored_ciphertext(&db.path, &e.id);
    // Ciphertext carries the 16-byte GCM tag and must never equal plaintext.
    assert_eq!(ciphertext.len(), "super-secret-value".len() + 16);
    assert_ne!(ciphertext, b"super-secret-value");

    // The plaintext must not appear anywhere in the raw database bytes.
    let raw = std::fs::read(&db.path).unwrap();
    assert!(
        !find_subslice(&raw, b"super-secret-value"),
        "plaintext password leaked into the database file"
    );
}

#[test]
fn same_plaintext_encrypts_to_different_ciphertext_per_record() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();
    let a = save(&repo, &key, rid(1), "site1", "same-password");
    let b = save(&repo, &key, rid(2), "site2", "same-password");
    assert_ne!(a.password.ciphertext, b.password.ciphertext);
    assert_ne!(a.password.nonce, b.password.nonce);
}

#[test]
fn decryption_with_wrong_record_id_fails_authentication() {
    let db = Db::new();
    let repo = SqliteVaultRepository::open(&db.path).unwrap();
    let key = test_key();

    // Encrypt for record A, store it, and read the stored field back.
    let a = save(&repo, &key, rid(1), "github", "bound-to-a");
    let field: EncryptedField = {
        let all = repo.list(&Filters::new()).unwrap();
        let stored = all.iter().find(|e| e.id == rid(1)).unwrap();
        stored.password.clone()
    };
    assert_eq!(field, a.password);

    // Associating the same encrypted data with a different record ID must fail
    // authentication and must never return the plaintext.
    let err = crypto().decrypt(&rid(2), &key, &field).unwrap_err();
    assert_eq!(err, CryptoError::AuthenticationFailed);
}

#[test]
fn tampered_stored_field_fails_on_readback() {
    let repo = SqliteVaultRepository::open_in_memory().unwrap();
    let key = test_key();
    let mut e = save(&repo, &key, rid(1), "github", "tamper-me");
    // Corrupt one ciphertext byte after storage (simulates disk corruption or a
    // tampered file).
    let last = e.password.ciphertext.len() - 1;
    e.password.ciphertext[last] ^= 0xFF;
    repo.save(&e).unwrap();

    let all = repo.list(&Filters::new()).unwrap();
    let err = crypto()
        .decrypt(&all[0].id, &key, &all[0].password)
        .unwrap_err();
    assert_eq!(err, CryptoError::AuthenticationFailed);
}

/// Rust `slice::windows`-based byte search (no external dep needed in tests).
fn find_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}
