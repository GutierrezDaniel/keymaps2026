//! System clipboard adapter with expiry-based conditional clearing.
//!
//! Implements the [`ClipboardPort`] port: copies a secret value and schedules a
//! background clear after [`CLIPBOARD_EXPIRY`] (20 seconds, per vault-entries
//! "Clipboard expiration"). The clear is *conditional*: it only wipes the
//! clipboard when the current content still equals the value we copied, so a
//! newer clipboard copy made by the user is never destroyed (design decision
//! "Locking and clipboard").
//!
//! The real backend is `arboard`; the [`SystemClipboard`] boundary lets tests
//! substitute an in-memory fake so the timing/conditional logic is exercised
//! headlessly.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use secrecy::{ExposeSecret, SecretString};
use zeroize::Zeroizing;

use crate::core::ports::clipboard::{ClipboardError, ClipboardPort};

/// How long a copied secret stays on the clipboard before the conditional
/// clear runs (spec: 20 seconds).
pub const CLIPBOARD_EXPIRY: Duration = Duration::from_secs(20);

/// System clipboard backend boundary, injectable for tests. `arboard` exposes
/// its operations through `&mut self`, so the trait mirrors that.
pub(crate) trait SystemClipboard: Send {
    fn set_text(&mut self, text: &str) -> Result<(), ClipboardError>;
    fn get_text(&mut self) -> Result<String, ClipboardError>;
    fn clear(&mut self) -> Result<(), ClipboardError>;
}

/// `arboard`-backed system clipboard.
struct ArboardBackend(arboard::Clipboard);

impl SystemClipboard for ArboardBackend {
    fn set_text(&mut self, text: &str) -> Result<(), ClipboardError> {
        self.0.set_text(text).map_err(access_err)
    }

    fn get_text(&mut self) -> Result<String, ClipboardError> {
        self.0.get_text().map_err(access_err)
    }

    fn clear(&mut self) -> Result<(), ClipboardError> {
        self.0.clear().map_err(access_err)
    }
}

/// Runs `action` once `expiry` has elapsed. Production spawns a thread; tests
/// hold the action and fire it manually, so no test waits on the wall clock
/// (RUST-AUDIT F19).
type Scheduler = Arc<dyn Fn(Duration, Box<dyn FnOnce() + Send>) + Send + Sync>;

/// Copies a secret for a bounded expiry, then conditionally clears it.
///
/// The clear is scheduled for after `expiry`: it re-reads the clipboard and only
/// clears when the value is unchanged. Errors during the clear are intentionally
/// swallowed — losing the clear is not a failure of the copy operation, and a
/// failed read means we cannot prove ownership of the current value, so we
/// leave it alone.
pub struct Clipboard {
    inner: Arc<Mutex<Box<dyn SystemClipboard>>>,
    scheduler: Scheduler,
}

/// Production scheduler: one detached thread per scheduled clear.
fn thread_scheduler() -> Scheduler {
    Arc::new(|expiry: Duration, action: Box<dyn FnOnce() + Send>| {
        std::thread::spawn(move || {
            std::thread::sleep(expiry);
            action();
        });
    })
}

impl Clipboard {
    /// Open the real system clipboard (requires a desktop session).
    pub fn new() -> Result<Self, ClipboardError> {
        let backend = arboard::Clipboard::new().map_err(access_err)?;
        Ok(Self::with_backend(Box::new(ArboardBackend(backend))))
    }

    /// Build an adapter over an injected backend (used by tests).
    pub(crate) fn with_backend(backend: Box<dyn SystemClipboard>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(backend)),
            scheduler: thread_scheduler(),
        }
    }

    /// Build an adapter whose clears run when the test says so.
    #[cfg(test)]
    pub(crate) fn with_scheduler(
        backend: Box<dyn SystemClipboard>,
        scheduler: Scheduler,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(backend)),
            scheduler,
        }
    }
}

impl ClipboardPort for Clipboard {
    fn copy_for(&self, value: SecretString, expiry: Duration) -> Result<(), ClipboardError> {
        // Keep a zeroizing copy of the copied value so the clearing thread can
        // compare without holding a second plaintext secret forever.
        let copied = Zeroizing::new(value.expose_secret().to_string());
        self.inner.lock().unwrap().set_text(&copied)?;

        let inner = Arc::clone(&self.inner);
        (self.scheduler)(expiry, Box::new(move || {
            let mut guard = inner.lock().unwrap();
            // Conditional clear: only wipe when the current clipboard content is
            // still the value we placed there.
            // The clipboard content read back is the secret we placed there:
            // compare it inside a zeroizing wrapper so the comparison does not
            // leave a plaintext copy behind (RUST-AUDIT F10).
            let unchanged = match guard.get_text() {
                Ok(current) => Zeroizing::new(current).as_str() == copied.as_str(),
                Err(_) => false,
            };
            if unchanged {
                let _ = guard.clear();
            }
        }));
        Ok(())
    }
}

