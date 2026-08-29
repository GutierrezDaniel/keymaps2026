# Vault Backup Specification

## Purpose

Define encrypted export in the vault's native format without exposing plaintext secrets.

## Requirements

### Requirement: Encrypted native-format export

The system MUST export the vault in its own native format, preserving the data required to restore entries and decrypt their password fields. Export MUST remain encrypted and MUST NOT contain plaintext passwords or other plaintext secrets.

#### Scenario: Export an unlocked vault

- GIVEN an unlocked vault with entries containing passwords
- WHEN the user requests a native-format export
- THEN an export file is produced containing encrypted vault data
- AND the file contains no plaintext password values

#### Scenario: Export preserves encrypted context

- GIVEN a vault with stable record IDs and encrypted password fields
- WHEN it is exported
- THEN each exported password retains the context needed for authenticated recovery
- AND metadata remains associated with its original entry

### Requirement: Safe export availability

The system MUST refuse export when the vault is locked or when encrypted serialization fails, and MUST NOT produce a partial file presented as a valid backup.

#### Scenario: Locked vault export

- GIVEN a locked vault
- WHEN export is requested
- THEN the request is rejected
- AND no backup containing vault data is produced

#### Scenario: Export failure

- GIVEN an export operation that cannot complete
- WHEN serialization or file writing fails
- THEN the user receives an error
- AND no incomplete output is reported as a valid native backup

### Requirement: Native-format boundary

The system MUST treat native exports as encrypted vault artifacts and MUST NOT offer a plaintext export path in the MVP.

#### Scenario: Plaintext export request

- GIVEN an unlocked vault
- WHEN a plaintext export is requested
- THEN the request is unavailable or rejected
- AND only the encrypted native format is supported
