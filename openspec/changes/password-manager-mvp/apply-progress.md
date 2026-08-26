# Apply Progress — Password Manager MVP (PR 1 + PR 2 + PR 3 / Units 1–3)

**Change**: password-manager-mvp
**PR**: 1 (Unit 1) + 2 (Unit 2) + 3 (Unit 3)
**Mode**: Standard (strict_tdd: false — greenfield)
**Dates**: 2026-08-26 (PR 1), 2026-08-26 (PR 2), 2026-08-26 (PR 3)
**Status**: Phases 1 (1.1–1.7), 2 (2.1–2.3), and 3 (3.1–3.5) COMPLETE — `cargo test --lib` green (42 passed, 0 failed); `cargo test --test vault_repo` green (8 passed, 0 failed); `cargo build --features tauri-app` compiles.

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
| 2.2 CRUD, site search, category/email filters, record ID as AAD, atomic transactions | ✅ | Implements `VaultRepository` port exactly: `list` builds conjunctive WHERE (site `LIKE '%x%'`, category/email `=`) with dynamic params + stable ORDER BY; `save` atomic upsert (`ON CONFLICT(id) DO UPDATE`) inside an `unchecked_transaction`; `delete` atomic, 0 rows → `RepositoryError::NotFound`. Record ID stored verbatim (16 bytes) so the crypto layer uses it as GCM AAD on decrypt. |
| 2.3 vault-storage integration tests | ✅ | `tests/vault_repo.rs` — 8 tests: save/list/update/delete + conjunctive filters, empty fresh DB, duplicate metadata with distinct IDs, restart identity (close/reopen preserves salt + validation + IDs, key re-derived from persisted salt decrypts), plaintext absence in raw DB file, per-record nonce/ciphertext uniqueness, AAD ID-mismatch → `AuthenticationFailed`, tampered stored field → `AuthenticationFailed`. |

## Completed Tasks (PR 3 — 3.1–3.5)

