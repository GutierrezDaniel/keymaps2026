//! Cipher port: authenticated encryption and decryption of secret fields.
//!
//! Passwords are encrypted with AES-256-GCM using a per-field nonce and the
//! record ID as authenticated additional data (AAD). Authentication failure,
//! malformed ciphertext, and invalid key material must surface as a
//! [`CryptoError`] that never discloses plaintext or key material.

use secrecy::{Secret, SecretString};

use crate::core::domain::entry::{EncryptedField, RecordId};

/// The 256-bit symmetric vault key, held as a zeroizing secret.
pub type VaultKey = Secret<[u8; 32]>;

/// Crypto-specific errors. No variant carries plaintext or key material, so error
/// output can never leak secrets (see the vault-crypto "Crypto failure handling"
/// requirement).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    KdfFailed,
    #[error("invalid key material")]
    InvalidKey,
    #[error("malformed encrypted field")]
    MalformedField,
    #[error("authentication failed: ciphertext or its context was altered")]
    AuthenticationFailed,
    #[error("encryption failed")]
    EncryptionFailed,
}

/// Authenticated field encryption/decryption against a vault key.
pub trait CipherPort {
    /// Encrypt `plaintext` for the record `id`, producing a nonce + ciphertext.
    fn encrypt(
        &self,
        id: &RecordId,
        key: &VaultKey,
        plaintext: SecretString,
    ) -> Result<EncryptedField, CryptoError>;

    /// Decrypt `field` for the record `id`. Fails on tampering, a wrong key, or
    /// malformed input — never returning a wrong or partial plaintext.
    fn decrypt(
        &self,
        id: &RecordId,
        key: &VaultKey,
        field: &EncryptedField,
    ) -> Result<SecretString, CryptoError>;
}
