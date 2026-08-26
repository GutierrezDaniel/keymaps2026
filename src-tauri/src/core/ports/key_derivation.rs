//! Key-derivation port: derive the vault key from the master password.
//!
//! The master password MUST never be persisted or returned; only a salt and the
//! derived key flow through this boundary.

use secrecy::SecretString;

use super::cipher::{CryptoError, VaultKey};

/// Derives the vault key from the master password (Argon2id) plus a salt.
pub trait KeyDerivationPort {
    /// Random salt of at least 16 bytes for a new vault.
    fn random_salt(&self) -> Vec<u8>;

    /// Derive a 256-bit key from `password` and `salt`. `password` is consumed
    /// and never stored.
    fn derive(&self, password: SecretString, salt: &[u8]) -> Result<VaultKey, CryptoError>;
}
