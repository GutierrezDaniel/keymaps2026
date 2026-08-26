//! Tauri command layer: session, backoff, DTOs, and the typed commands.
//!
//! This module holds the MVP's application state ([`VaultApp`]) plus the ten
//! design commands (`unlock`, `lock`, `list`, `get_entry_details`, `create`,
//! `update`, `delete`, `export`, `copy_field`, `record_activity`) and the
//! vault-creation command the design's data flow requires (`create_vault`).
//!
//! Structure:
//! - the session ([`Session`]) owns the derived `VaultKey` and zeroizes it on
//!   lock (vault-session "Lock clears secrets");
//! - the backoff policy ([`BackoffPolicy`]) delays attempts after five
//!   consecutive failures with 1, 2, 4, 8, 16s delays capped at 60s, and resets
//!   on success (vault-session "Bounded login attempts");
//! - inactivity auto-lock ([`SESSION_TIMEOUT`]) runs both lazily before every
//!   command and from a background thread in the desktop shell;
//! - the `#[tauri::command]` glue is feature-gated so `cargo test --lib` stays
//!   headless while the shell compiles with `--features tauri-app`.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rand::rngs::OsRng;
use rand::RngCore;
use secrecy::{ExposeSecret, SecretString};
use zeroize::Zeroize;

use crate::adapters::backup::{BackupError, BackupService};
use crate::adapters::clipboard::{Clipboard, CLIPBOARD_EXPIRY};
use crate::adapters::crypto::argon2_aes::Argon2Aes;
use crate::adapters::persistence::sqlite::SqliteVaultRepository;
use crate::core::application::vault_service::{ServiceError, VaultService};
use crate::core::domain::entry::{
    EntryDetails, EntryInput, EntryRecord, EntrySummary, Filters, RecordId,
};
use crate::core::ports::cipher::{CipherPort, CryptoError, VaultKey};
use crate::core::ports::clipboard::{ClipboardError, ClipboardPort};
use crate::core::ports::key_derivation::KeyDerivationPort;
use crate::core::ports::vault_repository::{RepositoryError, VaultRepository};

/// Inactivity timeout: the session locks after 5 minutes without activity
/// (design: "Five-minute activity timer"). Configurable in code per the spec.
pub const SESSION_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// How often the desktop shell's background thread checks the session timer.
pub const AUTO_LOCK_CHECK_INTERVAL: Duration = Duration::from_secs(5);

/// Record ID the vault validation value is encrypted under. The validation
/// record authenticates the master password at unlock without storing it.
const VALIDATION_ID: RecordId = RecordId([9; 16]);
/// Plaintext marker encrypted as the validation record. Its successful
/// decryption with the derived key proves the master password is correct.
const VALIDATION_SECRET: &str = "vault-validation";

/// A decrypted session: owns the derived vault key for the lifetime of the
/// unlock. The key is a zeroizing [`Secret`]; dropping or explicitly
/// zeroizing the session clears it from memory (vault-session "Lock clears
/// secrets").
pub struct Session {
    key: VaultKey,
    last_activity: Instant,
}

impl Session {
    /// Start a session holding `key`, with its activity clock ticking now.
    pub fn new(key: VaultKey) -> Self {
        Self {
            key,
            last_activity: Instant::now(),
        }
    }

    /// Reset the activity clock (called on user activity).
    fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// True when no activity happened for at least `timeout`.
    fn is_expired(&self, timeout: Duration) -> bool {
        self.last_activity.elapsed() >= timeout
    }

    #[cfg(test)]
    fn touch_at(&mut self, at: Instant) {
        self.last_activity = at;
    }
}

impl Zeroize for Session {
    fn zeroize(&mut self) {
        // Replace the key with a zeroed one: dropping the previous `Secret`
        // zeroizes its bytes (secrecy zeroizes on drop). Belt-and-suspenders
        // on top of the same guarantee that runs when the session is dropped.
        self.key = VaultKey::new([0u8; 32]);
    }
}

/// Consecutive-failed-login backoff policy (vault-session "Bounded login
/// attempts"): attempts below the limit are immediate, then delays grow 1, 2,
/// 4, 8, 16 seconds and beyond, capped at 60s. A successful login resets.
pub struct BackoffPolicy {
    /// Maximum consecutive failures allowed before delays start (default 5).
    max_failures: u32,
    /// Current consecutive failure count.
    failures: u32,
    /// Upper bound for any delay, in seconds.
    cap_secs: u64,
}

