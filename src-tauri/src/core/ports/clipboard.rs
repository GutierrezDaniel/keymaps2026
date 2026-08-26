//! Clipboard port: copying a secret value for a bounded expiry.
//!
//! The concrete adapter (Phase 3) conditionally clears the value after the
//! expiry so a newer clipboard copy is never destroyed.

use std::time::Duration;

use secrecy::SecretString;

/// Clipboard errors. Never carries secret material.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ClipboardError {
    #[error("clipboard access failed: {0}")]
    Access(String),
}

/// Copies a secret value and schedules a conditional clear after `expiry`.
pub trait ClipboardPort {
    fn copy_for(&self, value: SecretString, expiry: Duration) -> Result<(), ClipboardError>;
}
