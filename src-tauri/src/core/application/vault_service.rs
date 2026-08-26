//! Application service: entry use cases.
//!
//! `VaultService` orchestrates the repository, cipher, and key-derivation ports.
//! Secrets only ever pass through the cipher port as [`SecretString`] and the
//! derived key as a zeroizing [`VaultKey`]; plaintext never flows into metadata.

use crate::core::domain::entry::{
    is_valid_category, EntryDetails, EntryInput, EntryRecord, EntrySummary, Filters, RecordId,
};
use crate::core::ports::cipher::{CipherPort, CryptoError, VaultKey};
use crate::core::ports::key_derivation::KeyDerivationPort;
use crate::core::ports::vault_repository::{RepositoryError, VaultRepository};

/// Errors surfaced by the application service.
#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("crypto failure: {0}")]
    Crypto(#[from] CryptoError),
    #[error("repository failure: {0}")]
    Repository(#[from] RepositoryError),
    #[error("invalid category: must be one of the initial categories")]
    InvalidCategory,
    #[error("entry not found")]
    NotFound,
}

/// Use cases for managing vault entries.
pub struct VaultService<R, C, K> {
    repo: R,
    cipher: C,
    _kdf: K,
}

impl<R, C, K> VaultService<R, C, K>
where
    R: VaultRepository,
    C: CipherPort,
    K: KeyDerivationPort,
{
    pub fn new(repo: R, cipher: C, kdf: K) -> Self {
        Self {
            repo,
            cipher,
            _kdf: kdf,
        }
    }

    /// Create a new entry: validate the category, encrypt the password, persist.
    pub fn create_entry(
        &self,
        id: RecordId,
        key: &VaultKey,
        input: &EntryInput,
    ) -> Result<(), ServiceError> {
        self.validate_category(&input.category)?;
        let encrypted = self.cipher.encrypt(&id, key, input.password.clone())?;
        let record = EntryRecord {
            id,
            site: input.site.clone(),
            link: input.link.clone(),
            category: input.category.clone(),
            email: input.email.clone(),
            username: input.username.clone(),
            password: encrypted,
        };
        self.repo.save(&record)?;
        Ok(())
    }

    /// Update an existing entry: re-encrypt the password and persist in place.
    pub fn update_entry(
        &self,
        id: RecordId,
        key: &VaultKey,
        input: &EntryInput,
    ) -> Result<(), ServiceError> {
        self.validate_category(&input.category)?;
        // Read to confirm existence before overwriting.
        self.repo.list(&Filters::new())?;
        let encrypted = self.cipher.encrypt(&id, key, input.password.clone())?;
        let record = EntryRecord {
            id,
            site: input.site.clone(),
            link: input.link.clone(),
            category: input.category.clone(),
            email: input.email.clone(),
            username: input.username.clone(),
            password: encrypted,
        };
        self.repo.save(&record)?;
        Ok(())
    }

    /// Decrypt a single entry's password into an [`EntryDetails`] view.
    pub fn get_entry_details(
        &self,
        id: &RecordId,
        key: &VaultKey,
    ) -> Result<EntryDetails, ServiceError> {
        let matches: Vec<EntryRecord> = self
            .repo
            .list(&Filters::new())?
            .into_iter()
            .filter(|e| &e.id == id)
            .collect();
        let record = matches
            .into_iter()
            .next()
            .ok_or(ServiceError::NotFound)?;
        let password = self.cipher.decrypt(&record.id, key, &record.password)?;
        Ok(EntryDetails {
            summary: EntrySummary {
                id: record.id,
                site: record.site,
                link: record.link,
                email: record.email,
                username: record.username,
                category: record.category,
            },
            password,
        })
    }

    /// List metadata-only summaries matching `filters` (no decryption).
    pub fn list_entries(&self, filters: &Filters) -> Result<Vec<EntrySummary>, ServiceError> {
        let records = self.repo.list(filters)?;
        Ok(records
            .into_iter()
            .map(|e| EntrySummary {
                id: e.id,
                site: e.site,
                link: e.link,
                email: e.email,
                username: e.username,
                category: e.category,
            })
            .collect())
    }

    /// Delete an entry by its stable record ID.
    pub fn delete_entry(&self, id: &RecordId) -> Result<(), ServiceError> {
        self.repo.delete(id)?;
        Ok(())
    }

    fn validate_category(&self, category: &str) -> Result<(), ServiceError> {
        if is_valid_category(category) {
            Ok(())
        } else {
            Err(ServiceError::InvalidCategory)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use secrecy::{ExposeSecret, SecretString};

    use super::*;
    use crate::core::domain::entry::INITIAL_CATEGORIES;

    /// In-memory fake repository used to exercise the use cases without SQLite.
    struct FakeRepo {
        records: Mutex<Vec<EntryRecord>>,
    }

    impl FakeRepo {
        fn new() -> Self {
            Self {
                records: Mutex::new(Vec::new()),
            }
        }
    }

    impl VaultRepository for FakeRepo {
        fn list(&self, filters: &Filters) -> Result<Vec<EntryRecord>, RepositoryError> {
            let records = self.records.lock().unwrap();
            Ok(records
                .iter()
                .filter(|e| {
                    filters
                        .site
                        .as_ref()
                        .map(|s| e.site.contains(s.as_str()))
                        .unwrap_or(true)
                        && filters
                            .category
                            .as_ref()
                            .map(|c| &e.category == c)
                            .unwrap_or(true)
                        && filters
                            .email
                            .as_ref()
                            .map(|em| &e.email == em)
                            .unwrap_or(true)
                })
                .cloned()
                .collect())
        }

        fn save(&self, entry: &EntryRecord) -> Result<(), RepositoryError> {
            let mut records = self.records.lock().unwrap();
            if let Some(existing) = records.iter_mut().find(|e| e.id == entry.id) {
                *existing = entry.clone();
            } else {
                records.push(entry.clone());
            }
            Ok(())
        }

        fn list_emails(&self) -> Result<Vec<String>, RepositoryError> {
            let records = self.records.lock().unwrap();
            let mut emails: Vec<String> = records
                .iter()
                .map(|e| e.email.clone())
                .filter(|e| !e.is_empty())
                .collect();
            emails.sort();
            emails.dedup();
            Ok(emails)
        }

        fn delete(&self, id: &RecordId) -> Result<(), RepositoryError> {
            let mut records = self.records.lock().unwrap();
            let before = records.len();
            records.retain(|e| &e.id != id);
            if records.len() == before {
                return Err(RepositoryError::NotFound);
            }
            Ok(())
        }
    }

    fn id(n: u8) -> RecordId {
        RecordId([n; 16])
    }

    fn password(s: &str) -> SecretString {
        SecretString::from(s.to_string())
    }

    /// Build a real crypto-backed service (KDF + cipher are provided by the
    /// adapter) so the use cases are exercised against real crypto.
    fn service() -> VaultService<FakeRepo, crate::adapters::crypto::argon2_aes::Argon2Aes, crate::adapters::crypto::argon2_aes::Argon2Aes>
    {
        VaultService::new(
            FakeRepo::new(),
            crate::adapters::crypto::argon2_aes::Argon2Aes,
            crate::adapters::crypto::argon2_aes::Argon2Aes,
        )
    }

    fn input(category: &str, site: &str, pwd: &str) -> EntryInput {
        EntryInput::new(
            site,
            "https://example.com",
            password(pwd),
            "a@b.c",
            "user",
            category,
        )
    }

    #[test]
    fn create_and_roundtrip_recovers_password() {
        let svc = service();
        let key = svc
            ._kdf
            .derive(password("hunter2"), &[7u8; 16])
            .unwrap();
        let rid = id(1);
        svc.create_entry(rid, &key, &input(INITIAL_CATEGORIES[0], "github", "s3cret"))
            .unwrap();

        let details = svc.get_entry_details(&rid, &key).unwrap();
        assert_eq!(details.summary.site, "github");
        assert_eq!(details.password.expose_secret(), "s3cret");
    }

    #[test]
    fn rejects_invalid_category() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        let err = svc
            .create_entry(id(2), &key, &input("custom-cat", "x", "y"))
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidCategory));
    }

    #[test]
    fn filters_combine_conjunctively() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        svc.create_entry(id(3), &key, &input(INITIAL_CATEGORIES[1], "github", "a"))
            .unwrap();
        svc.create_entry(id(4), &key, &input(INITIAL_CATEGORIES[2], "gitlab", "b"))
            .unwrap();

        let f = Filters::new().with_site("git");
        assert_eq!(svc.list_entries(&f).unwrap().len(), 2);

        let f = Filters::new()
            .with_site("git")
            .with_category(INITIAL_CATEGORIES[1]);
        let list = svc.list_entries(&f).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].site, "github");
    }

    #[test]
    fn delete_removes_record() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        svc.create_entry(id(5), &key, &input(INITIAL_CATEGORIES[3], "site", "p"))
            .unwrap();
        svc.delete_entry(&id(5)).unwrap();
        assert!(svc.list_entries(&Filters::new()).unwrap().is_empty());
    }
}
