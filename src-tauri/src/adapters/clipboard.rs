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

/// Copies a secret for a bounded expiry, then conditionally clears it.
///
/// The clear runs on a detached thread after `expiry`: it re-reads the
/// clipboard and only clears when the value is unchanged. Errors during the
/// clear are intentionally swallowed — losing the clear is not a failure of the
/// copy operation, and a failed read means we cannot prove ownership of the
/// current value, so we leave it alone.
pub struct Clipboard {
    inner: Arc<Mutex<Box<dyn SystemClipboard>>>,
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
        std::thread::spawn(move || {
            std::thread::sleep(expiry);
            let mut guard = inner.lock().unwrap();
            // Conditional clear: only wipe when the current clipboard content is
            // still the value we placed there.
            let unchanged = match guard.get_text() {
                Ok(current) => current == *copied,
                Err(_) => false,
            };
            if unchanged {
                let _ = guard.clear();
            }
        });
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
    }

    impl FakeClipboard {
        pub(crate) fn new() -> Self {
            Self {
                state: Arc::new(Mutex::new(None)),
            }
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
            Ok(self.state.lock().unwrap().clone().unwrap_or_default())
        }

        fn clear(&mut self) -> Result<(), ClipboardError> {
            *self.state.lock().unwrap() = None;
            Ok(())
        }
    }

    fn fake() -> (Clipboard, FakeClipboard) {
        let backend = FakeClipboard::new();
        let clipboard = Clipboard::with_backend(Box::new(backend.clone()));
        (clipboard, backend)
    }

    fn secret(s: &str) -> SecretString {
        SecretString::from(s.to_string())
    }

    /// Poll `f` every 10ms for up to one second — keeps timing tests robust.
    fn wait_until(f: impl Fn() -> bool) -> bool {
        for _ in 0..100 {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        f()
    }

    #[test]
    fn copy_places_value_on_clipboard() {
        let (clipboard, backend) = fake();
        clipboard.copy_for(secret("s3cr3t!"), Duration::from_secs(30)).unwrap();
        assert_eq!(backend.current().as_deref(), Some("s3cr3t!"));
    }

    /// vault-entries "Clipboard expiration": the copied value is cleared no
    /// later than 20s — here with a short expiry, proving the scheduled clear.
    #[test]
    fn clears_copied_value_after_expiry_when_unchanged() {
        let (clipboard, backend) = fake();
        clipboard.copy_for(secret("s3cr3t!"), Duration::from_millis(20)).unwrap();
        assert!(wait_until(|| backend.current().is_none()), "clipboard must clear after expiry");
    }

    /// The clear must never destroy a newer clipboard copy (design: "avoids
    /// destroying a newer clipboard copy").
    #[test]
    fn does_not_clear_when_clipboard_was_changed() {
        let (clipboard, backend) = fake();
        clipboard.copy_for(secret("mine"), Duration::from_millis(20)).unwrap();
        // The user copies something else before the 20s window elapses.
        backend.overwrite("newer copy");
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(backend.current().as_deref(), Some("newer copy"));
    }
}