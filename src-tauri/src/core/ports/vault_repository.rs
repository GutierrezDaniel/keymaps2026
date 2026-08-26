//! Repository port: persistence boundary for vault records.
//!
//! The application core depends on this trait; the concrete SQLite adapter is
//! provided in Phase 2. Metadata (site, link, category, email, username) is
//! stored plaintext and indexable, while passwords stay encrypted.

use crate::core::domain::entry::{EntryRecord, Filters, RecordId};

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

    /// Persist a new or updated entry.
    fn save(&self, entry: &EntryRecord) -> Result<(), RepositoryError>;

    /// Delete an entry by its stable record ID.
    fn delete(&self, id: &RecordId) -> Result<(), RepositoryError>;
}
