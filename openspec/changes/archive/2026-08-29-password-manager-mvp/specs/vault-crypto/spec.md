# Vault Crypto Specification

## Purpose

Define cryptographic behavior for deriving the vault key and protecting secret fields.

## Requirements

### Requirement: Master-key derivation

The system MUST derive the vault key from the master password with Argon2id and a randomly generated salt of at least 16 bytes. The master password MUST NOT be persisted.

#### Scenario: Create a vault key

- GIVEN a new vault and a master password
- WHEN the vault is initialized
- THEN a salt of at least 16 random bytes and an Argon2id-derived key are produced
- AND the master password is not stored

#### Scenario: Different salts prevent identical derivation

- GIVEN two vault initializations using the same master password
- WHEN each initialization derives its key
- THEN the salts are different and the derived keys are not required to match

### Requirement: Authenticated password encryption

The system MUST encrypt every stored password with AES-256-GCM using a unique nonce per encrypted field and the record ID as authenticated additional data.

#### Scenario: Encrypt and decrypt a password

- GIVEN a record ID, derived key, and plaintext password
- WHEN the password is encrypted and then decrypted with the same context
- THEN the original password is recovered
- AND the nonce and authentication data are retained for verification

#### Scenario: Reject altered ciphertext context

- GIVEN an encrypted password
- WHEN its ciphertext, nonce, record ID, or key is altered before decryption
- THEN authenticated decryption fails
- AND no plaintext password is returned

### Requirement: Crypto failure handling

The system MUST treat authentication failure, malformed ciphertext, and invalid key material as decryption errors and MUST NOT disclose plaintext or cryptographic key material in error output.

#### Scenario: Wrong password cannot decrypt

- GIVEN encrypted vault data and a key derived from the wrong master password
- WHEN decryption is attempted
- THEN the operation fails
- AND no secret value is exposed

#### Scenario: Malformed encrypted field

- GIVEN a stored encrypted field with invalid encoding or missing authentication data
- WHEN the field is read
- THEN the read fails safely without returning plaintext
