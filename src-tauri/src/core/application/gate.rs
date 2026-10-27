//! Named intent for the boolean flags the use cases used to take.
//!
//! `import(unlocked, confirmed, …)` reads the same two positional booleans in
//! either order, so a call site could silently swap "the vault is unlocked" with
//! "the user confirmed". Both are named types now (RUST-AUDIT F16). The only
//! place a raw `bool` survives is the command edge, where the value arrives from
//! the frontend and is converted once.

/// Whether the caller holds an unlocked session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionGate {
    Unlocked,
    Locked,
}

impl From<bool> for SessionGate {
    fn from(unlocked: bool) -> Self {
        if unlocked {
            Self::Unlocked
        } else {
            Self::Locked
        }
    }
}

/// Whether a destructive or renaming operation was explicitly confirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confirmation {
    Confirmed,
    Pending,
}

impl From<bool> for Confirmation {
    fn from(confirmed: bool) -> Self {
        if confirmed {
            Self::Confirmed
        } else {
            Self::Pending
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wire_bool_maps_to_the_named_intent() {
        assert_eq!(SessionGate::from(true), SessionGate::Unlocked);
        assert_eq!(SessionGate::from(false), SessionGate::Locked);
        assert_eq!(Confirmation::from(true), Confirmation::Confirmed);
        assert_eq!(Confirmation::from(false), Confirmation::Pending);
    }
}