impl BackoffPolicy {
    pub fn new() -> Self {
        Self {
            max_failures: 5,
            failures: 0,
            cap_secs: 60,
        }
    }

    /// Configure the failure limit (spec: "configurable maximum").
    pub fn with_max_failures(mut self, max_failures: u32) -> Self {
        self.max_failures = max_failures;
        self
    }

    pub fn failure_count(&self) -> u32 {
        self.failures
    }

    /// Record a failed login and return the delay to enforce before the next
    /// attempt.
    pub fn record_failure(&mut self) -> Duration {
        self.failures = self.failures.saturating_add(1);
        self.delay_before_next_attempt()
    }

    /// A successful login resets the failure count (and thus the delays).
    pub fn record_success(&mut self) {
        self.failures = 0;
    }

    /// The delay to enforce before the next attempt: `0` while at or below the
    /// limit, then doubling delays starting at 1 second, capped at
    /// `cap_secs` (60).
    pub fn delay_before_next_attempt(&self) -> Duration {
        if self.failures <= self.max_failures {
            return Duration::ZERO;
        }
        let n = self.failures - self.max_failures;
        let exp = (n - 1).min(63);
        let secs = 1u64.checked_shl(exp).unwrap_or(u64::MAX);
        Duration::from_secs(secs.min(self.cap_secs))
    }
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self::new()
    }
}

/// Command-level errors. Serializes to the frontend; never carries secrets.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, thiserror::Error)]
pub enum CommandError {
    #[error("vault is locked")]
    Locked,
    #[error("too many failed attempts; try again in {seconds} seconds")]
    Backoff { seconds: u64 },
    #[error("incorrect master password")]
    AuthenticationFailed,
    #[error("vault has not been initialized")]
    VaultNotInitialized,
    #[error("vault is already initialized")]
    AlreadyInitialized,
    #[error("invalid category")]
    InvalidCategory,
    #[error("entry not found")]
    NotFound,
    #[error("invalid record id or field")]
    InvalidField,
    #[error("crypto failure: {0}")]
    Crypto(String),
    #[error("persistence failure: {0}")]
    Store(String),
    #[error("clipboard failure: {0}")]
    Clipboard(String),
    #[error("backup failure: {0}")]
    Backup(String),
}

impl From<CryptoError> for CommandError {
    fn from(e: CryptoError) -> Self {
        CommandError::Crypto(e.to_string())
    }
}

impl From<RepositoryError> for CommandError {
    fn from(e: RepositoryError) -> Self {
        match e {
            RepositoryError::NotFound => CommandError::NotFound,
            RepositoryError::Store(s) => CommandError::Store(s),
        }
    }
}

impl From<ServiceError> for CommandError {
    fn from(e: ServiceError) -> Self {
        match e {
            ServiceError::Crypto(c) => CommandError::Crypto(c.to_string()),
            ServiceError::Repository(r) => CommandError::from(r),
            ServiceError::InvalidCategory => CommandError::InvalidCategory,
            ServiceError::NotFound => CommandError::NotFound,
        }
    }
}

impl From<ClipboardError> for CommandError {
    fn from(e: ClipboardError) -> Self {
        CommandError::Clipboard(e.to_string())
    }
}

impl From<BackupError> for CommandError {
    fn from(e: BackupError) -> Self {
        match e {
            BackupError::Locked => CommandError::Locked,
            BackupError::NoVaultFile => CommandError::Backup(e.to_string()),
            BackupError::Store(s) | BackupError::Io(s) => CommandError::Backup(s),
        }
    }
}

// ---------------------------------------------------------------------------
// IPC DTOs (design "Interfaces / Contracts"). SecretString serializes as the
// plaintext string the frontend needs (via `serialize_secret`, since secrecy
// deliberately does not blanket-serialize secrets) while Debug stays masked.
// ---------------------------------------------------------------------------

/// Serialize a `SecretString` as its plaintext — the wire form the frontend
/// needs (unlock password, decrypted entry password). Deserialization is
/// provided by secrecy itself.
fn serialize_secret<S>(value: &SecretString, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(value.expose_secret())
}

/// Input for vault creation and unlock: just the master password.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UnlockRequest {
    #[serde(serialize_with = "serialize_secret")]
    pub master_password: SecretString,
}

/// Input for creating or updating an entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EntryInputDto {
    pub site: String,
    pub link: String,
    #[serde(serialize_with = "serialize_secret")]
    pub password: SecretString,
    pub email: String,
    pub username: String,
    pub category: String,
}

