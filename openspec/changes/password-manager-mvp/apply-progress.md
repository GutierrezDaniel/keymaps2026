# Apply Progress — Password Manager MVP (PR 1 + PR 2 / Units 1–2)

**Change**: password-manager-mvp
**PR**: 1 (Unit 1) + 2 (Unit 2)
**Mode**: Standard (strict_tdd: false — greenfield)
**Dates**: 2026-08-26 (PR 1), 2026-08-26 (PR 2)
**Status**: Phase 1 (1.1–1.7) and Phase 2 (2.1–2.3) COMPLETE — `cargo test --lib` green (14 passed, 0 failed); `cargo test --test vault_repo` green (8 passed, 0 failed)

## Completed Tasks (PR 1 — 1.1–1.7)

| Task | Status | Evidence |
|---|---|---|
| 1.1 `src-tauri/Cargo.toml` + `main.rs` Tauri v2 bootstrap | ✅ | Cargo.toml with argon2/aes-gcm/rand/zeroize/secrecy/hex/thiserror + rusqlite(bundled)/arboard + tauri(optional). `main.rs` + `desktop.rs` + `build.rs` Tauri v2 shell gated behind `tauri-app` feature. `cargo build` compiles. |
| 1.2 `package.json` + `src/ui/` React/TS/Vite scaffold | ✅ | package.json, tsconfig.json, vite.config.ts, `src/ui/index.html`, `src/ui/main.tsx` (placeholder mount only — no Phase 4 UI). |
| 1.3 `core/domain/entry.rs` types | ✅ | `RecordId([u8;16])` (hex Display/FromStr, bytes as AAD), `INITIAL_CATEGORIES`, `is_valid_category`, `EncryptedField`, `EntryRecord`, `Filters` (builder), `EntryInput`, `EntrySummary`, `EntryDetails`. |
| 1.4 `core/ports/{vault_repository,cipher,key_derivation,clipboard}.rs` | ✅ | Traits `VaultRepository`, `CipherPort`, `KeyDerivationPort`, `ClipboardPort`; `VaultKey = Secret<[u8;32]>`; safe `CryptoError`/`RepositoryError`/`ClipboardError` carrying no secrets. |
| 1.5 `core/application/vault_service.rs` use cases | ✅ | `VaultService` create/update/get_details/list/delete + category validation; unit-tested with in-memory repo + real crypto adapter. |
| 1.6 `adapters/crypto/argon2_aes.rs` | ✅ | Argon2id KDF (32-byte salt, zeroized key), AES-256-GCM with per-field 12-byte nonce + record-ID AAD, zeroize, `String::from_utf8` decode guard. |
| 1.7 vault-crypto unit tests | ✅ | 10 crypto tests: roundtrip, different salts→different keys, salt ≥16B, key=256-bit, tampered ciphertext/nonce/AAD fail auth, wrong password fails, malformed nonce/short ciphertext → `MalformedField`. |

## Completed Tasks (PR 2 — 2.1–2.3)

| Task | Status | Evidence |
|---|---|---|
| 2.1 `adapters/persistence/sqlite.rs` — `vault_metadata` + `entries` schema | ✅ | `SqliteVaultRepository` (open / open_in_memory). Schema v1 via `PRAGMA user_version` migration: `vault_metadata` singleton row (id=1, salt BLOB, validation nonce+ciphertext) + `entries` (id BLOB PK, plaintext site/link/category/email/username, password nonce+ciphertext) + category/email indexes. WAL + synchronous=FULL + foreign_keys=ON pragmas. `VaultMetadata` struct + `init_vault`/`vault_metadata`/`is_initialized` accessors (salt length ≥16 enforced). |
| 2.2 CRUD, site search, category/email filters, record ID as AAD, atomic transactions | ✅ | Implements `VaultRepository` port exactly (same types/errors/semantics): `list` builds conjunctive WHERE (site `LIKE '%x%'`, category/email `=`) with dynamic params + stable ORDER BY; `save` atomic upsert (`ON CONFLICT(id) DO UPDATE`) inside an `unchecked_transaction`; `delete` atomic, 0 rows → `RepositoryError::NotFound`. Record ID stored verbatim (16 bytes) so the crypto layer uses it as GCM AAD on decrypt. |
| 2.3 vault-storage integration tests | ✅ | `tests/vault_repo.rs` — 8 tests: save/list/update/delete + conjunctive filters, empty fresh DB, duplicate metadata with distinct IDs (update isolation), restart identity (close/reopen preserves salt + validation + IDs, key re-derived from persisted salt decrypts), plaintext absence in raw DB file, per-record nonce/ciphertext uniqueness, AAD ID-mismatch → `AuthenticationFailed`, tampered stored field → `AuthenticationFailed`. Uses real Argon2Aes + `tempfile` (dev-dep) for file-backed reopen. |

