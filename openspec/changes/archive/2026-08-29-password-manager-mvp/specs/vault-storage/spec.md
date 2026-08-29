# Vault Storage Specification

## Purpose

Define durable vault records, searchable metadata, and encrypted secret persistence.

## Requirements

### Requirement: Vault metadata and secret separation

The system MUST persist vault records in SQLite. Site name, link, category, email, and username MUST remain plaintext and indexable metadata; the password MUST be stored only as authenticated encrypted data.

#### Scenario: Persist a complete entry

- GIVEN a valid entry with all six fields
- WHEN it is saved
- THEN all metadata can be queried without decrypting the password
- AND the stored password is not plaintext

#### Scenario: Inspect stored data

- GIVEN a saved entry with a known password
- WHEN the SQLite contents are inspected directly
- THEN the password value is absent in plaintext
- AND the metadata values remain searchable

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
