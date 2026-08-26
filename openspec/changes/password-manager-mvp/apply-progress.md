# Apply Progress — Password Manager MVP (PR 1 + PR 2 + PR 3 + PR 4 / Units 1–4)

**Change**: password-manager-mvp
**PR**: 1 (Unit 1) + 2 (Unit 2) + 3 (Unit 3) + 4 (Unit 4)
**Mode**: Standard (strict_tdd: false — greenfield)
**Dates**: 2026-08-26 (PR 1), 2026-08-26 (PR 2), 2026-08-26 (PR 3), 2026-08-26 (PR 4)
**Status**: Phases 1 (1.1–1.7), 2 (2.1–2.3), 3 (3.1–3.5), and 4 (4.1–4.4) COMPLETE — `cargo test --lib` green (42 passed); `cargo test --test vault_repo` green (8 passed); `cargo build --features tauri-app` compiles; `npm test -- --run` green (43 passed); `npm run build` clean. Remaining: Phase 5 (E2E + docs).

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

# Apply Progress — Password Manager MVP (PR 4 / Unit 4)

**Change**: password-manager-mvp
**PR**: 4 (Unit 4) — LAST implementation PR of the chain (stacked-to-main, 4 of 4)
**Mode**: Standard (strict_tdd: false — greenfield, per openspec/config.yaml)
**Date**: 2026-08-26
**Status**: Phase 4 (4.1–4.4) COMPLETE — `npm test -- --run` green (43 passed, 0 failed); `npm run build` (tsc && vite build) clean; `cargo test --lib` (42) and `cargo test --test vault_repo` (8) still green (backend untouched).

## Completed Tasks (PR 4 — 4.1–4.4)

| Task | Status | Evidence |
|---|---|---|
| 4.1 `src/ui/App.tsx` — login/locked screens with Spanish irreversible-loss warnings | ✅ | Screen state machine `booting → create \| locked → unlocked`. Create screen: prominent Spanish irreversible-loss warning before master-password confirmation ("Advertencia: pérdida irreversible… no existe ningún mecanismo de recuperación"). Locked screen: same-class permanent-loss warning + login + backoff countdown. `create_vault` success → returns to the LOGIN screen (PR 3 contract: create does NOT auto-unlock). `VaultNotInitialized` (surfaced by `unlock`) switches locked → create. Auto-lock (Rust 5-min) surfaces lazily: any command rejecting `Locked` clears entries/details and shows the locked screen. `record_activity` implicit — every command touches the session in Rust. |
| 4.2 `src/ui/components.tsx` — card flip, masked password reveal/hide, form modal, delete confirm, search/filters | ✅ | `EntryCard` 3D CSS flip; back shows all six fields with Spanish labels (Sitio/Enlace/Contraseña/Correo/Usuario/Categoría); copy controls ONLY for link/password/email/username — never category (vault-ui "Non-copyable category"). `MaskedPassword` masked by default, Mostrar/Ocultar toggle, bullets never leak short-password length. `EntryFormModal` Spanish validation (El sitio es obligatorio / La contraseña es obligatoria), stays open on invalid submit. `DeleteConfirm` Spanish alertdialog ("¿Eliminar la entrada «X»?", "Esta acción no se puede deshacer."). `SearchFilters` site/category/email conjunctive. `BackoffNotice` Spanish countdown ticking to 0. `CopyButton` transient "Copiado" feedback with cleanup. |
| 4.3 `src/ui/api.tsx` + `src/ui/styles.css` — typed IPC client, scoped CSS | ✅ | Typed client covers ALL 11 Tauri commands with exact serde shapes: snake_case `master_password` inside `req`, snake_case `CopyField` variants, camelCase arg keys (single-word args → identity), `list` filters nullable. `toCommandError` normalizes Tauri rejections (unit-variant strings "Locked", externally tagged { Backoff: { seconds } }, { Store: msg }) into a typed `CommandError` kind. `CATEGORIES` const array → `Category` union type (TS skill const-types pattern). Scoped CSS with CSS variables (design decision: no Tailwind/UI kit), `.warning` prominent styling. Styles imported by components.tsx. |
| 4.4 Component tests (vault-ui) | ✅ | 43 tests across `api.test.tsx` (16 — command names/args + error normalization), `components.test.tsx` (13 — Spanish labels, flip fields, masking reveal/hide, no category copy control, invalid form, delete confirm, backoff countdown), `App.test.tsx` (14 — boot resolution, warnings, create-does-not-auto-unlock, mismatched passwords, backoff surfaced + submit disabled, explicit lock, auto-lock surfacing, flip details, copy, delete refresh, form save). `@tauri-apps/api/core` mocked via `vi.mock`; all headless in jsdom. |

## Test Results

