//! Import port: the validation and atomic-replacement boundary for vault
//! restoration (spec: `openspec/specs/vault-import/spec.md`).
//!
//! The application core depends on this trait, never on a concrete SQLite
//! adapter, so the restore path can be exercised with a fake in unit tests
//! while the real adapter performs read-only validation and a rollback-safe
//! file swap.

use std::path::Path;

/// Import-specific errors. Never carries secret material, paths, or file
/// contents, so error output can never leak vault data.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ImportStorageError {
    #[error("the selected file is not an initialized vault")]
    InvalidVault,
    #[error("could not read the selected file: {0}")]
    Open(String),
    #[error("storage failure: {0}")]
    Store(String),
}

/// Validates a candidate backup and atomically installs it as the active
/// vault.
pub trait VaultImportStorage {
    /// Verify `source` is an initialized vault without writing or migrating
    /// anything: expected schema present, initialization metadata exists, and
    /// the salt/AEAD field lengths are valid.
    fn validate_initialized(&self, source: &Path) -> Result<(), ImportStorageError>;

    /// Replace the active vault with `source` atomically. Callers MUST have
    /// validated `source` first; the adapter revalidates the staged bytes
    /// before installing them and preserves the previous vault as a rollback
    /// file until the replacement verifies.
    fn replace_atomically(&self, source: &Path) -> Result<(), ImportStorageError>;
}