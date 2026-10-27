//! Session lifetime and login-backoff policy.
//!
//! Both are application policy, not interface-adapter detail: the session owns
//! the derived key and decides when it expired, and the backoff policy decides
//! how long to refuse another attempt. They used to live in the Tauri adapter,
//! where every other interface would have had to import them (RUST-AUDIT F18).

use std::time::{Duration, Instant};

use zeroize::Zeroize;

use crate::core::ports::cipher::VaultKey;

/// A decrypted session: owns the derived vault key for the lifetime of the
/// unlock. The key is a zeroizing [`secrecy::Secret`]; dropping or explicitly
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

    /// The key this session unlocked with.
    ///
    /// Crate-visible only: the interface adapter needs it to run an operation,
    /// but the session key must not become part of the public API.
    pub(crate) fn key(&self) -> &VaultKey {
        &self.key
    }

    /// Reset the activity clock (called on user activity).
    pub(crate) fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// True when no activity happened for at least `timeout`.
    pub(crate) fn is_expired(&self, timeout: Duration) -> bool {
        self.last_activity.elapsed() >= timeout
    }

    #[cfg(test)]
    pub(crate) fn touch_at(&mut self, at: Instant) {
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

#[cfg(test)]
mod tests {
    use secrecy::{ExposeSecret, Secret};

    use super::*;

    fn test_key() -> VaultKey {
        Secret::new([7u8; 32])
    }

    #[test]
    fn lock_zeroizes_session_key_bytes() {
        let mut session = Session::new(test_key());
        assert_ne!(
            session.key().expose_secret().as_slice(),
            &[0u8; 32],
            "the session must start holding a real key"
        );
        session.zeroize();
        assert_eq!(
            session.key().expose_secret().as_slice(),
            &[0u8; 32],
            "zeroized session key bytes must be all zero"
        );
    }

    #[test]
    fn backoff_allows_failures_up_to_limit() {
        let mut policy = BackoffPolicy::new();
        for _ in 0..5 {
            assert_eq!(policy.record_failure(), Duration::ZERO);
        }
        assert_eq!(policy.failure_count(), 5);
    }

    #[test]
    fn backoff_increases_after_limit() {
        let mut policy = BackoffPolicy::new();
        for _ in 0..5 {
            assert_eq!(policy.record_failure(), Duration::ZERO);
        }
        // Doubling from 1s, capped at 60s, and it never wraps.
        let expected = [1u64, 2, 4, 8, 16, 32, 60, 60];
        for (i, secs) in expected.iter().enumerate() {
            assert_eq!(
                policy.record_failure(),
                Duration::from_secs(*secs),
                "failure {}",
                i + 6
            );
        }
        assert_eq!(policy.failure_count(), 13);
    }

    #[test]
    fn activity_touch_restarts_the_expiry_window() {
        let mut session = Session::new(test_key());
        session.touch_at(Instant::now() - Duration::from_secs(600));
        assert!(session.is_expired(Duration::from_secs(300)));

        session.touch();

        assert!(!session.is_expired(Duration::from_secs(300)));
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
}