/// Metadata-only entry view (no secret material).
#[derive(Debug, Clone, serde::Serialize)]
pub struct EntrySummaryDto {
    pub id: String,
    pub site: String,
    pub link: String,
    pub email: String,
    pub username: String,
    pub category: String,
}

/// Full entry view; `password` is transient (design: transient DTO field).
#[derive(Debug, Clone, serde::Serialize)]
pub struct EntryDetailsDto {
    pub summary: EntrySummaryDto,
    #[serde(serialize_with = "serialize_secret")]
    pub password: SecretString,
}

/// Search/filter criteria (all combine conjunctively).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct FilterDto {
    pub site: Option<String>,
    pub category: Option<String>,
    pub email: Option<String>,
}

/// Which entry field to copy (vault-entries: link, password, email, username).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CopyField {
    Password,
    Link,
    Email,
    Username,
}

impl From<EntryInputDto> for EntryInput {
    fn from(dto: EntryInputDto) -> Self {
        EntryInput::new(
            dto.site,
            dto.link,
            dto.password,
            dto.email,
            dto.username,
            dto.category,
        )
    }
}

impl From<EntrySummary> for EntrySummaryDto {
    fn from(s: EntrySummary) -> Self {
        Self {
            id: s.id.to_string(),
            site: s.site,
            link: s.link,
            email: s.email,
            username: s.username,
            category: s.category,
        }
    }
}

impl From<EntryDetails> for EntryDetailsDto {
    fn from(d: EntryDetails) -> Self {
        Self {
            summary: d.summary.into(),
            password: d.password,
        }
    }
}

impl From<FilterDto> for Filters {
    fn from(f: FilterDto) -> Self {
        let mut filters = Filters::new();
        filters.site = f.site;
        filters.category = f.category;
        filters.email = f.email;
        filters
    }
}

// ---------------------------------------------------------------------------
// Application state: one instance managed by the Tauri shell.
// ---------------------------------------------------------------------------

/// Makes a shared, mutex-guarded repository usable as a [`VaultRepository`]:
/// the Tauri layer serializes all repository access through one `Mutex`.
impl VaultRepository for Arc<Mutex<SqliteVaultRepository>> {
    fn list(&self, filters: &Filters) -> Result<Vec<EntryRecord>, RepositoryError> {
        self.lock().unwrap().list(filters)
    }

    fn save(&self, entry: &EntryRecord) -> Result<(), RepositoryError> {
        self.lock().unwrap().save(entry)
    }

    fn delete(&self, id: &RecordId) -> Result<(), RepositoryError> {
        self.lock().unwrap().delete(id)
    }
}

/// The managed application state behind every Tauri command.
pub struct VaultApp {
    repo: Arc<Mutex<SqliteVaultRepository>>,
    service: VaultService<Arc<Mutex<SqliteVaultRepository>>, Argon2Aes, Argon2Aes>,
    kdf: Argon2Aes,
    cipher: Argon2Aes,
    session: Arc<Mutex<Option<Session>>>,
    backoff: Mutex<BackoffPolicy>,
    clipboard: Clipboard,
    backup: BackupService,
}

impl VaultApp {
    pub fn new(repo: SqliteVaultRepository, clipboard: Clipboard) -> Self {
        let shared = Arc::new(Mutex::new(repo));
        let service = VaultService::new(Arc::clone(&shared), Argon2Aes, Argon2Aes);
        let backup = BackupService::new(Arc::clone(&shared));
        Self {
            repo: shared,
            service,
            kdf: Argon2Aes,
            cipher: Argon2Aes,
            session: Arc::new(Mutex::new(None)),
            backoff: Mutex::new(BackoffPolicy::new()),
            clipboard,
            backup,
        }
    }

    // -- vault lifecycle -----------------------------------------------------

    /// Initialize a fresh vault with `master_password`. Refused once the vault
    /// is already initialized; does NOT unlock (the user then unlocks).
    pub fn create_vault(&self, master_password: SecretString) -> Result<(), CommandError> {
        let repo = self.repo.lock().unwrap();
        if repo.is_initialized()? {
            return Err(CommandError::AlreadyInitialized);
        }
        let salt = self.kdf.random_salt();
        let key = self.kdf.derive(master_password, &salt)?;
        let validation = self
            .cipher
            .encrypt(&VALIDATION_ID, &key, secret(VALIDATION_SECRET))?;
        repo.init_vault(salt, &validation)?;
        Ok(())
    }

