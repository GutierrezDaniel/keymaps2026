# Vault Session Specification

## Purpose

Define vault creation, authentication, locking, secret lifetime, inactivity, and login backoff.

## Requirements

### Requirement: Authenticated login

Login MUST succeed only after successful AEAD decryption of vault validation data with the Argon2id-derived key. The master password MUST NEVER be stored. Derived keys and plaintext secrets MUST remain owned by the Rust core and MAY be exposed to the frontend only as decrypted DTOs through Tauri commands; the key MUST NOT reach the frontend. After an import, login MUST validate the master password belonging to the imported vault.
(Previously: login authenticated only the vault that was active before any restore operation.)

#### Scenario: Correct master password

- GIVEN an initialized vault and its correct master password
- WHEN login is submitted
- THEN validation decryption succeeds and the session unlocks
- AND the frontend receives no derived key

#### Scenario: Incorrect master password

- GIVEN an initialized vault and an incorrect master password
- WHEN login is submitted
- THEN validation decryption fails and login is rejected
- AND the master password and derived key are not returned or stored

#### Scenario: Reauthenticate imported vault

- GIVEN an imported initialized vault and its prior session has been invalidated
- WHEN the imported vault's master password is submitted
- THEN login succeeds only for that password and unlocks the imported vault

### Requirement: Lock clears secrets

Lock, logout, and completion of vault import MUST zeroize derived keys and plaintext secrets held by the Rust core. The inactivity timeout MUST be configurable in code. Secret-bearing values MUST NOT be exposed through Debug or formatting output.
(Previously: only explicit logout and inactivity lock triggered the secret-clearing behavior.)

#### Scenario: Explicit logout

- GIVEN an unlocked vault containing plaintext secrets in session memory
- WHEN the user logs out
- THEN the session becomes locked and those secrets and the derived key are zeroized

#### Scenario: Automatic lock

- GIVEN an unlocked vault with an inactivity timeout configured in code
- WHEN inactivity reaches that timeout
- THEN the vault locks and applies the same secret-clearing behavior as logout

#### Scenario: Import invalidates session

- GIVEN an unlocked vault and a confirmed successful import
- WHEN replacement completes
- THEN the prior session is invalidated, secrets are cleared, and the application is locked

### Requirement: Bounded login attempts

The system MUST enforce a configurable maximum consecutive failed-login count and MUST apply increasing backoff before subsequent attempts. A successful login MUST reset the failure count.

#### Scenario: Repeated failures

- GIVEN a configured failed-attempt limit and backoff policy
- WHEN incorrect passwords reach the limit
- THEN further login attempts are delayed or rejected according to that policy

#### Scenario: Successful recovery

- GIVEN a session with prior failed attempts
- WHEN the correct master password is submitted after the applicable delay
- THEN login succeeds and the failed-attempt count resets
