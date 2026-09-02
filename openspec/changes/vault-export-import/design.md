# Design: Vault Export and Import

## Technical Approach

Keep the existing checkpointed `BackupService::export` path and add a dialog boundary in the React client. Add a generic Rust import service over a storage port: it validates a selected database before confirmation, then delegates an atomic swap to SQLite infrastructure. Rust gates both operations on the session and accepts an explicit confirmation flag; React owns presentation, Spanish feedback, and the replacement modal. Import success locks and invalidates the session before the UI returns to login.

## Architecture Decisions

| Decision | Choice | Alternatives / rationale |
|---|---|---|
| Dialog boundary | `@tauri-apps/plugin-dialog` `save`/`open` calls from `api.tsx`; commands receive paths only | No Rust/rfd dialog in a synchronous command: native dialog calls cannot freeze the Tauri main thread. |
| Import orchestration | `VaultImportService<S>` plus `VaultImportStorage` port; `confirmed=false` previews, `true` revalidates and replaces | UI-only validation is unsafe; a concrete SQLite service prevents fake-based unit tests. |
| File replacement | Stage beside `vault.db`, sync, close the active connection, rename current to rollback, rename stage into place, reopen, and delete rollback only after success | In-place SQL copying risks partial state; replacement while a connection is open is not portable to Windows. |
| Blocking work | Make export/import commands async and run existing synchronous services in `spawn_blocking`; manage `VaultApp` through `Arc` | Keeping blocking file work on the main thread harms large-vault responsiveness. |

## Data Flow

```text
Unlocked header → dialog plugin → selected path
       ├─ export(path) → spawn_blocking → BackupService::export → Spanish notice
       └─ import(path,false) → validate initialized → preview modal
                          → import(path,true) → atomic swap → lock/zeroize → login
```

Validation opens the candidate read-only, checks the expected SQLite schema and initialized metadata (including valid salt/AEAD lengths), and performs no migration or write. The replacement adapter stages only the checkpointed main database; any swap or reopen failure restores the rollback file or leaves the app locked.

## File Changes

| File | Action | Description |
|---|---|---|
| `src-tauri/src/core/ports/vault_import_storage.rs` | Create | Import validation/replacement port and secret-free errors. |
| `src-tauri/src/core/application/vault_import_service.rs` | Create | Unlocked gate, validate-before-confirm, confirmed execution result. |
| `src-tauri/src/{core/{ports,application}/mod.rs,adapters/persistence/sqlite.rs}` | Modify | Export the modules; add read-only validation and rollback-safe repository swap. |
| `src-tauri/src/adapters/tauri.rs` | Modify | Import DTO/errors, `VaultApp` wiring, session invalidation, async path commands, and registration. |
| `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | Modify | Optional `tauri-plugin-dialog` dependency and `tauri-app` feature. |
| `src-tauri/capabilities/default.json` | Create | First capability file with `core:default`, `dialog:allow-save`, and `dialog:allow-open`. |
| `src-tauri/src/adapters/backup.rs` | Modify | Preserve export engine; ensure direct overwrite remains platform-safe and regression-tested. |
| `src/ui/api.tsx`, `src/ui/App.tsx`, `src/ui/components.tsx`, `src/ui/{api,App,components}.test.tsx` | Modify | Dialog wrappers, timestamped filename, actions, confirmation modal, Spanish notices, relock state, and tests. |
| `package.json`, `package-lock.json` | Modify | Add `@tauri-apps/plugin-dialog`. |

## Interfaces / Contracts

```rust
pub trait VaultImportStorage {
    fn validate_initialized(&self, source: &Path) -> Result<(), ImportStorageError>;
    fn replace_atomically(&self, source: &Path) -> Result<(), ImportStorageError>;
}
pub enum ImportResult { ConfirmationRequired, Applied }
```

`api.chooseExportPath()` supplies `clavemaestra-backup-YYYY-MM-DD-HHmm.db`; `api.chooseImportPath()` returns one path or `null`. `api.importVault(path, confirmed)` maps to `import_vault` and returns the tagged result. The command rejects locked callers; `Applied` calls `lock()` and zeroizes the old key. `CommandError::Import` is mapped to generic Spanish error copy without secrets or paths.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Preview/no-write, invalid file, confirmed replacement, storage failure, locked gate | `VaultImportService` with a fake `VaultImportStorage`. |
| Integration/commands | Read-only initialized validation, successful swap, rollback, DTO/error mapping, session locked after import, export overwrite | Rust adapter tests and `tauri.rs` `VaultApp` command-surface tests. |
| UI | Dialog options/default filename, hidden locked actions, cancel, Spanish errors, confirmation and return to login | Mock plugin/invoke in existing Vitest component/App/API suites. Strict TDD is false; these are verification tasks. |

## Threat Matrix

| Boundary | Applicability / response / planned RED test |
|---|---|
| Documentation-like paths | N/A — no executable-file classification. |
| Git repository selection | N/A — no repository selection. |
| Commit state | N/A — no commit automation. |
| Push state | N/A — no push automation. |
| PR commands | N/A — no PR command composition. |

## Risks and Rollback

| Risk | Mitigation |
|---|---|
| Destructive or cross-platform swap failure | Validate first, explicit Rust-enforced confirmation, staged sync, rollback rename, reopen verification; lock on unrecoverable failure. |
| Imported password differs | Invalidate and zeroize the prior session; login revalidates the imported vault marker. |
| Plugin permissions/platform behavior | Official plugin, least-privilege capabilities, mocked API tests, and platform build verification. |

Rollback is commit-level: remove the UI/plugin and import wiring while retaining the existing export engine and untouched vault files, as specified by the proposal. No data migration is required.

## Open Questions

None blocking.