    /// Unlock by deriving the key from `master_password` and authenticating it
    /// against the stored validation record (vault-session "Authenticated
    /// login"). Applies backoff after repeated failures.
    pub fn unlock(&self, master_password: SecretString) -> Result<(), CommandError> {
        self.check_auto_lock();

        // Enforce the backoff delay before allowing another attempt.
        {
            let backoff = self.backoff.lock().unwrap();
            let delay = backoff.delay_before_next_attempt();
            if delay > Duration::ZERO {
                return Err(CommandError::Backoff {
                    seconds: delay.as_secs(),
                });
            }
        }

        let (salt, validation) = {
            let repo = self.repo.lock().unwrap();
            let meta = repo
                .vault_metadata()?
                .ok_or(CommandError::VaultNotInitialized)?;
            (meta.salt, meta.validation)
        };

        let key = self.kdf.derive(master_password, &salt)?;
        match self.cipher.decrypt(&VALIDATION_ID, &key, &validation) {
            Ok(_) => {
                self.backoff.lock().unwrap().record_success();
                *self.session.lock().unwrap() = Some(Session::new(key));
                Ok(())
            }
            Err(_) => {
                self.backoff.lock().unwrap().record_failure();
                Err(CommandError::AuthenticationFailed)
            }
        }
    }

    /// Lock immediately: the session is taken and zeroized (key cleared).
    pub fn lock(&self) {
        let mut guard = self.session.lock().unwrap();
        if let Some(mut session) = guard.take() {
            session.zeroize();
        }
    }

    pub fn is_locked(&self) -> bool {
        self.check_auto_lock();
        self.session.lock().unwrap().is_none()
    }

    /// Lock if the session's inactivity timeout elapsed. Returns true when it
    /// locked. Also invoked periodically by the desktop shell's background
    /// thread so an idle app locks even with no commands arriving.
    pub fn check_auto_lock(&self) -> bool {
        let mut guard = self.session.lock().unwrap();
        let expired = guard
            .as_ref()
            .map(|s| s.is_expired(SESSION_TIMEOUT))
            .unwrap_or(false);
        if expired {
            if let Some(mut session) = guard.take() {
                session.zeroize();
            }
        }
        expired
    }

    /// User activity: resets the inactivity clock (no-op while locked).
    pub fn record_activity(&self) {
        self.check_auto_lock();
        if let Some(session) = self.session.lock().unwrap().as_mut() {
            session.touch();
        }
    }

    // -- entry use cases -----------------------------------------------------

    pub fn list_entries(&self, filters: &Filters) -> Result<Vec<EntrySummary>, CommandError> {
        self.require_unlocked()?;
        Ok(self.service.list_entries(filters)?)
    }

    pub fn get_entry_details(&self, id: &RecordId) -> Result<EntryDetails, CommandError> {
        self.with_key(|key| Ok(self.service.get_entry_details(id, key)?))
    }

    pub fn create_entry(&self, input: &EntryInput) -> Result<RecordId, CommandError> {
        self.with_key(|key| {
            let mut bytes = [0u8; 16];
            OsRng.fill_bytes(&mut bytes);
            let id = RecordId(bytes);
            self.service.create_entry(id, key, input)?;
            Ok(id)
        })
    }

    pub fn update_entry(&self, id: &RecordId, input: &EntryInput) -> Result<(), CommandError> {
        self.with_key(|key| Ok(self.service.update_entry(*id, key, input)?))
    }

    pub fn delete_entry(&self, id: &RecordId) -> Result<(), CommandError> {
        self.require_unlocked()?;
        Ok(self.service.delete_entry(id)?)
    }

    // -- backup / clipboard --------------------------------------------------

    /// Export the vault to `dest` in its native encrypted format. Refused when
    /// locked (vault-backup "Safe export availability").
    pub fn export_backup(&self, dest: &Path) -> Result<(), CommandError> {
        self.require_unlocked()?;
        Ok(self.backup.export(true, dest)?)
    }