| Task | Status | Evidence |
|---|---|---|
| 3.1 `adapters/clipboard.rs` — 20s conditional clear (arboard) | ✅ | `Clipboard` implements `ClipboardPort`: `copy_for` places the value (zeroizing comparison copy) and spawns a thread that after `CLIPBOARD_EXPIRY` (20s) re-reads the clipboard and clears only when the value is unchanged — a newer user copy is never destroyed. Backend injectable (`SystemClipboard` boundary, `pub(crate)`) so tests run headless. 3 tests: value placed, cleared after expiry, not cleared when overwritten. |
| 3.2 `adapters/backup.rs` — encrypted export, refuse locked/failed, no partial file | ✅ | `BackupService::export(unlocked, dest)`: refuses when locked (`BackupError::Locked`) or when no backing file exists (`NoVaultFile`); WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`, new `SqliteVaultRepository::checkpoint`) so recent commits are included; writes to `<dest>.tmp` then atomically renames, removing the temp file on failure. Backup = consistent copy of the native vault DB (passwords encrypted at rest, no plaintext secrets; metadata plaintext by design). 5 tests: refused locked (no files), no backing file, failure leaves no partial file, valid native backup without plaintext + restorable via persisted salt, encrypted field context preserved verbatim. |
| 3.3 `adapters/tauri.rs` — typed commands, `Arc<Mutex<Option<Session>>>`, 5-min auto-lock, backoff 1,2,4,8,16s cap 60s | ✅ | `VaultApp` state (repo `Arc<Mutex<…>>`, service, `session: Arc<Mutex<Option<Session>>>`, backoff, clipboard, backup). `Session` owns the `VaultKey` and zeroizes on lock (explicit replace-with-zeros + secrecy drop guarantee). `BackoffPolicy`: 5 free failures, then 1,2,4,8,16,32s… capped 60s, reset on success, configurable limit. Auto-lock: `SESSION_TIMEOUT` 5 min, lazy per command + background thread (interval 5s). 11 typed commands with serde DTOs (`SecretString` fields serialized via `serialize_with`). 20 tests (below). |
| 3.4 Register commands/state in the Tauri shell | ✅ | `adapters::tauri::build` manages `VaultApp` (vault.db in `app_data_dir`), registers all 11 commands via `generate_handler!`, spawns the auto-lock thread; wired into `desktop::run` (which `main.rs` boots). `cargo build --features tauri-app` compiles with the new registrations. |
| 3.5 Unit tests: backoff/cap/reset, lock zeroizes secrets, export refusal/atomicity | ✅ | Backoff: free-up-to-limit, increasing 1/2/4/8/16, cap at 60 stays, success resets, configurable limit. Zeroize: `lock_zeroizes_session_key_bytes` (read-after-zeroize), `dropping_session_zeroizes_key_via_secret_drop` (drop_in_place on a boxed session, memory inspected), `app_lock_clears_session`. Auto-lock: expired locks, active stays, record_activity touches. Lifecycle: create→unlock roundtrip (wrong password, already-initialized, not-initialized), backoff enforced through the command surface, success resets. Entries: CRUD roundtrip, refused when locked, filters. Clipboard: password + link/email/username placed, refused when locked. Export: refused locked, exports when unlocked (reopened backup initialized). |

## Test Results

- `cargo test --lib` (from `src-tauri/`): **42 passed, 0 failed, 0 warnings** — 14 (PR 1) + 3 (clipboard) + 5 (backup) + 20 (session/backoff/commands).
- `cargo test --test vault_repo` (from `src-tauri/`): **8 passed, 0 failed** — PR 2 tests stay green after the `SqliteVaultRepository` path/checkpoint additions.
- `cargo build` (default features): compiles, no warnings. `cargo build --features tauri-app`: **compiles** (webkit2gtk system libs present) with state management + 11 command registrations.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command + result | `cargo test --lib` from `src-tauri/` → `test result: ok. 42 passed; 0 failed` (backoff/cap/reset, lock zeroize, auto-lock, unlock/backoff, CRUD commands, copy_field, export refusal/atomicity, clipboard conditional clear) |
| Runtime harness | `N/A` for this PR — the Tauri shell compiles with `--features tauri-app` (verified) but running it needs a desktop session; E2E unlock→copy→auto-lock is Phase 5 (task 5.1). The command surface is exercised headlessly through `VaultApp` with the in-memory repo + fake clipboard. |
| Rollback boundary | Delete `src-tauri/src/adapters/{clipboard,backup,tauri}.rs`; revert `adapters/mod.rs` lines, `desktop.rs`, `main.rs`, and the Cargo.toml serde/secrecy-serde lines; drop commits `9201372`/`7eda8c3`/`780431b`/`738185d`. The only Phase 2 file touched is `sqlite.rs` (added `path` field + `db_path()`/`checkpoint()` — reverting is safe: `open`/`open_in_memory` behavior unchanged). No Phase 1 core file touched. |

## Deviations from Design

- **Eleven commands, not ten.** The design's Tauri-boundary table names exactly 10 (`unlock`, `lock`, `list`, `get_entry_details`, `create`, `update`, `delete`, `export`, `copy_field`, `record_activity`) but the task assignment for PR 3 explicitly requires `vault create/init`, and the design's own data flow starts with vault creation; the PR 2 progress notes assumed a create-vault command. Implemented `create_vault` as the 11th typed command. tasks.md's "10 typed commands" is therefore off by one.
- **`SecretString` in DTOs needed `serialize_with`.** secrecy 0.8 deliberately does not implement `SerializableSecret` for `String`, so `Secret<T>: Serialize` is not derived for `SecretString`. Secret DTO fields carry `#[serde(serialize_with = "serialize_secret")]`, which serializes the plaintext the frontend needs while `Debug` stays masked. Design's DTO types (SecretString) preserved exactly.
- **Backoff is enforced by rejecting the next attempt, not sleeping.** `unlock` checks `delay_before_next_attempt()` and returns `Backoff { seconds }` instead of blocking; the frontend shows the countdown. Matches the spec's "delayed or rejected". The sequence after 5 free failures is 1, 2, 4, 8, 16, then 32 and 60 (doubling with a 60s cap — "capped at 60").
- **Registration lives in `desktop.rs`, not `main.rs`.** `main.rs` is the thin bin shim delegating to `desktop::run` (structure from PR 1); the state/command wiring was added to `desktop.rs` via `adapters::tauri::build`. Same effect, keeps the headless/tauri-app gating clean.
- **`create_vault` does not auto-unlock.** The user unlocks explicitly afterwards, matching the design's create → unlock flow; noted for Phase 4 UI.
- **Backup is a consistent copy of the native SQLite vault** (after `wal_checkpoint(TRUNCATE)`), not a new serialized format. The vault's native format already stores passwords as nonce+ciphertext, so the copy is encrypted at the secret level and preserves every restore artifact; verified no plaintext password in the raw backup bytes.
- **Auto-lock interval 5s** — `SESSION_TIMEOUT` is 5 minutes; the background thread checks every 5s, so the lock fires within 5s of the timeout. `is_locked()`/command entry also run the check lazily.

## Issues Found

- None blocking. One compile-level discovery: `tauri::Builder` in tauri 2.11 takes a runtime generic (`Builder<Wry>`), and secrecy 0.8's serde story differs from the design's assumption (see deviations). `cargo clippy` is still unavailable in this toolchain (not installed) — not required for the PR.

## Remaining Tasks (later PRs)

- Phase 4 (PR 4): Spanish React UI — 4.1–4.4
- Phase 5: E2E + docs — 5.1–5.2

## PR Boundary

- Mode: chained PR slice (stacked-to-main), PR 3 of 4.
- Work unit: Unit 3 — session, clipboard, backup, Tauri commands.
- Boundary: `adapters/{clipboard,backup,tauri}.rs`, `sqlite.rs` path/checkpoint additions, shell registration (desktop.rs/main.rs), Cargo.toml serde wiring. Deliberately excludes the React UI (PR 4) and E2E/docs (PR 5).
- Review budget impact: 1,611 authored additions + 14 deletions (above the 400-line comfort zone, but one cohesive work unit exactly as forecast in tasks.md Unit 3: commands + session + two adapters + their tests; the orchestrator resolved the chain strategy — stacked-to-main — and assigned this slice explicitly).