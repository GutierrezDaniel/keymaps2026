```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:4e397a0d69e65f1119c16dbea001c4a57f932b233e420e384b1960fcee325f46
verdict: pass
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 25/25
test_command: npm test && (cd src-tauri && cargo test)
test_exit_code: 0
test_output_hash: sha256:79158ebaf519852393773328c1989785d0bb6df3ce82dc239accdcdb0e112bf9
build_command: npm run build && (cd src-tauri && cargo check --features tauri-app)
build_exit_code: 0
build_output_hash: sha256:70949b4b47cc2d25d188fce0117d9463ecbca052661b73b78d4170643b58e694
```

## Verification Report

**Change**: vault-export-import
**Version**: N/A (delta specs; verified HEAD `36ee5a4` on branch `feature/vault-export-import-ui`, 4 commits ahead of origin/main: Slice 3 unmerged, Slices 1–2 merged via PR #16/#17)
**Mode**: Standard (strict_tdd: false per openspec/config.yaml; verification after implementation)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: ✅ Passed
```text
npm run build (tsc && vite build): ✓ built in 890ms — 1812 modules, exit 0
cargo check --features tauri-app: Finished `dev` profile in 2.41s, exit 0
```

**Tests**: ✅ 205 passed (106 vitest + 72 cargo lib + 7 vault_import + 20 vault_repo), 0 failed, 0 skipped
```text
npm test: 3 files passed, 106 tests passed, exit 0 (hash 79158eba…)
cargo test: lib 72 passed + tests/vault_import.rs 7 passed + tests/vault_repo.rs 20 passed; 0 failed, exit 0 (hash 2b584b92…)
cargo check --features tauri-app: exit 0 (hash d169886d…)
```

**Coverage**: ➖ Not available (no coverage threshold configured; runtime evidence is the contract)

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| VI-R1 Unlocked vault import selection | Select a backup while unlocked | `api.test.tsx > chooseImportPath opens the open dialog for a single backup file`; `App.test.tsx > previews a selected backup and shows the Spanish replacement modal` (invokes `import_vault { path, confirmed: false }`) | ✅ COMPLIANT |
| VI-R1 Unlocked vault import selection | Import is unavailable while locked | `App.test.tsx > hides export and import while locked`; `tauri.rs > import_command_refuses_locked_session`; `vault_import_service.rs > locked_session_is_refused_without_touching_storage` | ✅ COMPLIANT |
| VI-R2 Validate before replacement | Valid initialized vault | `vault_import.rs > validate_backup_accepts_an_initialized_vault_backup`; `import_preview_returns_confirmation_required_and_writes_nothing` (vault unchanged until confirmation) | ✅ COMPLIANT |
| VI-R2 Validate before replacement | Invalid or unreadable file | `vault_import.rs > validate_backup_rejects_garbage_empty_and_missing_files`; `failed_import_leaves_the_current_vault_intact_and_usable`; `tauri.rs > import_rejects_invalid_file_and_leaves_current_vault_untouched`; `App.test.tsx > reports an invalid import selection with a Spanish error` | ✅ COMPLIANT |
| VI-R3 Confirmed atomic replacement | Confirm replacement | `vault_import.rs > confirmed_import_swaps_atomically_and_deletes_rollback_only_after_success` (active file byte-for-byte); `preview_confirms_without_writing_and_confirmed_import_applies`; `tauri.rs > confirmed_import_applies_relocks_and_requires_imported_password` | ✅ COMPLIANT |
| VI-R3 Confirmed atomic replacement | Cancel replacement | `vault_import_service.rs > preview_validates_and_writes_nothing`; `App.test.tsx > cancelling the replacement modal leaves the vault unchanged` (no `confirmed: true` call); `components.test.tsx > calls onCancel from Cancelar` | ✅ COMPLIANT |
| VI-R4 Import failure safety | Replacement failure | `vault_import_service.rs > storage_failure_returns_error_without_reporting_success`; `vault_import.rs > failed_import_leaves_the_current_vault_intact_and_usable`; `sqlite.rs > restore_after_failed_swap_reinstates_the_previous_vault` (byte-for-byte restore; locked placeholder when restore fails) | ✅ COMPLIANT |
| VI-R5 Relock and reauthenticate after import | Successful import requires new authentication | `tauri.rs > confirmed_import_applies_relocks_and_requires_imported_password` (asserts `is_locked` after `Applied`, imported password unlocks); `import_backup` calls `lock()` on `Applied`; `App.test.tsx > confirms the import, relocks and returns to login with a Spanish notice` | ✅ COMPLIANT |
| VI-R5 Relock and reauthenticate after import | Previous password is rejected | `tauri.rs > confirmed_import_applies_relocks_and_requires_imported_password` (old password → `AuthenticationFailed`) | ✅ COMPLIANT |
| VB-R1 Native export dialog and default filename | Export with timestamped default | `api.test.tsx > chooseExportPath opens the save dialog with the timestamped default filename` (asserts `defaultPath` pattern `clavemaestra-backup-…`); `api.tsx backupFileName()` yields `clavemaestra-backup-YYYY-MM-DD-HHmm.db` | ✅ COMPLIANT |
| VB-R1 Native export dialog and default filename | Direct overwrite | `backup.rs > export_overwrites_an_existing_destination_file`; `replace_file` platform-safe overwrite (Unix rename; Windows remove-then-rename after synced temp) | ✅ COMPLIANT |
| VB-R2 Safe export availability | Locked vault export | `backup.rs > export_refused_when_locked` (no backup, no temp file); `tauri.rs > export_command_refuses_locked_and_exports_when_unlocked`; UI hides the action while locked | ✅ COMPLIANT |
| VB-R2 Safe export availability | Export failure | `backup.rs > export_failure_leaves_no_partial_file` (no partial backup, no temp file); `App.test.tsx > reports an export failure with a Spanish error notice` (`Ocurrió un error: disk full`) | ✅ COMPLIANT |
| VU-R1 Unlocked vault backup actions | Header actions while unlocked | `App.test.tsx > shows export and import only in the unlocked vault header`; `App.tsx` `vault-actions` render `Exportar respaldo`/`Importar respaldo` in the unlocked header only | ✅ COMPLIANT |
| VU-R1 Unlocked vault backup actions | Actions hidden while locked | `App.test.tsx > hides export and import while locked` (locked phase renders login screen only) | ✅ COMPLIANT |
| VU-R2 Import replacement confirmation | Confirm replacement modal | `App.test.tsx > previews a selected backup and shows the Spanish replacement modal` (asserts `alertdialog` "Confirmar importación", "Se reemplazará la bóveda actual…", "Esta acción no se puede deshacer.", `Importar` + `Cancelar`); `components.tsx > ImportConfirmModal` | ✅ COMPLIANT |
| VU-R2 Import replacement confirmation | Cancel from replacement modal | `App.test.tsx > cancelling the replacement modal leaves the vault unchanged`; `components.test.tsx > calls onConfirm from the Importar action and onCancel from Cancelar` | ✅ COMPLIANT |
| VU-R3 Spanish backup feedback | Successful export notice | `App.test.tsx > exports through the save dialog and shows a Spanish success notice` (`Respaldo exportado correctamente.`) | ✅ COMPLIANT |
| VU-R3 Spanish backup feedback | Failed import notice | `App.test.tsx > reports an invalid import selection with a Spanish error` (`No se pudo importar la bóveda…`); `spanishMessage` `Import` case (generic secret/path-free copy) | ✅ COMPLIANT |
| VS-R1 Authenticated login | Correct master password | `tauri.rs > create_then_unlock_roundtrip`, `successful_unlock_resets_backoff`; `unlock` returns `()` — no derived key on the wire; key stays in Rust `Session` | ✅ COMPLIANT |
| VS-R1 Authenticated login | Incorrect master password | `tauri.rs > unlock_enforces_backoff_after_five_failures` (`AuthenticationFailed`); `import_clears_session_and_debug_output_masks_secrets` (Debug never exposes master password) | ✅ COMPLIANT |
| VS-R1 Authenticated login | Reauthenticate imported vault | `tauri.rs > confirmed_import_applies_relocks_and_requires_imported_password` (login succeeds only for the imported vault's password) | ✅ COMPLIANT |
| VS-R2 Lock clears secrets | Explicit logout | `tauri.rs > lock_zeroizes_session_key_bytes`, `app_lock_clears_session`, `dropping_session_zeroizes_key_via_secret_drop`; `Session::zeroize` + secrecy drop semantics | ✅ COMPLIANT |
| VS-R2 Lock clears secrets | Automatic lock | `tauri.rs > auto_lock_locks_expired_session`, `auto_lock_keeps_active_session_unlocked`; `SESSION_TIMEOUT` const (5 min, configurable in code) + `spawn_auto_lock_thread` | ✅ COMPLIANT |
| VS-R2 Lock clears secrets | Import invalidates session | `tauri.rs > import_clears_session_and_debug_output_masks_secrets` (session `None` after import); `confirmed_import_applies_relocks_and_requires_imported_password` (locked after `Applied`) | ✅ COMPLIANT |

**Compliance summary**: 25/25 scenarios compliant

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| VI import selection & validation | ✅ Implemented | Native `open` dialog via `api.chooseImportPath`; `validate_backup` opens with `SQLITE_OPEN_READ_WRITE` then `PRAGMA query_only` (WAL-safe), checks the three expected tables, initialized metadata singleton, salt ≥ 16 B, 12-B nonce, ciphertext ≥ 16-B tag; no migration/write |
| VI confirmed atomic replacement | ✅ Implemented | Stage beside `vault.db` + `sync_all`, revalidate staged bytes, checkpoint + close active connection, rename current → `.rollback`, stage → `vault.db`, reopen + verify, delete rollback only after success; restore-on-failure or locked placeholder |
| VI failure safety & relock | ✅ Implemented | Storage errors map to payload-free `CommandError::Import`; `import_backup` calls `lock()` on `Applied`; session zeroized |
| VB export dialog + overwrite | ✅ Implemented | `save` dialog with `defaultPath: backupFileName()` (`clavemaestra-backup-YYYY-MM-DD-HHmm.db`); temp-sibling + atomic rename; Windows remove-then-rename overwrite; never reports partial output |
| VU header actions + modal + feedback | ✅ Implemented | Unlocked-header-only buttons; `ImportConfirmModal` with Spanish replacement copy and `Importar`/`Cancelar`; Spanish notices/errors incl. generic `Import` copy |
| VS login + secret clearing | ✅ Implemented | Unlock authenticates via AEAD validation decrypt; key never leaves Rust; `SESSION_TIMEOUT` const; lock/logout/import zeroize; Debug masked (custom `serialize_secret`, `SecretString`) |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Dialog boundary: plugin `save`/`open` from `api.tsx`; commands receive paths only | ✅ Yes | `chooseExportPath`/`chooseImportPath`; `export_vault { dest }`, `import_vault { path, confirmed }` |
| Import orchestration: `VaultImportService<S>` + `VaultImportStorage` port; `confirmed=false` previews, `true` revalidates and replaces | ✅ Yes | Service gates on `unlocked`, preview validates only, confirmed revalidates (`validate` before `replace` asserted) |
| File replacement: stage beside `vault.db`, sync, close, rename, reopen, delete rollback after success | ✅ Yes | `replace_with_backup` sequence exactly; rollback restore primitive tested byte-for-byte |
| Blocking work: async commands + `spawn_blocking`; `VaultApp` via `Arc` | ✅ Yes | `export_vault`/`import_vault` async, `Arc::clone(state.inner())` into `spawn_blocking`; `app.manage(Arc::new(state))` |
| Session invalidation on `Applied` | ✅ Yes | `import_backup` → `self.lock()` → `Session::zeroize`; UI returns to login with Spanish notice |
| Plugin + capabilities: `tauri-plugin-dialog`, `dialog:allow-save`/`allow-open` + `core:default` | ✅ Yes | `Cargo.toml` optional dep under `tauri-app` feature; `capabilities/default.json` registered via `tauri_plugin_dialog::init()` |

### Issues Found
**CRITICAL**: None
**WARNING**: None
**SUGGESTION**: None

### Verdict
PASS
All 12 requirements (25/25 scenarios) compliant with passing runtime evidence; 13/13 tasks complete; all four evidence commands green (106 vitest + 72 cargo lib + 7 vault_import + 20 vault_repo tests, clean `npm run build` and `cargo check --features tauri-app`); no blockers, no critical findings.