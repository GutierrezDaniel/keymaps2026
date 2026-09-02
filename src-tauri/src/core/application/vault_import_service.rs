//! Application service: vault import use case (spec:
//! `openspec/specs/vault-import/spec.md`).
//!
//! `VaultImportService` orchestrates the [`VaultImportStorage`] port: a
//! candidate backup is validated before any replacement, an explicit
//! `confirmed` flag gates the destructive swap, and the storage adapter is the
//! only component that touches files. `unlocked` mirrors
//! [`BackupService::export`]'s session gate: a locked vault is refused up
//! front.

use std::path::Path;

use crate::core::ports::vault_import_storage::{ImportStorageError, VaultImportStorage};

/// Errors surfaced by the import use case. Never carries secret material,
/// paths, or file contents.
#[derive(Debug, thiserror::Error)]
pub enum ImportServiceError {
    #[error("vault is locked; unlock before importing")]
    Locked,
    #[error("import storage failure: {0}")]
    Storage(#[from] ImportStorageError),
}

/// Outcome of an import request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportResult {
    /// The candidate validated and is ready to replace the vault, but the
    /// caller must confirm first. Nothing was written.
    ConfirmationRequired,
    /// The confirmed replacement completed: the imported vault is now active.
    Applied,
}

/// Use case for restoring an encrypted native vault backup.
pub struct VaultImportService<S> {
    storage: S,
}

impl<S: VaultImportStorage> VaultImportService<S> {
    pub fn new(storage: S) -> Self {
        Self { storage }
    }

    /// Validate and (when confirmed) apply an import of `source`.
    ///
    /// - `unlocked == false` refuses the request (vault-import "Import is
    ///   unavailable while locked");
    /// - `confirmed == false` validates only and returns
    ///   [`ImportResult::ConfirmationRequired`] without any write
    ///   (vault-import "Validate before replacement");
    /// - `confirmed == true` revalidates (the file may have changed since the
    ///   preview) and then atomically replaces the vault
    ///   (vault-import "Confirmed atomic replacement").
    ///
    /// Any validation or storage failure leaves the current vault untouched.
    pub fn import(
        &self,
        unlocked: bool,
        confirmed: bool,
        source: &Path,
    ) -> Result<ImportResult, ImportServiceError> {
        if !unlocked {
            return Err(ImportServiceError::Locked);
        }
        self.storage.validate_initialized(source)?;
        if !confirmed {
            return Ok(ImportResult::ConfirmationRequired);
        }
        self.storage.replace_atomically(source)?;
        Ok(ImportResult::Applied)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;

    /// Fake storage recording every call, so the service's orchestration is
    /// verified without any file access (design: "a concrete SQLite service
    /// prevents fake-based unit tests" — the fake proves the service contract,
    /// the SQLite integration tests prove the adapter).
    struct FakeStorage {
        calls: Mutex<Vec<&'static str>>,
        validate_ok: bool,
        replace_ok: bool,
    }

    impl FakeStorage {
        fn new(validate_ok: bool, replace_ok: bool) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                validate_ok,
                replace_ok,
            }
        }
    }

    impl VaultImportStorage for FakeStorage {
        fn validate_initialized(&self, _source: &Path) -> Result<(), ImportStorageError> {
            self.calls.lock().unwrap().push("validate");
            if self.validate_ok {
                Ok(())
            } else {
                Err(ImportStorageError::InvalidVault)
            }
        }

        fn replace_atomically(&self, _source: &Path) -> Result<(), ImportStorageError> {
            self.calls.lock().unwrap().push("replace");
            if self.replace_ok {
                Ok(())
            } else {
                Err(ImportStorageError::Store("swap failed".into()))
            }
        }
    }

    impl VaultImportStorage for &FakeStorage {
        fn validate_initialized(&self, source: &Path) -> Result<(), ImportStorageError> {
            (**self).validate_initialized(source)
        }

        fn replace_atomically(&self, source: &Path) -> Result<(), ImportStorageError> {
            (**self).replace_atomically(source)
        }
    }

    fn calls(storage: &FakeStorage) -> Vec<&'static str> {
        storage.calls.lock().unwrap().clone()
    }

    fn source() -> PathBuf {
        PathBuf::from("/tmp/candidate.db")
    }

    #[test]
    fn locked_session_is_refused_without_touching_storage() {
        let storage = FakeStorage::new(true, true);
        let service = VaultImportService::new(&storage);
        assert!(matches!(
            service.import(false, true, &source()).unwrap_err(),
            ImportServiceError::Locked
        ));
        assert!(calls(&storage).is_empty(), "locked import must not touch storage");
    }

    #[test]
    fn preview_validates_and_writes_nothing() {
        let storage = FakeStorage::new(true, true);
        let service = VaultImportService::new(&storage);
        let result = service.import(true, false, &source()).unwrap();
        assert_eq!(result, ImportResult::ConfirmationRequired);
        assert_eq!(
            calls(&storage),
            vec!["validate"],
            "preview must validate but never replace"
        );
    }

    #[test]
    fn invalid_candidate_is_rejected_and_current_vault_untouched() {
        let storage = FakeStorage::new(false, true);
        let service = VaultImportService::new(&storage);
        assert!(matches!(
            service.import(true, false, &source()).unwrap_err(),
            ImportServiceError::Storage(ImportStorageError::InvalidVault)
        ));
        // Confirmed imports also revalidate: an invalid candidate is refused
        // even when the caller claims confirmation.
        let err = service.import(true, true, &source()).unwrap_err();
        assert!(matches!(err, ImportServiceError::Storage(_)));
        assert_eq!(
            calls(&storage),
            vec!["validate", "validate"],
            "replacement must never run for an invalid candidate"
        );
    }

    #[test]
    fn confirmed_import_revalidates_then_applies() {
        let storage = FakeStorage::new(true, true);
        let service = VaultImportService::new(&storage);
        let result = service.import(true, true, &source()).unwrap();
        assert_eq!(result, ImportResult::Applied);
        assert_eq!(
            calls(&storage),
            vec!["validate", "replace"],
            "confirmed import must revalidate before replacing"
        );
    }

    #[test]
    fn storage_failure_returns_error_without_reporting_success() {
        let storage = FakeStorage::new(true, false);
        let service = VaultImportService::new(&storage);
        let err = service.import(true, true, &source()).unwrap_err();
        assert!(matches!(err, ImportServiceError::Storage(_)));
        assert_eq!(calls(&storage), vec!["validate", "replace"]);
    }
}