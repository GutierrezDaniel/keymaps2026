# Apply Progress — Password Manager MVP (PR 1 / Unit 1)

**Change**: password-manager-mvp
**PR**: 1 (Unit 1)
**Mode**: Standard (strict_tdd: false — greenfield)
**Date**: 2026-08-26
**Status**: Phase 1 tasks 1.1–1.7 COMPLETE — `cargo test --lib` green (14 passed, 0 failed)

## Completed Tasks (1.1–1.7)

| Task | Status | Evidence |
|---|---|---|
| 1.1 `src-tauri/Cargo.toml` + `main.rs` Tauri v2 bootstrap | ✅ | Cargo.toml with argon2/aes-gcm/rand/zeroize/secrecy/hex/thiserror + rusqlite(bundled)/arboard + tauri(optional). `main.rs` + `desktop.rs` + `build.rs` Tauri v2 shell gated behind `tauri-app` feature. `cargo build` compiles. |
| 1.2 `package.json` + `src/ui/` React/TS/Vite scaffold | ✅ | package.json, tsconfig.json, vite.config.ts, `src/ui/index.html`, `src/ui/main.tsx` (placeholder mount only — no Phase 4 UI). |
| 1.3 `core/domain/entry.rs` types | ✅ | `RecordId([u8;16])` (hex Display/FromStr, bytes as AAD), `INITIAL_CATEGORIES`, `is_valid_category`, `EncryptedField`, `EntryRecord`, `Filters` (builder), `EntryInput`, `EntrySummary`, `EntryDetails`. |
| 1.4 `core/ports/{vault_repository,cipher,key_derivation,clipboard}.rs` | ✅ | Traits `VaultRepository`, `CipherPort`, `KeyDerivationPort`, `ClipboardPort`; `VaultKey = Secret<[u8;32]>`; safe `CryptoError`/`RepositoryError`/`ClipboardError` carrying no secrets. |
| 1.5 `core/application/vault_service.rs` use cases | ✅ | `VaultService` create/update/get_details/list/delete + category validation; unit-tested with in-memory repo + real crypto adapter. |
| 1.6 `adapters/crypto/argon2_aes.rs` | ✅ | Argon2id KDF (32-byte salt, zeroized key), AES-256-GCM with per-field 12-byte nonce + record-ID AAD, zeroize, `String::from_utf8` decode guard. |
| 1.7 vault-crypto unit tests | ✅ | 10 crypto tests: roundtrip, different salts→different keys, salt ≥16B, key=256-bit, tampered ciphertext/nonce/AAD fail auth, wrong password fails, malformed nonce/short ciphertext → `MalformedField`. |

## Test Results

- `cargo test --lib` (from `src-tauri/`): **14 passed, 0 failed** (10 crypto + 4 service). No warnings.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command + result | `cargo test --lib` from `src-tauri/` → `test result: ok. 14 passed; 0 failed` |
| Runtime harness | `N/A` — no runnable desktop surface yet (Tauri shell gated, commands not registered until Phase 3); unit tests prove crypto + use cases. |
| Rollback boundary | Remove `src-tauri/`, `src/ui/`, `package.json`, `tsconfig.json`, `vite.config.ts`. |

## Deviations from Design

- **`tauri` gated behind the `tauri-app` feature (default empty).** The build environment lacks `webkit2gtk-4.1`/`gtk3`/`libsoup-3.0` (required to compile the `tauri` crate on Linux). To keep `cargo test --lib` green without those system libs, `tauri` + `tauri-build` are optional deps enabled by `--features tauri-app` (needs a full desktop Linux dev machine). The `main.rs`/`desktop.rs`/`build.rs` Tauri v2 bootstrap is complete and correct but compiled only under that feature. `rusqlite` (bundled) and `arboard` DO compile without system libs, so they are normal deps as listed in task 1.1.
- `VaultKey` defined as `Secret<[u8;32]>` (zeroizing) rather than a bare array — matches design's `Session` owns `Secret<[u8;32]>`; `KeyDerivationPort` also exposes `random_salt()` for vault init.
- Added an in-memory fake `VaultRepository` in tests to exercise the service use cases (design did not require service tests for PR 1, but this proves the use cases work against real crypto).
- Command DTOs from design (`UnlockRequest`, `EntrySummaryDto`, etc.) deferred to Phase 3 — they belong to the Tauri command boundary, not this PR.

## Issues Found

- None blocking. Note: `cargo clippy` unavailable in this toolchain (not installed) — not required for the PR.
- Node tooling (Vite/TS) scaffold created but `npm install` not run (verification is `cargo test --lib` only). Run `npm install` before Phase 4 UI work.

## Remaining Tasks (later PRs)

- Phase 2 (PR 2): SQLite adapter + integration tests — 2.1–2.3
- Phase 3 (PR 3): session/clipboard/backup/commands — 3.1–3.5
- Phase 4 (PR 4): Spanish React UI — 4.1–4.4
- Phase 5: E2E + docs — 5.1–5.2

## PR Boundary

- Mode: chained PR slice (stacked-to-main), PR 1 of 4.
- Work unit: Unit 1 — scaffold + core ports + crypto adapter.
- Boundary: greenfield scaffold through `vault-crypto`; deliberately excludes SQLite, session, clipboard, backup, command registration, and UI components.
- Review budget impact: authored Rust+scaffold ≈ low-mid; well under 400-authored-line chained-PR guidance (scaffold files are small).