## Test Results

- `cargo test --test vault_repo` (from `src-tauri/`): **8 passed, 0 failed** — no warnings.
- `cargo test --lib` (from `src-tauri/`): **14 passed, 0 failed** — PR 1 tests stay green, no warnings.
- `cargo build` (default features): compiles. `cargo build --features tauri-app`: **also compiles on this machine** (webkit2gtk system libs present), so the desktop shell is unaffected by the new adapter.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command + result | `cargo test --test vault_repo` from `src-tauri/` → `test result: ok. 8 passed; 0 failed` (CRUD/filters, duplicates, restart identity, AAD mismatch, plaintext absence) |
| Runtime harness | `N/A` — no runnable desktop surface yet (Tauri shell compiles but commands are not registered until Phase 3); integration tests exercise the real adapter + crypto against temp databases. |
| Rollback boundary | Delete `src-tauri/src/adapters/persistence/` and `src-tauri/tests/vault_repo.rs`; revert the `adapters/mod.rs` line, the `tempfile` dev-dep, and the two commits `122aae4`/`b4f5cc6` — no Phase 1 core file is touched. |

## Deviations from Design

- **Site search is case-insensitive (SQL LIKE) while category/email filters are exact.** The PR 1 in-memory fake uses Rust `contains` (case-sensitive) for site; the SQLite adapter uses `LIKE '%x%'`, which is case-insensitive for ASCII. Matches the spec's "site-name search" intent (friendlier UX); service-level tests do not depend on case behavior. Noted here so verify does not flag it.
- **`unchecked_transaction` instead of `transaction`.** `rusqlite::Connection::transaction` requires `&mut self`, but the `VaultRepository` port methods take `&self`. `unchecked_transaction` is safe here because the adapter is `!Sync`, never shared, and holds no concurrent statements; PR 3 wraps it in a `Mutex` at the command layer. Each mutation is a single statement, so atomicity is guaranteed either way.
- **`init_vault` is an upsert (idempotent).** Design says singleton metadata; re-initializing with a new salt invalidates old derived keys, documented on the method. The PR 3 create-vault flow will only call it on a fresh DB file.
- Command DTOs from design (`UnlockRequest`, `EntrySummaryDto`, etc.) remain deferred to Phase 3 — they belong to the Tauri command boundary.

## Issues Found

- None blocking. One test-authored bug caught during implementation: the restart test initially encrypted entries with a fixed test key instead of the key derived from the vault salt — fixed so the reopen decrypts through the persisted salt (matches the real unlock flow).
- `cargo clippy` still unavailable in this toolchain (not installed) — not required for the PR.

## Remaining Tasks (later PRs)

- Phase 3 (PR 3): session/clipboard/backup/commands — 3.1–3.5
- Phase 4 (PR 4): Spanish React UI — 4.1–4.4
- Phase 5: E2E + docs — 5.1–5.2

## PR Boundary

- Mode: chained PR slice (stacked-to-main), PR 2 of 4.
- Work unit: Unit 2 — SQLite adapter + integration tests.
- Boundary: schema/migrations, `VaultRepository` CRUD with filters, metadata accessors (salt + validation), vault-storage integration tests. Deliberately excludes session, clipboard, backup, command registration, and UI (PR 3/4).
- Review budget impact: 654 authored additions (286 adapter + 346 tests + 14 lock/toml/mod wiring + 8 test-support lines), 0 deletions. Above the 400-line comfort zone as a single slice, but it is one cohesive work unit (one adapter + its integration tests) exactly as forecast in tasks.md Unit 2; the orchestrator resolved the chain strategy (stacked-to-main) and assigned this slice explicitly.