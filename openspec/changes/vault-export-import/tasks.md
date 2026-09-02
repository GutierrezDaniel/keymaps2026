# Tasks: Vault Export and Import

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 Rust/storage; PR 2 Tauri/plugin; PR 3 UI/tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — ask before apply |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Import service, SQLite swap, export regression | PR 1 | `cd src-tauri && cargo test` | SQLite integration; no desktop harness | Revert core/SQLite/backup |
| 2 | Commands, `Arc<VaultApp>`, plugin, capability | PR 2 | `cd src-tauri && cargo test` | N/A: no Tauri harness | Revert Tauri/config/dependencies |
| 3 | React dialogs, header/modal/feedback/tests | PR 3 | `npm test && npm run build` | N/A: no E2E; mock plugin/invoke | Revert `src/ui/` |

## Slice 1: Rust Core, Storage, and Export

### Phase 1: Application Contracts
- [x] 1.1 Create `src-tauri/src/core/ports/vault_import_storage.rs` with `VaultImportStorage`, secret-free `ImportStorageError`, and validate/replace methods; export from `src-tauri/src/core/ports/mod.rs`.
- [x] 1.2 Create `src-tauri/src/core/application/vault_import_service.rs` (export from `src-tauri/src/core/application/mod.rs`) with explicit `unlocked`/`confirmed`, preview validation, confirmed revalidation, and `ConfirmationRequired`/`Applied`.

### Phase 2: SQLite and Backup Implementation
- [x] 2.1 Modify `src-tauri/src/adapters/persistence/sqlite.rs` to validate with `PRAGMA query_only` (or staged temp copy), schema, initialized metadata, and salt/AEAD lengths; perform no migration/write.
- [x] 2.2 In `src-tauri/src/adapters/persistence/sqlite.rs`, stage beside `vault.db`, sync, cleanly close/checkpoint so rollback holds committed writes, install/reopen/verify stage, delete rollback only after success, and restore rollback or leave locked on failure.
- [x] 2.3 Modify `src-tauri/src/adapters/backup.rs` to retain checkpointed encrypted export, support direct overwrite, and never report partial output as valid.
- [x] 2.4 Verify in the Rust service/SQLite tests preview/no-write, invalid/unreadable and locked rejection, success/cancel, storage failure safety, read-only validation, rollback, and export overwrite.

## Slice 2: Tauri Commands and Permissions

### Phase 3: IPC Wiring
- [x] 3.1 Modify `src-tauri/src/adapters/tauri.rs`: manage `Arc<VaultApp>`, clone into `spawn_blocking`, add async path-only commands and DTO/error mapping, and call `lock()` there on `Applied` to zeroize/invalidate.
- [x] 3.2 Update `src-tauri/Cargo.toml`/`Cargo.lock` (`tauri-plugin-dialog`) and `package.json`/`package-lock.json` (`@tauri-apps/plugin-dialog`); create `src-tauri/capabilities/default.json` with `core:default`, `dialog:allow-save`, `dialog:allow-open`; register plugin.
- [x] 3.3 Verify in `src-tauri/src/adapters/tauri.rs` tests locked rejection, unlocked parameter, tagged results, secret/path-free errors, relock, correct/incorrect imported-password login, no stored/exposed keys, configurable timeout, and non-debug secrets.

## Slice 3: React UI and Verification

### Phase 4: Dialog and Presentation
- [ ] 4.1 Modify `src/ui/api.tsx` with native save/open wrappers, timestamped `clavemaestra-backup-YYYY-MM-DD-HHmm.db`, nullable selection, and typed `importVault(path, confirmed)`.
- [ ] 4.2 Modify `src/ui/App.tsx`/`components.tsx`: unlocked-header-only actions, dialogs, Spanish feedback, replacement modal with Cancel/Confirm, and login return after `Applied`.

### Phase 5: UI Tests and Final Checks
- [ ] 5.1 Extend `src/ui/api.test.tsx`, `App.test.tsx`, and `components.test.tsx` for dialog options/name/null cancel, locked visibility, Spanish notices/errors/modal, cancel/failure, and relock/login.
- [ ] 5.2 Run Rust/UI/build verification; confirm encrypted-only export, no migration, commit-level rollback, and no threat RED tasks because every matrix row is N/A.
