# Delta for Vault Backup

## ADDED Requirements

### Requirement: Native export dialog and default filename

The unlocked vault UI MUST expose native encrypted export through a save dialog. The dialog MUST default to `clavemaestra-backup-YYYY-MM-DD-HHmm.db`, including date and time, and the selected destination MAY overwrite an existing file directly.

#### Scenario: Export with timestamped default

- GIVEN an unlocked vault and the export action
- WHEN the save dialog opens
- THEN its default filename matches `clavemaestra-backup-YYYY-MM-DD-HHmm.db`
- AND the user can choose the destination

#### Scenario: Direct overwrite

- GIVEN an unlocked vault and an existing file at the selected destination
- WHEN export is confirmed by the save dialog
- THEN the encrypted backup is written directly to that destination

## MODIFIED Requirements

### Requirement: Safe export availability

The system MUST refuse export when the vault is locked or when encrypted serialization fails, MUST NOT produce a partial file presented as a valid backup, and MUST report surfaced export errors in Spanish.
(Previously: export failures returned an error without requiring Spanish user-facing feedback.)

#### Scenario: Locked vault export

- GIVEN a locked vault
- WHEN export is requested
- THEN the request is rejected
- AND no backup containing vault data is produced
- AND the user receives a Spanish error

#### Scenario: Export failure

- GIVEN an export operation that cannot complete
- WHEN serialization or file writing fails
- THEN the user receives a Spanish error
- AND no incomplete output is reported as a valid native backup
