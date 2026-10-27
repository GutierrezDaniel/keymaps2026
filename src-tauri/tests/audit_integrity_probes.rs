//! Regression probes for `RUST-AUDIT.md`:
//! - F3: `checkpoint()` refuses a WAL that was only partially checkpointed.
//! - F4: the safe `RecordId` rendering is the same 32-character lowercase hex.
//!
//! The F25 escaping probe lives with the search test in `tests/vault_repo.rs`.

use secrecy::SecretString;
use tempfile::TempDir;

use keymaps2026_lib::adapters::crypto::argon2_aes::Argon2Aes;
use keymaps2026_lib::adapters::persistence::sqlite::SqliteVaultRepository;
use keymaps2026_lib::core::domain::entry::{EntryRecord, RecordId};
use keymaps2026_lib::core::ports::cipher::{CipherPort, VaultKey};
use keymaps2026_lib::core::ports::key_derivation::KeyDerivationPort;
use keymaps2026_lib::core::ports::vault_repository::{RepositoryError, VaultRepository};

fn key() -> VaultKey {
    Argon2Aes
        .derive(
            SecretString::from("correct horse battery staple".to_string()),
            &[7u8; 16],
        )
        .unwrap()
}

fn rid(n: u8) -> RecordId {
    RecordId([n; 16])
}

fn save(repo: &SqliteVaultRepository, key: &VaultKey, id: RecordId, site: &str) {
    let password = Argon2Aes
        .encrypt(&id, key, SecretString::from("pw".to_string()))
        .unwrap();
    repo.save(&EntryRecord {
        id,
        site: site.to_string(),
        link: format!("https://{site}"),
        category: "servicios".to_string(),
        email: "a@b.c".to_string(),
        username: "user".to_string(),
        password,
    })
    .unwrap();
}

/// F3: `PRAGMA wal_checkpoint` reports `-1` for both counters when there is no
/// WAL file, which must stay a success.
#[test]
fn f3_checkpoint_on_empty_wal_succeeds() {
    SqliteVaultRepository::open_in_memory()
        .unwrap()
        .checkpoint()
        .expect("empty in-memory WAL must checkpoint successfully");
    let dir = TempDir::new().unwrap();
    SqliteVaultRepository::open(dir.path().join("v.db"))
        .unwrap()
        .checkpoint()
        .expect("empty file WAL must checkpoint successfully");
}

/// F3: a checkpoint blocked by a live reader leaves frames in the WAL. The
/// pragma still returns `Ok`, so the row must be inspected.
#[test]
fn f3_checkpoint_refuses_a_reader_blocked_partial_checkpoint() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("v.db");
    let repo = SqliteVaultRepository::open(&path).unwrap();
    let k = key();
    save(&repo, &k, rid(1), "git");

    // A reader holding a snapshot pins the WAL: later commits cannot be
    // checkpointed into the main database file.
    let reader = rusqlite::Connection::open(&path).unwrap();
    reader
        .execute_batch("BEGIN; SELECT count(*) FROM entries;")
        .unwrap();
    save(&repo, &k, rid(2), "gitlab");

    let result = repo.checkpoint();
    reader.execute_batch("COMMIT").unwrap();
    match result {
        Err(RepositoryError::Store(msg)) => assert!(
            msg.starts_with("wal checkpoint incomplete"),
            "unexpected message: {msg}"
        ),
        other => panic!("blocked checkpoint must be refused, got {other:?}"),
    }
}

/// F4: replacing `unsafe` + `from_utf8_unchecked` must not change rendering.
#[test]
fn f4_record_id_display_is_32_lowercase_hex() {
    let bytes: [u8; 16] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    ];
    let rendered = RecordId(bytes).to_string();
    assert_eq!(rendered, "000102030405060708090a0b0c0d0e0f");
    assert_eq!(rendered, hex::encode(bytes));
    assert_eq!(
        RecordId([0xab; 16]).to_string(),
        "abababababababababababababababab"
    );
}