- `npm test -- --run` (repo root): **43 passed, 0 failed** — 16 (api) + 13 (components) + 14 (App).
- `npm run build` (tsc && vite build): **clean** — type-checks all of `src/` including tests; Vite bundle 157.27 kB JS / 5.94 kB CSS (dist/).
- `cargo test --lib` (from `src-tauri/`): **42 passed, 0 failed** — untouched.
- `cargo test --test vault_repo` (from `src-tauri/`): **8 passed, 0 failed** — untouched.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command + result | `npm test -- --run` → `Test Files 3 passed (3); Tests 43 passed (43)`. Per unit: `npx vitest run src/ui/api.test.tsx` → 16 passed; `src/ui/components.test.tsx` → 13 passed; `src/ui/App.test.tsx` → 14 passed. `npm run build` → tsc clean + vite build success. |
| Runtime harness | `N/A` for this PR — the Tauri IPC is mocked headless in jsdom by design; running the real webview needs a desktop session and is the Phase 5 E2E task (5.1 `npm run tauri dev`). The full command surface is exercised against the mocked transport (exact command names/args asserted) and the Rust command layer is already proven by PR 3's 20 headless tests. |
| Rollback boundary | Delete `src/ui/{App,api,components}.tsx`, `src/ui/{App,api,components}.test.tsx`, `src/ui/test/setup.ts`, `src/ui/styles.css`; revert `main.tsx` and `vite.config.ts` setupFiles line; drop commits `4dba791`/`45bd376`/`7ec78f6`/`4708284`. No Phase 1–3 file touched (verified: only `src/ui/` + `vite.config.ts` + openspec artifacts in the diff). |

## Commits (work-unit per commit, conventional, no AI attribution)

| Commit | Unit |
|---|---|
| `4dba791 chore(test): add vitest jsdom setup with minimal polyfills` | test infra: setup.ts + vite.config.ts setupFiles |
| `45bd376 feat(ui): add typed Tauri IPC client for vault commands` | api.tsx + api.test.tsx (16 tests) |
| `7ec78f6 feat(ui): add Spanish card, form and confirmation components` | components.tsx + styles.css + components.test.tsx (13 tests) |
| `4708284 feat(ui): wire Spanish login, locked and vault screens` | App.tsx + main.tsx + App.test.tsx (14 tests) |

## Deviations from Design

- **No export UI button.** The typed client includes `api.export(path)` (contract type-checks against `export` command), but no toolbar button was added: choosing a destination requires the Tauri dialog plugin, which is not a dependency on either side (adding it would be a backend/plugin change, out of PR 4 scope). The spec's UI file list ("Login, cards/flip, form modal, filters, confirmations, and Spanish warnings") does not require an export control; export remains fully available through the command surface.
- **Boot screen detection is via `list` + `unlock`, not a dedicated command.** A fresh vault reports `Locked` from `list` (no session exists), so the UI boots to the login screen and only switches to the create screen when `unlock` rejects `VaultNotInitialized`. There is no `is_initialized` command on the wire; this flow matches the existing 11-command surface without backend changes.
- **Auto-lock is surfaced lazily, not polled.** The UI does not poll `list` while unlocked because every command touches the session clock in Rust — polling would keep the session alive and defeat the 5-minute auto-lock. Instead, the first command after a Rust-side auto-lock rejects `Locked` and the App returns to the locked screen (clearing any cached details). E2E observation of the idle timeout remains Phase 5.
- **`CopyButton` feedback timer** (1.5 s "Copiado") is frontend-only transient UI; the 20 s clipboard clear is Rust-owned and unaffected.

## Issues Found

- None blocking. Two test-rig gotchas resolved: (1) `vi.advanceTimersByTime` must be wrapped in `act()` for React 18 state updates (BackoffNotice countdown); (2) both card faces render in the DOM (CSS hides one), so text queries must be scoped to `.card-front`/`.card-back` to avoid duplicate matches.

## Remaining Tasks (later PRs)

- Phase 5 (PR 5 / final): E2E + docs — 5.1–5.2 (not part of this PR; implementation chain is now complete).

## PR Boundary

- Mode: chained PR slice (stacked-to-main), PR 4 of 4 — last implementation PR.
- Work unit: Unit 4 — Spanish React UI + component tests.
- Boundary: `src/ui/` (App, api, components, styles, main, tests, test/setup), `vite.config.ts` (setupFiles only). Deliberately excludes Phase 5 E2E/docs and all backend files.
- Review budget impact: 2,317 authored additions + 9 deletions across 12 files (above the 400-line comfort zone — but the forecast's Unit 4 anticipated this; four work-unit commits keep each review slice focused; the orchestrator resolved stacked-to-main and assigned this final slice explicitly).

## Cumulative State (all PRs)

- PR 1 (1.1–1.7): ✅ PR 2 (2.1–2.3): ✅ PR 3 (3.1–3.5): ✅ PR 4 (4.1–4.4): ✅ — Phases 1–4 complete. Remaining: Phase 5 (5.1 E2E, 5.2 docs/.gitignore).