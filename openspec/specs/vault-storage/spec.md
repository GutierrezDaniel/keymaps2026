# Vault Storage Specification

## Purpose

Define durable vault records, searchable metadata, and encrypted secret persistence.

## Requirements

### Requirement: Vault metadata and secret separation

The system MUST persist vault records in SQLite. Site name, link, category, email, and username MUST remain plaintext and indexable metadata; the password MUST be stored only as authenticated encrypted data. Category definitions MUST also be durably persisted with unique names and their colors, independently of encrypted password data. (Previously: storage defined entry metadata but had no durable category definitions.)

#### Scenario: Persist a complete entry

- GIVEN a valid entry with all six fields and a persisted category definition
- WHEN it is saved
- THEN all metadata can be queried without decrypting the password
- AND the stored password is not plaintext

#### Scenario: Inspect stored data

- GIVEN a saved entry with a known password and its category definition
- WHEN the SQLite contents are inspected directly
- THEN the password value is absent in plaintext
- AND entry metadata and category color remain searchable

### Requirement: Stable encrypted-field context

Each entry MUST have a stable unique record ID, and the stored password ciphertext MUST retain the nonce and data needed to authenticate it against that record ID.

#### Scenario: Read after restart

- GIVEN a saved entry and a closed application
- WHEN the vault is reopened with the correct master password
- THEN the same record ID and encrypted password context are available
- AND the password can be recovered through authenticated decryption

#### Scenario: Record identity mismatch

- GIVEN encrypted password data belonging to one record
- WHEN it is associated with a different record ID
- THEN the password read fails authentication
- AND the original password is not returned

### Requirement: Durable entry identity

The system MUST allow multiple distinct entries for the same site and MUST preserve each entry's identity across updates and application restarts.

#### Scenario: Multiple accounts at one site

- GIVEN two entries with the same site name and different usernames
- WHEN both are saved and listed
- THEN both entries are returned as separate records
- AND updating one does not change the other

#### Scenario: Duplicate metadata is allowed

- GIVEN two entries with identical site, email, username, and category values
- WHEN they are saved
- THEN both saves succeed with distinct record IDs

### Requirement: Category schema migration

The system MUST migrate pre-v2 vault databases to schema version 2 and MUST seed the four current categories with unchanged colors: `entretenimiento` `#7a5220`, `trabajo` `#2f5d8c`, `estudio` `#2f6b3f`, and `servicios` `#6a4a8f`. Migration MUST preserve existing entries and MUST be safe to run on an already migrated database.

#### Scenario: Migrate an existing vault

- GIVEN a pre-v2 vault containing entries using the four current categories
- WHEN the vault is opened after the feature is installed
- THEN schema version 2 and all four category definitions exist
- AND existing entry card colors are unchanged

#### Scenario: Reopen a migrated vault

- GIVEN a schema-v2 vault with custom categories
- WHEN migration initialization runs again
- THEN custom categories remain unchanged
- AND no duplicate seed categories are created

### Requirement: Backup and restore category coverage

The system MUST include category definitions and colors in database backups and MUST restore them together with entry metadata so custom names, references, and colors survive backup and restore.

#### Scenario: Restore custom categories

- GIVEN a backup containing a custom category, its color, and entries referencing it
- WHEN the backup is restored
- THEN the category definition, color, and entry references are restored together

#### Scenario: Preserve seeded colors through backup

- GIVEN a vault containing the four seeded categories with their migration colors
- WHEN it is backed up and restored
- THEN each seeded category retains its exact CSS hex color
