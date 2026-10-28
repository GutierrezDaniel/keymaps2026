//! Structured operational events (RUST-AUDIT F9).
//!
//! One line of `key=value`-by-JSON on stderr per event. The event set is closed
//! and every field is a non-secret scalar or a coarse reason code, so no call
//! site can leak a password, a path or vault contents into the trail.
//!
//! No logging framework: this crate has one process, one sink and no need for
//! spans, filtering or level negotiation. Adding `tracing` would mean adding a
//! subscriber dependency for the same bytes.
//!
//! Known limitation: a windowed build on Windows has no attached stderr, so the
//! trail is only visible when the app is started from a console. A file sink
//! with size-capped rotation is the upgrade path when that matters.

#[cfg(not(test))]
use std::io::Write;

/// Why an import was refused. Mirrors the adapter's coarse error classes and
/// never carries a path or a storage message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportRejection {
    /// The candidate is not an initialized vault; no vault file was touched.
    InvalidCandidate,
    /// The candidate validated but staging or the swap failed.
    StorageFailure,
}

/// Why the session was locked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockReason {
    /// Explicit user action.
    User,
    /// The inactivity timeout fired.
    Idle,
    /// An applied vault import replaced the vault the session was unlocked for.
    Import,
}

/// Operational events the backend can emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    VaultCreated,
    UnlockSucceeded,
    UnlockFailed,
    UnlockBackoff {
        seconds: u64,
    },
    SessionLocked {
        reason: LockReason,
    },
    ImportRejected {
        reason: ImportRejection,
    },
    ImportApplied,
    CheckpointIncomplete {
        busy: i64,
        log: i64,
        checkpointed: i64,
    },
}

impl Event {
    /// One line of structured output. Pure, so the shape — and the absence of
    /// any secret field — is testable without capturing stderr.
    pub fn render(self) -> String {
        match self {
            Event::VaultCreated => r#"{"event":"vault_created"}"#.to_string(),
            Event::UnlockSucceeded => r#"{"event":"unlock_succeeded"}"#.to_string(),
            Event::UnlockFailed => {
                r#"{"event":"unlock_failed","reason":"authentication_failed"}"#.to_string()
            }
            Event::UnlockBackoff { seconds } => {
                format!(r#"{{"event":"unlock_backoff","seconds":{seconds}}}"#)
            }
            Event::SessionLocked { reason } => {
                let reason = match reason {
                    LockReason::User => "user",
                    LockReason::Idle => "idle",
                    LockReason::Import => "import",
                };
                format!(r#"{{"event":"session_locked","reason":"{reason}"}}"#)
            }
            Event::ImportRejected { reason } => {
                let reason = match reason {
                    ImportRejection::InvalidCandidate => "invalid_candidate",
                    ImportRejection::StorageFailure => "storage_failure",
                };
                format!(r#"{{"event":"import_rejected","reason":"{reason}"}}"#)
            }
            Event::ImportApplied => r#"{"event":"import_applied"}"#.to_string(),
            Event::CheckpointIncomplete {
                busy,
                log,
                checkpointed,
            } => format!(
                r#"{{"event":"checkpoint_incomplete","busy":{busy},"log":{log},"checkpointed":{checkpointed}}}"#
            ),
        }
    }

    /// Write the event to stderr. A write failure is ignored on purpose:
    /// observability must never turn a working command into an error.
    ///
    /// Test builds record the event instead, so a unit test can assert the
    /// exact trail a command produced rather than parsing stderr — a wrong
    /// branch is otherwise invisible to the suite.
    pub fn emit(self) {
        #[cfg(test)]
        CAPTURED.with(|events| events.borrow_mut().push(self));
        #[cfg(not(test))]
        let _ = writeln!(std::io::stderr(), "{}", self.render());
    }
}

#[cfg(test)]
thread_local! {
    static CAPTURED: std::cell::RefCell<Vec<Event>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Take the events emitted on this thread since the last call (test builds).
#[cfg(test)]
pub fn drain_captured() -> Vec<Event> {
    CAPTURED.with(|events| std::mem::take(&mut *events.borrow_mut()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_render_one_json_object_per_line() {
        for event in [
            Event::VaultCreated,
            Event::UnlockSucceeded,
            Event::UnlockFailed,
            Event::UnlockBackoff { seconds: 8 },
            Event::SessionLocked {
                reason: LockReason::User,
            },
            Event::SessionLocked {
                reason: LockReason::Idle,
            },
            Event::ImportApplied,
        ] {
            let rendered = event.render();
            assert!(rendered.starts_with('{') && rendered.ends_with('}'));
            assert!(!rendered.contains('\n'), "one event is one line");
            assert!(rendered.contains(r#""event":""#));
        }
    }

    #[test]
    fn coalesced_events_carry_only_non_secret_scalars() {
        assert_eq!(
            Event::ImportRejected {
                reason: ImportRejection::StorageFailure
            }
            .render(),
            r#"{"event":"import_rejected","reason":"storage_failure"}"#
        );
        assert_eq!(
            Event::CheckpointIncomplete {
                busy: 1,
                log: 29,
                checkpointed: 25
            }
            .render(),
            r#"{"event":"checkpoint_incomplete","busy":1,"log":29,"checkpointed":25}"#
        );
        // No event may name a vault field: the closed enum is the guard.
        for rendered in [
            Event::UnlockFailed.render(),
            Event::ImportRejected {
                reason: ImportRejection::InvalidCandidate,
            }
            .render(),
        ] {
            for forbidden in ["password", "site", "email", "username", "salt", "key"] {
                assert!(
                    !rendered.contains(forbidden),
                    "structural leak of `{forbidden}` in {rendered}"
                );
            }
        }
    }
}
