# Vault Import Specification

## Purpose

Define safe restoration of an encrypted, initialized vault into the currently active vault.

## Requirements

### Requirement: Unlocked vault import selection

The system MUST offer vault import only while the current vault is unlocked and MUST allow the user to select a native backup through an open dialog.

#### Scenario: Select a backup while unlocked

- GIVEN an unlocked vault
- WHEN the user starts import and chooses a file
- THEN the selected native backup is passed to validation

#### Scenario: Import is unavailable while locked

- GIVEN a locked vault or login screen
- WHEN the user views available vault actions
- THEN import is not offered and cannot be invoked

### Requirement: Validate before replacement

The system MUST verify that the selected file is an initialized vault before requesting confirmation or changing the current vault.

#### Scenario: Valid initialized vault

- GIVEN a selected file containing an initialized encrypted vault
- WHEN validation completes
- THEN replacement confirmation is shown
- AND the current vault remains unchanged until confirmation

#### Scenario: Invalid or unreadable file

- GIVEN a selected file that is not an initialized vault or cannot be opened
- WHEN validation completes
- THEN an import error is reported
- AND the current vault remains untouched

### Requirement: Confirmed atomic replacement

The system MUST replace the current vault only after explicit confirmation and MUST make the replacement atomic.

#### Scenario: Confirm replacement

- GIVEN a validated initialized backup and an unlocked current vault
- WHEN the user confirms replacement
- THEN the backup becomes the active vault without a partial database state

#### Scenario: Cancel replacement

- GIVEN a validated initialized backup and a displayed replacement confirmation
- WHEN the user cancels
- THEN no vault data is replaced and the current session remains active

### Requirement: Import failure safety

If replacement cannot complete, the system MUST report an error and MUST NOT present a partial or corrupted vault as active.

#### Scenario: Replacement failure

- GIVEN a validated backup and a storage replacement failure
- WHEN import fails
- THEN an error is reported
- AND the current vault is preserved or the application remains safely locked

### Requirement: Relock and reauthenticate after import

After a successful import, the system MUST invalidate the prior unlocked session, relock the application, and require the imported vault's master password before access is restored.

#### Scenario: Successful import requires new authentication

- GIVEN a confirmed replacement of an initialized backup
- WHEN the replacement completes
- THEN the application returns to its locked state
- AND the backup's master password is required to unlock it

#### Scenario: Previous password is rejected

- GIVEN an imported vault whose master password differs from the previous vault's
- WHEN the previous vault's password is submitted
- THEN authentication fails and the imported vault remains locked