fn access_err(e: arboard::Error) -> ClipboardError {
    ClipboardError::Access(e.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::Mutex;

    use super::*;

    /// In-memory clipboard used to exercise the copy/clear logic headlessly.
    /// `Clone` shares the underlying state, so the test handle and the boxed
    /// backend observe the same clipboard.
    #[derive(Clone)]
    pub(crate) struct FakeClipboard {
        state: Arc<Mutex<Option<String>>>,
        reads_fail: Arc<std::sync::atomic::AtomicBool>,
    }

    impl FakeClipboard {
        pub(crate) fn new() -> Self {
            Self {
                state: Arc::new(Mutex::new(None)),
                reads_fail: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            }
        }

        /// Make every subsequent read fail, simulating an unavailable backend.
        pub(crate) fn fail_reads(&self) {
            self.reads_fail
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }

        pub(crate) fn current(&self) -> Option<String> {
            self.state.lock().unwrap().clone()
        }

        /// Simulate the user copying something else over our value.
        pub(crate) fn overwrite(&self, text: &str) {
            *self.state.lock().unwrap() = Some(text.to_string());
        }
    }

    impl SystemClipboard for FakeClipboard {
        fn set_text(&mut self, text: &str) -> Result<(), ClipboardError> {
            *self.state.lock().unwrap() = Some(text.to_string());
            Ok(())
        }

        fn get_text(&mut self) -> Result<String, ClipboardError> {
            if self
                .reads_fail
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return Err(ClipboardError::Access("fake backend unavailable".into()));
            }
            Ok(self.state.lock().unwrap().clone().unwrap_or_default())
        }

        fn clear(&mut self) -> Result<(), ClipboardError> {
            *self.state.lock().unwrap() = None;
            Ok(())
        }
    }

    /// Captures the scheduled clear instead of waiting for it, so the timing
    /// tests are deterministic: they fire the clear when the scenario says so.
    #[derive(Clone, Default)]
    struct ManualScheduler {
        pending: Arc<Mutex<Vec<(Duration, Box<dyn FnOnce() + Send>)>>>,
    }

    impl ManualScheduler {
        fn scheduler(&self) -> Scheduler {
            let pending = Arc::clone(&self.pending);
            Arc::new(move |expiry, action| {
                pending.lock().unwrap().push((expiry, action));
            })
        }

        /// Run every captured clear, oldest first.
        fn run_pending(&self) {
            let pending: Vec<_> = std::mem::take(&mut *self.pending.lock().unwrap());
            for (_, action) in pending {
                action();
            }
        }

        fn expiry(&self) -> Option<Duration> {
            self.pending.lock().unwrap().first().map(|(d, _)| *d)
        }
    }

    fn fake() -> (Clipboard, FakeClipboard, ManualScheduler) {
        let backend = FakeClipboard::new();
        let scheduler = ManualScheduler::default();
        let clipboard =
            Clipboard::with_scheduler(Box::new(backend.clone()), scheduler.scheduler());
        (clipboard, backend, scheduler)
    }

    fn secret(s: &str) -> SecretString {
        SecretString::from(s.to_string())
    }

    /// The production scheduler must actually run the action. Expiry zero keeps
    /// this deterministic: the worker signals immediately and the test blocks on
    /// the channel instead of polling.
    #[test]
    fn the_thread_scheduler_runs_the_scheduled_action() {
        let (tx, rx) = std::sync::mpsc::channel();
        thread_scheduler()(Duration::ZERO, Box::new(move || {
            let _ = tx.send(());
        }));
        rx.recv_timeout(Duration::from_secs(5))
            .expect("the scheduler must run the action");
    }

    #[test]
    fn copy_places_value_on_clipboard() {
        let (clipboard, backend, scheduler) = fake();
        clipboard
            .copy_for(secret("s3cr3t!"), Duration::from_secs(30))
            .unwrap();
        assert_eq!(backend.current().as_deref(), Some("s3cr3t!"));
        assert_eq!(
            scheduler.expiry(),
            Some(Duration::from_secs(30)),
            "the clear must be scheduled for the requested expiry"
        );
    }

    /// vault-entries "Clipboard expiration": the value is cleared once the
    /// scheduled expiry fires.
    #[test]
    fn clears_copied_value_after_expiry_when_unchanged() {
        let (clipboard, backend, scheduler) = fake();
        clipboard
            .copy_for(secret("s3cr3t!"), CLIPBOARD_EXPIRY)
            .unwrap();

        scheduler.run_pending();

        assert!(backend.current().is_none(), "clipboard must clear after expiry");
    }

    /// The clear must never destroy a newer clipboard copy (design: "avoids
    /// destroying a newer clipboard copy").
    #[test]
    fn does_not_clear_when_clipboard_was_changed() {
        let (clipboard, backend, scheduler) = fake();
        clipboard
            .copy_for(secret("mine"), CLIPBOARD_EXPIRY)
            .unwrap();
        // The user copies something else before the expiry elapses.
        backend.overwrite("newer copy");

        scheduler.run_pending();

        assert_eq!(backend.current().as_deref(), Some("newer copy"));
    }

    /// A clear that cannot read the clipboard leaves the value alone: we cannot
    /// prove ownership, so destroying it would be worse than keeping it.
    #[test]
    fn failed_read_keeps_the_clipboard_untouched() {
        let (clipboard, backend, scheduler) = fake();
        clipboard
            .copy_for(secret("mine"), CLIPBOARD_EXPIRY)
            .unwrap();
        backend.overwrite("newer copy");
        backend.fail_reads();

        scheduler.run_pending();

        assert_eq!(backend.current().as_deref(), Some("newer copy"));
    }
}