    /// Copy a field to the clipboard with the 20s conditional clear. Refused
    /// while locked (vault-entries "Copy is unavailable while locked").
    pub fn copy_field(&self, id: &RecordId, field: CopyField) -> Result<(), CommandError> {
        let value: SecretString = self.with_key(|key| match field {
            CopyField::Password => Ok(self.service.get_entry_details(id, key)?.password),
            CopyField::Link | CopyField::Email | CopyField::Username => {
                let summaries = self.service.list_entries(&Filters::new())?;
                let summary = summaries
                    .into_iter()
                    .find(|s| &s.id == id)
                    .ok_or(CommandError::NotFound)?;
                let text = match field {
                    CopyField::Link => summary.link,
                    CopyField::Email => summary.email,
                    CopyField::Username => summary.username,
                    CopyField::Password => unreachable!("handled above"),
                };
                Ok(secret(&text))
            }
        })?;
        self.clipboard.copy_for(value, CLIPBOARD_EXPIRY)?;
        Ok(())
    }

    // -- helpers --------------------------------------------------------------

    /// Gate a command on an unlocked, non-expired session, touching the
    /// activity clock on success.
    fn require_unlocked(&self) -> Result<(), CommandError> {
        self.check_auto_lock();
        let mut guard = self.session.lock().unwrap();
        match guard.as_mut() {
            Some(session) => {
                session.touch();
                Ok(())
            }
            None => Err(CommandError::Locked),
        }
    }

    /// Run `f` with the live session key (only reachable when unlocked).
    fn with_key<T>(
        &self,
        f: impl FnOnce(&VaultKey) -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        self.require_unlocked()?;
        let guard = self.session.lock().unwrap();
        let session = guard.as_ref().expect("require_unlocked guarantees a session");
        f(&session.key)
    }
}

fn secret(s: &str) -> SecretString {
    SecretString::from(s.to_string())
}

// ---------------------------------------------------------------------------
// Desktop shell glue — compiled only with `--features tauri-app`.
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-app")]
use tauri::Manager;

