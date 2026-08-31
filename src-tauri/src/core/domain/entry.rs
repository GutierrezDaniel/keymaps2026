//! Domain types for vault entries.
//!
//! Entries split into indexable plaintext metadata (site, link, category, email,
//! username) and a single secret field (the password) stored as authenticated
//! encrypted data. This mirrors the vault-storage requirement that metadata stay
//! queryable while passwords remain encrypted at rest.

use secrecy::SecretString;

/// A stable, unique 128-bit record identifier.
///
/// The raw bytes double as the AAD (additional authenticated data) for
/// AES-256-GCM password encryption, so the ciphertext is cryptographically bound
/// to the record it belongs to (see the vault-crypto and vault-storage specs).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct RecordId(pub [u8; 16]);

impl RecordId {
    pub const LEN: usize = 16;

    pub fn new(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    /// Raw bytes used as authenticated additional data when encrypting a field.
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

impl std::fmt::Display for RecordId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut s = [0u8; 32];
        hex::encode_to_slice(self.0, &mut s).expect("32 hex chars fit in [u8; 32]");
        // SAFETY: hex encoding produces only ASCII [0-9a-f], so this is valid UTF-8.
        f.write_str(unsafe { std::str::from_utf8_unchecked(&s) })
    }
}

impl std::str::FromStr for RecordId {
    type Err = RecordIdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bytes = hex::decode(s).map_err(|_| RecordIdParseError)?;
        let arr: [u8; 16] = bytes.try_into().map_err(|_| RecordIdParseError)?;
        Ok(RecordId(arr))
    }
}

/// Error returned when a [`RecordId`] cannot be parsed from its hex form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordIdParseError;

impl std::fmt::Display for RecordIdParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "record id must be a 16-byte hex string (32 hex characters)")
    }
}

impl std::error::Error for RecordIdParseError {}

/// A user-managed category: a display name plus one predefined color swatch.
///
/// Categories are repository-backed (see vault-entries): entry validation asks
/// the repository whether the name exists, so custom persisted values are
/// accepted without any fixed allow-list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Category {
    pub name: String,
    pub color: String,
}

impl Category {
    pub fn new(name: impl Into<String>, color: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            color: color.into(),
        }
    }
}

/// The exact predefined color swatches offered for categories (design
/// "Interfaces / Contracts"). Colors outside this set are rejected.
pub const CATEGORY_PALETTE: [&str; 24] = [
    "#7a5220", "#2f5d8c", "#2f6b3f", "#6a4a8f", "#ad3a2d", "#c05640", "#b76e2b", "#d4a72c",
    "#86601f", "#5f7f35", "#4f8a6b", "#2f6b63", "#3b7d91", "#4a6fa5", "#6b5b95", "#8a4f7d",
    "#a34f67", "#9a5b4a", "#7c5a3c", "#596275", "#36454f", "#708090", "#8f9e9d", "#a67c52",
];

/// The four seeded categories with their migration colors (vault-storage
/// "Category schema migration"): `entretenimiento` `#7a5220`, `trabajo`
/// `#2f5d8c`, `estudio` `#2f6b3f`, and `servicios` `#6a4a8f`. The SQLite
/// migration inserts them with `ON CONFLICT(name) DO NOTHING`.
pub fn seed_categories() -> [Category; 4] {
    [
        Category::new("entretenimiento", "#7a5220"),
        Category::new("trabajo", "#2f5d8c"),
        Category::new("estudio", "#2f6b3f"),
        Category::new("servicios", "#6a4a8f"),
    ]
}

/// Returns true when `name` is non-empty after trimming whitespace.
pub fn is_valid_category_name(name: &str) -> bool {
    !name.trim().is_empty()
}

/// Returns true when `color` is exactly one of the predefined palette swatches.
pub fn is_valid_category_color(color: &str) -> bool {
    CATEGORY_PALETTE.contains(&color)
}

/// Returns true when `category` has a non-blank name and a palette color.
pub fn is_valid_category(category: &Category) -> bool {
    is_valid_category_name(&category.name) && is_valid_category_color(&category.color)
}

/// Authenticated encrypted representation of a secret field.
///
/// `ciphertext` includes the AES-256-GCM authentication tag appended by the
/// `aes-gcm` crate. The nonce is per-field and the record ID acts as AAD.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedField {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// A persisted vault record: plaintext indexable metadata plus an encrypted password.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntryRecord {
    pub id: RecordId,
    pub site: String,
    pub link: String,
    pub category: String,
    pub email: String,
    pub username: String,
    pub password: EncryptedField,
}

/// Search/filter criteria for listing entries. All filters combine conjunctively.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Filters {
    pub site: Option<String>,
    pub category: Option<String>,
    pub email: Option<String>,
}

impl Filters {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_site(mut self, site: impl Into<String>) -> Self {
        self.site = Some(site.into());
        self
    }

    pub fn with_category(mut self, category: impl Into<String>) -> Self {
        self.category = Some(category.into());
        self
    }

    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.email = Some(email.into());
        self
    }
}

/// Input for creating or updating an entry. The password is a secret value.
#[derive(Clone, Debug)]
pub struct EntryInput {
    pub site: String,
    pub link: String,
    pub password: SecretString,
    pub email: String,
    pub username: String,
    pub category: String,
}

impl EntryInput {
    pub fn new(
        site: impl Into<String>,
        link: impl Into<String>,
        password: SecretString,
        email: impl Into<String>,
        username: impl Into<String>,
        category: impl Into<String>,
    ) -> Self {
        Self {
            site: site.into(),
            link: link.into(),
            password,
            email: email.into(),
            username: username.into(),
            category: category.into(),
        }
    }
}

/// A metadata-only view of an entry (no secret material).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntrySummary {
    pub id: RecordId,
    pub site: String,
    pub link: String,
    pub email: String,
    pub username: String,
    pub category: String,
}

/// A full entry view including the decrypted password. The password is transient.
#[derive(Clone, Debug)]
pub struct EntryDetails {
    pub summary: EntrySummary,
    pub password: SecretString,
}
