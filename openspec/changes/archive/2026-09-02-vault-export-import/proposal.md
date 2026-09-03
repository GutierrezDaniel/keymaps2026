# Proposal: Vault Export and Import

## Problem

The encrypted backup engine and Tauri command exist, but users cannot choose a destination from the UI. No restore flow exists, so a valid encrypted backup cannot safely replace a vault.

## Why

Users need a discoverable backup workflow and recovery after device loss. Restore is destructive, so validation, confirmation, and reauthentication must prevent accidental replacement or invalid databases.

## Scope

### In Scope
- Add unlocked-only native save/open dialogs with `tauri-plugin-dialog`.
- Export with default name `clavemaestra-backup-YYYY-MM-DD-HHmm.db`, direct overwrite, and Spanish success/error feedback.
- Import only a validated initialized vault; confirm replacement in Spanish, replace atomically, relock, and require the backup master password again.
- Expose both actions in the unlocked vault header and preserve encrypted native format without plaintext export.

### Out of Scope
- Login-screen import, metadata enrichment, auto-merge, conflict resolution, synchronization, or plaintext export.

## Approach overview

Keep Rust `BackupService::export` and add a restore boundary that opens the selected file and verifies initialization before replacement. After confirmation, replace storage atomically; invalid files leave the current database untouched. Register the official dialog plugin and permissions, connect typed Tauri commands to Spanish feedback and a confirmation modal, then clear the session and return to login.

## Requirements outline

- **New `vault-import`**: unlocked-only selection, initialized-vault validation, confirmation, atomic replacement, failure safety, and relock/reauthentication.
- **Modified `vault-backup`**: native export is reachable from the unlocked UI, uses the timestamped default filename, and reports success/failure in Spanish.
- **Modified `vault-ui`**: unlocked header actions, native dialogs, replacement modal, and Spanish notices/errors.
- **Modified `vault-session`**: import invalidates the session and requires the imported vault’s master password.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src-tauri/src/adapters/{backup,tauri}.rs`, `Cargo.toml` | Modified | Restore commands and plugin registration. |
| `src-tauri/capabilities/default.json`, `package.json`, `src/ui/{api,App}.tsx` | New/Modified | Permissions, dependency, actions, modal, and feedback. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Destructive replacement loses the current vault | High | Validate first, confirm explicitly, and replace atomically. |
| Imported key differs from the active key | High | Relock immediately and require reauthentication. |
| Dialog permissions or platform behavior fail | Med | Use the official plugin, capabilities, and command/UI tests. |

## Rollback Plan

Revert the feature commits and disable the UI actions; existing encrypted export behavior and databases remain unchanged.

## Dependencies

- `tauri-plugin-dialog` Rust/JS packages and Tauri capability configuration.

## Success Criteria

- [ ] Unlocked users can export and import encrypted native vaults through native dialogs.
- [ ] Invalid imports never alter the current database; confirmed imports replace it atomically.
- [ ] Every import relocks the app and requires the imported master password.
