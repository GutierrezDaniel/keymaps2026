# Tasks: Password Manager MVP

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2,500–3,500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Scaffold + core ports + crypto adapter | PR 1 | `cargo test --lib` | N/A — no runnable surface yet; unit tests prove crypto | Remove `src-tauri/`, `src/ui/`, `package.json` |
| 2 | SQLite adapter + integration tests | PR 2 | `cargo test --test vault_repo` | N/A — temp-DB tests; GUI not wired | Delete `adapters/persistence/sqlite.rs` and tests |
| 3 | Session, clipboard, backup, Tauri commands | PR 3 | `cargo test --lib` | `npm run tauri dev` — unlock→copy→auto-lock | Revert `main.rs` registrations + drop 3 adapter files |
| 4 | Spanish React UI + component tests | PR 4 | `npm test -- --run` | `npm run tauri dev` — full Spanish flow | Remove `src/ui/` components/styles |

Threat matrix: all N/A — no RED-test tasks.

## Phase 1: Scaffold & Core

- [x] 1.1 Create `src-tauri/Cargo.toml` + `main.rs` Tauri v2 bootstrap (argon2, aes-gcm, rusqlite, arboard, zeroize)
- [x] 1.2 Create `package.json` + `src/ui/` React/TS/Vite scaffold
- [x] 1.3 Create `src-tauri/src/core/domain/entry.rs` — types, RecordId, initial categories
- [x] 1.4 Create `src-tauri/src/core/ports/{vault_repository,cipher,key_derivation,clipboard}.rs` traits
- [x] 1.5 Create `src-tauri/src/core/application/vault_service.rs` use cases
- [x] 1.6 Create `src-tauri/src/adapters/crypto/argon2_aes.rs` — Argon2id, AES-256-GCM nonce/AAD, zeroize, safe errors
- [x] 1.7 Unit tests: KDF/AEAD tampering, wrong password, malformed field (vault-crypto)

## Phase 2: Persistence

- [x] 2.1 Create `src-tauri/src/adapters/persistence/sqlite.rs` — `vault_metadata` salt/validation + `entries` schema
- [x] 2.2 Implement CRUD, site search, category/email filters, record ID as AAD, atomic transactions
- [x] 2.3 Integration tests: CRUD/filters, duplicates, restart identity, ID mismatch (vault-storage)

## Phase 3: Session, Backup, Commands

- [x] 3.1 Create `src-tauri/src/adapters/clipboard.rs` — 20s conditional clear (arboard)
- [x] 3.2 Create `src-tauri/src/adapters/backup.rs` — encrypted export, refuse locked/failed, no partial file
- [x] 3.3 Create `src-tauri/src/adapters/tauri.rs` — 10 typed commands, `Arc<Mutex<Option<Session>>>`, 5-min auto-lock, backoff 1,2,4,8,16s cap 60s
- [x] 3.4 Register commands/state in `src-tauri/src/main.rs`
- [x] 3.5 Unit tests: backoff/cap/reset, lock zeroizes secrets, export refusal/atomicity (vault-session, vault-backup)

## Phase 4: UI

- [x] 4.1 Create `src/ui/App.tsx` — login/locked screens with Spanish irreversible-loss warnings
- [x] 4.2 Create `src/ui/components.tsx` — card flip, masked password reveal/hide, form modal, delete confirm, search/filters
- [x] 4.3 Create `src/ui/api.tsx` + `src/ui/styles.css` — typed IPC client, scoped CSS
- [x] 4.4 Component tests: Spanish labels, masking, flip fields, warnings, confirmation, invalid form (vault-ui)

## Phase 5: Verification & Docs

- [ ] 5.1 `npm run tauri dev` E2E: create→unlock→search→copy→auto-lock
- [x] 5.2 README + `.gitignore` (vault DB/backups), remove debug code