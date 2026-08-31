//! Repository port: persistence boundary for vault records.
//!
//! The application core depends on this trait; the concrete SQLite adapter is
//! provided in Phase 2. Metadata (site, link, category, email, username) is
//! stored plaintext and indexable, while passwords stay encrypted.

use crate::core::domain::entry::{Category, EntryRecord, Filters, RecordId};

/// Persistence errors. Never carries secret material.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RepositoryError {
    #[error("entry not found")]
    NotFound,
    #[error("persistence failure: {0}")]
    Store(String),
}

/// Stores and retrieves [`EntryRecord`]s.
pub trait VaultRepository {
    /// List entries matching `filters` (combined conjunctively).
    fn list(&self, filters: &Filters) -> Result<Vec<EntryRecord>, RepositoryError>;

    /// List the distinct non-empty emails stored in the vault, ordered
    /// ascending. The complete set must come from the repository: the loaded
    /// entry list can be shrunk by an active filter, so deriving emails from
    /// it would be partial.
    fn list_emails(&self) -> Result<Vec<String>, RepositoryError>;

    /// Persist a new or updated entry.
    fn save(&self, entry: &EntryRecord) -> Result<(), RepositoryError>;

    /// Delete an entry by its stable record ID.
    fn delete(&self, id: &RecordId) -> Result<(), RepositoryError>;

    // -- category administration ---------------------------------------------

    /// List categories in deterministic order: case-normalized name ascending,
    /// exact name as the secondary tie-break key (category-administration
    /// "Resolve ordering ties").
    fn list_categories(&self) -> Result<Vec<Category>, RepositoryError>;

    /// Exact (case-sensitive) existence check for `name`.
    fn category_exists(&self, name: &str) -> Result<bool, RepositoryError>;

    /// Persist a new category. Callers enforce the blank-name, palette, and
    /// exact-duplicate rules before writing.
    fn create_category(&self, category: &Category) -> Result<(), RepositoryError>;

    /// Atomically rename/recolor `old` to `category`, cascading the rename to
    /// every entry referencing `old`. Returns the number of entries updated by
    /// the cascade; both writes commit or roll back together.
    fn update_category(&self, old: &str, category: &Category) -> Result<usize, RepositoryError>;

    /// Remove an unused category by exact name. Entries keep their plaintext
    /// reference (no foreign key); the service refuses in-use deletions.
    fn delete_category(&self, name: &str) -> Result<(), RepositoryError>;

    /// Number of entries currently referencing `name`.
    fn category_in_use(&self, name: &str) -> Result<usize, RepositoryError>;
}