/// Wire the application state and all typed commands into the Tauri builder,
/// and start the background auto-lock thread.
#[cfg(feature = "tauri-app")]
pub fn build(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .setup(|app| {
            // The vault database lives in the platform app-data directory.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let repo = SqliteVaultRepository::open(data_dir.join("vault.db"))?;
            let clipboard = Clipboard::new()?;
            let state = VaultApp::new(repo, clipboard);
            app.manage(state);
            spawn_auto_lock_thread(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_vault,
            unlock,
            lock,
            list,
            get_entry_details,
            create,
            update,
            delete,
            export,
            copy_field,
            record_activity
        ])
}

/// Background thread that locks the vault after 5 minutes of inactivity even
/// when no command is ever invoked.
#[cfg(feature = "tauri-app")]
fn spawn_auto_lock_thread(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(AUTO_LOCK_CHECK_INTERVAL);
        if let Some(state) = app.try_state::<VaultApp>() {
            state.check_auto_lock();
        }
    });
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn create_vault(state: tauri::State<'_, VaultApp>, req: UnlockRequest) -> Result<(), CommandError> {
    state.create_vault(req.master_password)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn unlock(state: tauri::State<'_, VaultApp>, req: UnlockRequest) -> Result<(), CommandError> {
    state.unlock(req.master_password)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn lock(state: tauri::State<'_, VaultApp>) -> Result<(), CommandError> {
    state.lock();
    Ok(())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn list(
    state: tauri::State<'_, VaultApp>,
    filters: Option<FilterDto>,
) -> Result<Vec<EntrySummaryDto>, CommandError> {
    let filters = filters.map(Into::into).unwrap_or_default();
    let entries = state.list_entries(&filters)?;
    Ok(entries.into_iter().map(EntrySummaryDto::from).collect())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn get_entry_details(
    state: tauri::State<'_, VaultApp>,
    id: String,
) -> Result<EntryDetailsDto, CommandError> {
    let id: RecordId = id.parse().map_err(|_| CommandError::InvalidField)?;
    Ok(state.get_entry_details(&id)?.into())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn create(
    state: tauri::State<'_, VaultApp>,
    input: EntryInputDto,
) -> Result<String, CommandError> {
    let input: EntryInput = input.into();
    let id = state.create_entry(&input)?;
    Ok(id.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn update(
    state: tauri::State<'_, VaultApp>,
    id: String,
    input: EntryInputDto,
) -> Result<(), CommandError> {
    let id: RecordId = id.parse().map_err(|_| CommandError::InvalidField)?;
    state.update_entry(&id, &input.into())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn delete(state: tauri::State<'_, VaultApp>, id: String) -> Result<(), CommandError> {
    let id: RecordId = id.parse().map_err(|_| CommandError::InvalidField)?;
    state.delete_entry(&id)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn export(state: tauri::State<'_, VaultApp>, path: String) -> Result<(), CommandError> {
    state.export_backup(Path::new(&path))
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn copy_field(
    state: tauri::State<'_, VaultApp>,
    id: String,
    field: CopyField,
) -> Result<(), CommandError> {
    let id: RecordId = id.parse().map_err(|_| CommandError::InvalidField)?;
    state.copy_field(&id, field)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn record_activity(state: tauri::State<'_, VaultApp>) -> Result<(), CommandError> {
    state.record_activity();
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;
    use crate::adapters::clipboard::tests::FakeClipboard;
    use crate::core::domain::entry::{Filters, INITIAL_CATEGORIES};
    use tempfile::TempDir;

    const MASTER_PASSWORD: &str = "correct horse battery staple";

    fn test_key() -> VaultKey {
        Argon2Aes
            .derive(secret(MASTER_PASSWORD), &[7u8; 16])
            .unwrap()
    }

    fn app() -> VaultApp {
        let repo = SqliteVaultRepository::open_in_memory().unwrap();
        let clipboard = Clipboard::with_backend(Box::new(FakeClipboard::new()));
        VaultApp::new(repo, clipboard)
    }

    fn unlocked_app() -> VaultApp {
        let app = app();
        app.create_vault(secret(MASTER_PASSWORD)).unwrap();
        app.unlock(secret(MASTER_PASSWORD)).unwrap();
        app
    }

    fn unlocked_app_with_clipboard() -> (VaultApp, FakeClipboard) {
        let repo = SqliteVaultRepository::open_in_memory().unwrap();
        let fake = FakeClipboard::new();
        let clipboard = Clipboard::with_backend(Box::new(fake.clone()));
        let app = VaultApp::new(repo, clipboard);
        app.create_vault(secret(MASTER_PASSWORD)).unwrap();
        app.unlock(secret(MASTER_PASSWORD)).unwrap();
        (app, fake)
    }

    fn file_app(dir: &TempDir) -> VaultApp {
        let repo = SqliteVaultRepository::open(dir.path().join("vault.db")).unwrap();
        let clipboard = Clipboard::with_backend(Box::new(FakeClipboard::new()));
        VaultApp::new(repo, clipboard)
    }

    fn entry_input(site: &str, password: &str) -> EntryInput {
        EntryInput::new(
            site,
            format!("https://{site}"),
            secret(password),
            "a@b.c",
            "user",
            INITIAL_CATEGORIES[0],
        )
    }

    fn rid(n: u8) -> RecordId {
        RecordId([n; 16])
    }

    // -----------------------------------------------------------------------
    // Backoff policy (vault-session "Bounded login attempts").
    // -----------------------------------------------------------------------

    #[test]
    fn backoff_allows_failures_up_to_limit() {
        let mut policy = BackoffPolicy::new();
        for _ in 0..5 {
            assert_eq!(policy.record_failure(), Duration::ZERO);
        }
    }

    #[test]
    fn backoff_increases_after_limit() {
        let mut policy = BackoffPolicy::new();
        for _ in 0..5 {
            policy.record_failure();
        }
        assert_eq!(policy.record_failure(), Duration::from_secs(1));
        assert_eq!(policy.record_failure(), Duration::from_secs(2));
        assert_eq!(policy.record_failure(), Duration::from_secs(4));
        assert_eq!(policy.record_failure(), Duration::from_secs(8));
        assert_eq!(policy.record_failure(), Duration::from_secs(16));
    }

    #[test]
    fn backoff_caps_at_sixty_seconds() {
        let mut policy = BackoffPolicy::new();
        for _ in 0..12 {
            policy.record_failure();
        }
        assert_eq!(policy.delay_before_next_attempt(), Duration::from_secs(60));
        // Further failures stay capped.
        policy.record_failure();
        assert_eq!(policy.delay_before_next_attempt(), Duration::from_secs(60));
    }

    #[test]
    fn backoff_resets_on_success() {
        let mut policy = BackoffPolicy::new();
        for _ in 0..7 {
            policy.record_failure();
        }
        assert_eq!(policy.delay_before_next_attempt(), Duration::from_secs(2));
        policy.record_success();
        assert_eq!(policy.failure_count(), 0);
        assert_eq!(policy.record_failure(), Duration::ZERO);
    }

    #[test]
    fn backoff_limit_is_configurable() {
        let mut policy = BackoffPolicy::new().with_max_failures(2);
        assert_eq!(policy.record_failure(), Duration::ZERO);
        assert_eq!(policy.record_failure(), Duration::ZERO);
        assert_eq!(policy.record_failure(), Duration::from_secs(1));
    }

    // -----------------------------------------------------------------------
    // Lock clears secrets (vault-session "Lock clears secrets").
    // -----------------------------------------------------------------------

    #[test]
    fn lock_zeroizes_session_key_bytes() {
        let mut session = Session::new(test_key());
        let ptr = session.key.expose_secret().as_ptr();
        session.zeroize();
        let bytes = unsafe { std::slice::from_raw_parts(ptr, 32) };
        assert_eq!(bytes, &[0u8; 32], "zeroized key bytes must be all zero");
    }

    #[test]
    fn dropping_session_zeroizes_key_via_secret_drop() {
        // Exercise the actual drop path lock uses: take, zeroize, drop.
        let session = Session::new(test_key());
        let mut boxed = Box::new(session);
        let ptr = boxed.key.expose_secret().as_ptr();
        unsafe {
            std::ptr::drop_in_place(&mut *boxed);
        }
        // The allocation survives (we forget the box), so we can inspect it.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, 32) };
        assert_eq!(bytes, &[0u8; 32], "dropped session key must be zeroized");
        std::mem::forget(boxed);
    }

    #[test]
    fn app_lock_clears_session() {
        let app = unlocked_app();
        assert!(!app.is_locked());
        app.lock();
        assert!(app.is_locked());
        assert_eq!(
            app.list_entries(&Filters::new()).unwrap_err(),
            CommandError::Locked
        );
    }

    // -----------------------------------------------------------------------
    // Auto-lock after inactivity (vault-session "Automatic lock").
    // -----------------------------------------------------------------------

    #[test]
    fn auto_lock_locks_expired_session() {
        let app = unlocked_app();
        {
            let mut guard = app.session.lock().unwrap();
            let session = guard.as_mut().unwrap();
            session.touch_at(Instant::now() - SESSION_TIMEOUT - Duration::from_secs(1));
        }
        assert!(app.check_auto_lock(), "expired session must auto-lock");
        assert!(app.is_locked());
        assert_eq!(
            app.list_entries(&Filters::new()).unwrap_err(),
            CommandError::Locked
        );
    }

    #[test]
    fn auto_lock_keeps_active_session_unlocked() {
        let app = unlocked_app();
        assert!(!app.check_auto_lock());
        assert!(!app.is_locked());
    }

    #[test]
    fn record_activity_touches_session_and_is_safe_when_locked() {
        let app = unlocked_app();
        app.record_activity();
        assert!(!app.is_locked());
        app.lock();
        app.record_activity(); // no-op, must not panic or unlock
        assert!(app.is_locked());
    }

    // -----------------------------------------------------------------------
    // Vault lifecycle and backoff through the command surface.
    // -----------------------------------------------------------------------

    #[test]
    fn create_then_unlock_roundtrip() {
        let app = app();
        assert_eq!(
            app.unlock(secret(MASTER_PASSWORD)).unwrap_err(),
            CommandError::VaultNotInitialized
        );
        app.create_vault(secret(MASTER_PASSWORD)).unwrap();
        assert!(app.is_locked(), "create must not auto-unlock");
        assert_eq!(
            app.create_vault(secret(MASTER_PASSWORD)).unwrap_err(),
            CommandError::AlreadyInitialized
        );
        assert_eq!(
            app.unlock(secret("wrong password")).unwrap_err(),
            CommandError::AuthenticationFailed
        );
        assert!(app.is_locked());
        app.unlock(secret(MASTER_PASSWORD)).unwrap();
        assert!(!app.is_locked());
    }

    #[test]
    fn unlock_enforces_backoff_after_five_failures() {
        let app = app();
        app.create_vault(secret(MASTER_PASSWORD)).unwrap();
        for _ in 0..5 {
            assert_eq!(
                app.unlock(secret("wrong")).unwrap_err(),
                CommandError::AuthenticationFailed
            );
        }
        // The 6th failure is still allowed but fails authentication.
        assert_eq!(
            app.unlock(secret("wrong")).unwrap_err(),
            CommandError::AuthenticationFailed
        );
        // The 7th attempt is rejected by the 1s backoff delay.
        assert_eq!(
            app.unlock(secret(MASTER_PASSWORD)).unwrap_err(),
            CommandError::Backoff { seconds: 1 }
        );
    }

    #[test]
    fn successful_unlock_resets_backoff() {
        let app = app();
        app.create_vault(secret(MASTER_PASSWORD)).unwrap();
        assert_eq!(
            app.unlock(secret("wrong")).unwrap_err(),
            CommandError::AuthenticationFailed
        );
        app.unlock(secret(MASTER_PASSWORD)).unwrap();
        app.lock();
        // One failure after a reset does not trigger backoff.
        assert_eq!(
            app.unlock(secret("wrong")).unwrap_err(),
            CommandError::AuthenticationFailed
        );
        assert!(app.unlock(secret(MASTER_PASSWORD)).is_ok());
    }

    // -----------------------------------------------------------------------
    // Entry use cases through the command surface.
    // -----------------------------------------------------------------------

    #[test]
    fn entry_crud_through_commands() {
        let app = unlocked_app();
        let id = app.create_entry(&entry_input("github", "s3cr3t")).unwrap();

        let details = app.get_entry_details(&id).unwrap();
        assert_eq!(details.summary.site, "github");
        assert_eq!(details.password.expose_secret(), "s3cr3t");

        let list = app.list_entries(&Filters::new()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);

        app.update_entry(&id, &entry_input("github", "new-secret")).unwrap();
        assert_eq!(app.get_entry_details(&id).unwrap().password.expose_secret(), "new-secret");

        app.delete_entry(&id).unwrap();
        assert!(app.list_entries(&Filters::new()).unwrap().is_empty());
        assert_eq!(app.delete_entry(&id).unwrap_err(), CommandError::NotFound);
    }

    #[test]
    fn entry_commands_refused_when_locked() {
        let app = unlocked_app();
        app.lock();
        assert_eq!(
            app.create_entry(&entry_input("x", "y")).unwrap_err(),
            CommandError::Locked
        );
        assert_eq!(
            app.get_entry_details(&rid(1)).unwrap_err(),
            CommandError::Locked
        );
        assert_eq!(app.delete_entry(&rid(1)).unwrap_err(), CommandError::Locked);
    }

    #[test]
    fn list_applies_filters() {
        let app = unlocked_app();
        app.create_entry(&entry_input("github", "a")).unwrap();
        app.create_entry(&entry_input("gitlab", "b")).unwrap();

        let filters = Filters::new().with_site("git");
        assert_eq!(app.list_entries(&filters).unwrap().len(), 2);
        let filters = Filters::new().with_site("gitlab");
        assert_eq!(app.list_entries(&filters).unwrap().len(), 1);
    }

    // -----------------------------------------------------------------------
    // Clipboard commands (vault-entries "Copy an allowed value").
    // -----------------------------------------------------------------------

    #[test]
    fn copy_field_places_password_and_metadata() {
        let (app, fake) = unlocked_app_with_clipboard();
        let id = app
            .create_entry(&entry_input("github", "s3cr3t"))
            .unwrap();

        app.copy_field(&id, CopyField::Password).unwrap();
        assert_eq!(fake.current().as_deref(), Some("s3cr3t"));
        app.copy_field(&id, CopyField::Link).unwrap();
        assert_eq!(fake.current().as_deref(), Some("https://github"));
        app.copy_field(&id, CopyField::Email).unwrap();
        assert_eq!(fake.current().as_deref(), Some("a@b.c"));
        app.copy_field(&id, CopyField::Username).unwrap();
        assert_eq!(fake.current().as_deref(), Some("user"));
    }

    #[test]
    fn copy_field_refused_when_locked() {
        let (app, fake) = unlocked_app_with_clipboard();
        app.lock();
        assert_eq!(
            app.copy_field(&rid(1), CopyField::Password).unwrap_err(),
            CommandError::Locked
        );
        assert_eq!(fake.current(), None, "no secret may reach the clipboard while locked");
    }

    // -----------------------------------------------------------------------
    // Backup command (vault-backup "Safe export availability").
    // -----------------------------------------------------------------------

    #[test]
    fn export_command_refuses_locked_and_exports_when_unlocked() {
        let dir = TempDir::new().unwrap();
        let app = file_app(&dir);
        let dest = dir.path().join("backup.db");

        assert_eq!(app.export_backup(&dest).unwrap_err(), CommandError::Locked);
        assert!(!dest.exists());

        app.create_vault(secret(MASTER_PASSWORD)).unwrap();
        app.unlock(secret(MASTER_PASSWORD)).unwrap();
        app.export_backup(&dest).unwrap();
        assert!(dest.exists());

        let reopened = SqliteVaultRepository::open(&dest).unwrap();
        assert!(reopened.is_initialized().unwrap());
    }
}