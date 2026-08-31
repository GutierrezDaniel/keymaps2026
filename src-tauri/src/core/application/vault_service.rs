//! Application service: entry use cases.
//!
//! `VaultService` orchestrates the repository, cipher, and key-derivation ports.
//! Secrets only ever pass through the cipher port as [`SecretString`] and the
//! derived key as a zeroizing [`VaultKey`]; plaintext never flows into metadata.

use crate::core::domain::entry::{
    is_valid_category_color, is_valid_category_name, Category, EntryDetails, EntryInput,
    EntryRecord, EntrySummary, Filters, RecordId,
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
    #[error("category name must not be blank")]
    BlankCategoryName,
    #[error("category color must be one of the predefined swatches")]
    InvalidCategoryColor,
    #[error("a category with that exact name already exists")]
    DuplicateCategory,
    #[error("entry references a category that does not exist")]
    UnknownCategory,
    #[error("category is in use by entries and cannot be deleted")]
    CategoryInUse,
    #[error("the last category cannot be deleted")]
    LastCategory,
    #[error("category not found")]
    CategoryNotFound,
    #[error("entry not found")]
    NotFound,
}

/// Outcome of a category update. Renames must be confirmed before any write;
/// recolors apply directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateCategoryResult {
    /// The update (recolor or confirmed rename) was persisted.
    Applied,
    /// The requested rename was not confirmed: nothing was written and
    /// `affected_entries` reports how many entries the cascade would touch.
    RenamePreview { affected_entries: usize },
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

    // -- category administration ---------------------------------------------

    /// List categories in deterministic case-normalized order (exact name as
    /// the tie-breaker), as required by category-administration "ordering".
    pub fn list_categories(&self) -> Result<Vec<Category>, ServiceError> {
        Ok(self.repo.list_categories()?)
    }

    /// Create a category: rejects blank names, non-palette colors, and exact
    /// duplicates without writing anything.
    pub fn create_category(&self, category: &Category) -> Result<(), ServiceError> {
        if !is_valid_category_name(&category.name) {
            return Err(ServiceError::BlankCategoryName);
        }
        if !is_valid_category_color(&category.color) {
            return Err(ServiceError::InvalidCategoryColor);
        }
        if self.repo.category_exists(&category.name)? {
            return Err(ServiceError::DuplicateCategory);
        }
        self.repo.create_category(category)?;
        Ok(())
    }

    /// Update a category.
    ///
    /// - Recolors (name unchanged) apply directly.
    /// - Renames require `confirmed`: an unconfirmed rename performs no write
    ///   and returns [`UpdateCategoryResult::RenamePreview`] with the affected
    ///   entry count; a confirmed rename cascades through one atomic
    ///   repository transaction.
    pub fn update_category(
        &self,
        old_name: &str,
        new_name: &str,
        color: &str,
        confirmed: bool,
    ) -> Result<UpdateCategoryResult, ServiceError> {
        if !is_valid_category_name(new_name) {
            return Err(ServiceError::BlankCategoryName);
        }
        if !is_valid_category_color(color) {
            return Err(ServiceError::InvalidCategoryColor);
        }
        if !self.repo.category_exists(old_name)? {
            return Err(ServiceError::CategoryNotFound);
        }
        if old_name != new_name && self.repo.category_exists(new_name)? {
            return Err(ServiceError::DuplicateCategory);
        }
        let category = Category::new(new_name.to_string(), color.to_string());
        if old_name != new_name && !confirmed {
            let affected_entries = self.repo.category_in_use(old_name)?;
            return Ok(UpdateCategoryResult::RenamePreview { affected_entries });
        }
        self.repo.update_category(old_name, &category)?;
        Ok(UpdateCategoryResult::Applied)
    }

    /// Delete an unused category, keeping at least one category in the vault.
    /// Refuses in-use categories (references must be removed first) and the
    /// last remaining category (safe-delete rules from category-administration).
    pub fn delete_category(&self, name: &str) -> Result<(), ServiceError> {
        if !self.repo.category_exists(name)? {
            return Err(ServiceError::CategoryNotFound);
        }
        if self.repo.category_in_use(name)? > 0 {
            return Err(ServiceError::CategoryInUse);
        }
        if self.repo.list_categories()?.len() <= 1 {
            return Err(ServiceError::LastCategory);
        }
        self.repo.delete_category(name)?;
        Ok(())
    }

    /// Repository-backed entry category validation: the name must exist in the
    /// persisted category set (vault-entries "Accept a repository-backed custom
    /// category").
    fn validate_category(&self, category: &str) -> Result<(), ServiceError> {
        if self.repo.category_exists(category)? {
            Ok(())
        } else {
            Err(ServiceError::UnknownCategory)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use secrecy::{ExposeSecret, SecretString};

    use super::*;
    use crate::core::domain::entry::seed_categories;

    /// In-memory fake repository used to exercise the use cases without SQLite.
    /// Seeded with the four migration categories so entry validation is
    /// repository-backed exactly like the real adapter.
    struct FakeRepo {
        records: Mutex<Vec<EntryRecord>>,
        categories: Mutex<Vec<Category>>,
    }

    impl FakeRepo {
        fn new() -> Self {
            Self {
                records: Mutex::new(Vec::new()),
                categories: Mutex::new(seed_categories().to_vec()),
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

        fn list_categories(&self) -> Result<Vec<Category>, RepositoryError> {
            let mut categories = self.categories.lock().unwrap().clone();
            categories.sort_by(|a, b| {
                a.name
                    .to_lowercase()
                    .cmp(&b.name.to_lowercase())
                    .then_with(|| a.name.cmp(&b.name))
            });
            Ok(categories)
        }

        fn category_exists(&self, name: &str) -> Result<bool, RepositoryError> {
            Ok(self
                .categories
                .lock()
                .unwrap()
                .iter()
                .any(|c| c.name == name))
        }

        fn create_category(&self, category: &Category) -> Result<(), RepositoryError> {
            self.categories.lock().unwrap().push(category.clone());
            Ok(())
        }

        fn update_category(
            &self,
            old: &str,
            category: &Category,
        ) -> Result<usize, RepositoryError> {
            let mut categories = self.categories.lock().unwrap();
            if !categories.iter().any(|c| c.name == old) {
                return Err(RepositoryError::NotFound);
            }
            if let Some(existing) = categories.iter_mut().find(|c| c.name == old) {
                *existing = category.clone();
            }
            let mut records = self.records.lock().unwrap();
            let affected = records.iter().filter(|e| e.category == old).count();
            for entry in records.iter_mut().filter(|e| e.category == old) {
                entry.category = category.name.clone();
            }
            Ok(affected)
        }

        fn delete_category(&self, name: &str) -> Result<(), RepositoryError> {
            let mut categories = self.categories.lock().unwrap();
            let before = categories.len();
            categories.retain(|c| c.name != name);
            if categories.len() == before {
                return Err(RepositoryError::NotFound);
            }
            Ok(())
        }

        fn category_in_use(&self, name: &str) -> Result<usize, RepositoryError> {
            let records = self.records.lock().unwrap();
            Ok(records.iter().filter(|e| e.category == name).count())
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
        svc.create_entry(rid, &key, &input("entretenimiento", "github", "s3cret"))
            .unwrap();

        let details = svc.get_entry_details(&rid, &key).unwrap();
        assert_eq!(details.summary.site, "github");
        assert_eq!(details.password.expose_secret(), "s3cret");
    }

    #[test]
    fn rejects_entry_with_unknown_category_without_writing() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        let err = svc
            .create_entry(id(2), &key, &input("custom-cat", "x", "y"))
            .unwrap_err();
        assert!(matches!(err, ServiceError::UnknownCategory));
        // No-write: the rejected entry must not be persisted.
        assert!(svc.list_entries(&Filters::new()).unwrap().is_empty());
    }

    #[test]
    fn accepts_custom_repository_category_for_entries() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        // The repository now contains `lectura` (vault-entries "Accept a
        // repository-backed custom category"), so entries may use it.
        svc.create_category(&Category::new("lectura", "#8a4f7d"))
            .unwrap();
        svc.create_entry(id(6), &key, &input("lectura", "bookmarks", "p"))
            .unwrap();
        let list = svc.list_entries(&Filters::new()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].category, "lectura");
    }

    #[test]
    fn filters_combine_conjunctively() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        svc.create_entry(id(3), &key, &input("trabajo", "github", "a"))
            .unwrap();
        svc.create_entry(id(4), &key, &input("estudio", "gitlab", "b"))
            .unwrap();

        let f = Filters::new().with_site("git");
        assert_eq!(svc.list_entries(&f).unwrap().len(), 2);

        let f = Filters::new().with_site("git").with_category("trabajo");
        let list = svc.list_entries(&f).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].site, "github");
    }

    #[test]
    fn delete_removes_record() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        svc.create_entry(id(5), &key, &input("servicios", "site", "p"))
            .unwrap();
        svc.delete_entry(&id(5)).unwrap();
        assert!(svc.list_entries(&Filters::new()).unwrap().is_empty());
    }

    // -----------------------------------------------------------------------
    // Category administration (category-administration spec).
    // -----------------------------------------------------------------------

    #[test]
    fn list_categories_is_seeded_and_deterministically_ordered() {
        let svc = service();
        let names: Vec<String> = svc
            .list_categories()
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(
            names,
            ["entretenimiento", "estudio", "servicios", "trabajo"]
        );
    }

    #[test]
    fn create_category_rejects_blank_duplicate_and_non_palette_input() {
        let svc = service();
        // Blank name: rejected, no write.
        assert!(matches!(
            svc.create_category(&Category::new("   ", "#7a5220"))
                .unwrap_err(),
            ServiceError::BlankCategoryName
        ));
        // Color outside the palette: rejected, no write.
        assert!(matches!(
            svc.create_category(&Category::new("lectura", "#ff0000"))
                .unwrap_err(),
            ServiceError::InvalidCategoryColor
        ));
        // Exact duplicate: rejected, no write (case-sensitive comparison).
        assert!(matches!(
            svc.create_category(&Category::new("trabajo", "#7a5220"))
                .unwrap_err(),
            ServiceError::DuplicateCategory
        ));
        // A near duplicate with different case is NOT an exact duplicate.
        svc.create_category(&Category::new("Trabajo", "#7a5220"))
            .unwrap();
        assert_eq!(svc.list_categories().unwrap().len(), 5);
    }

    #[test]
    fn recolor_applies_immediately_without_confirmation() {
        let svc = service();
        let result = svc
            .update_category("trabajo", "trabajo", "#ad3a2d", false)
            .unwrap();
        assert_eq!(result, UpdateCategoryResult::Applied);
        let trabajo = svc
            .list_categories()
            .unwrap()
            .into_iter()
            .find(|c| c.name == "trabajo")
            .unwrap();
        assert_eq!(trabajo.color, "#ad3a2d");
    }

    #[test]
    fn unconfirmed_rename_previews_count_and_writes_nothing() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        // Three entries reference `trabajo`.
        for n in 1..=3 {
            svc.create_entry(id(n), &key, &input("trabajo", &format!("site{n}"), "p"))
                .unwrap();
        }

        let result = svc
            .update_category("trabajo", "laburo", "#ad3a2d", false)
            .unwrap();
        assert_eq!(
            result,
            UpdateCategoryResult::RenamePreview {
                affected_entries: 3
            }
        );

        // No write: category and every entry reference stay unchanged.
        assert!(svc
            .list_categories()
            .unwrap()
            .iter()
            .any(|c| c.name == "trabajo"));
        assert!(!svc
            .list_categories()
            .unwrap()
            .iter()
            .any(|c| c.name == "laburo"));
        let entries = svc.list_entries(&Filters::new()).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|e| e.category == "trabajo"));
    }

    #[test]
    fn confirmed_rename_cascades_to_all_referencing_entries() {
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        for n in 1..=3 {
            svc.create_entry(id(n), &key, &input("trabajo", &format!("site{n}"), "p"))
                .unwrap();
        }

        let result = svc
            .update_category("trabajo", "laburo", "#ad3a2d", true)
            .unwrap();
        assert_eq!(result, UpdateCategoryResult::Applied);

        assert!(svc
            .list_categories()
            .unwrap()
            .iter()
            .any(|c| c.name == "laburo"));
        let entries = svc.list_entries(&Filters::new()).unwrap();
        assert!(entries.iter().all(|e| e.category == "laburo"));
    }

    #[test]
    fn rename_to_existing_name_is_rejected_without_write() {
        let svc = service();
        let result = svc
            .update_category("trabajo", "servicios", "#ad3a2d", true)
            .unwrap_err();
        assert!(matches!(result, ServiceError::DuplicateCategory));
        // Both categories remain, unchanged.
        assert_eq!(svc.list_categories().unwrap().len(), 4);
    }

    #[test]
    fn delete_category_refuses_in_use_and_last_category() {
        // In-use categories cannot be deleted.
        let svc = service();
        let key = svc._kdf.derive(password("hunter2"), &[7u8; 16]).unwrap();
        svc.create_entry(id(7), &key, &input("trabajo", "github", "p"))
            .unwrap();
        assert!(matches!(
            svc.delete_category("trabajo").unwrap_err(),
            ServiceError::CategoryInUse
        ));
        assert!(matches!(
            svc.delete_category("ghost").unwrap_err(),
            ServiceError::CategoryNotFound
        ));

        // The last remaining category is protected even when unused.
        let svc = service();
        svc.delete_category("entretenimiento").unwrap();
        svc.delete_category("estudio").unwrap();
        svc.delete_category("servicios").unwrap();
        assert_eq!(svc.list_categories().unwrap().len(), 1);
        assert!(matches!(
            svc.delete_category("trabajo").unwrap_err(),
            ServiceError::LastCategory
        ));
    }

    #[test]
    fn delete_unused_category_succeeds_and_preserves_remaining() {
        let svc = service();
        svc.delete_category("servicios").unwrap();
        let names: Vec<String> = svc
            .list_categories()
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, ["entretenimiento", "estudio", "trabajo"]);
    }
}
