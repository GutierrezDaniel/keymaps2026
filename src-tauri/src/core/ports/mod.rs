//! Hexagonal port: the cipher/authenticated-encryption boundary.
//!
//! The core depends on this trait, never on a concrete crypto implementation,
//! so the crypto adapter can be swapped or tested in isolation.

pub mod cipher;
pub mod clipboard;
pub mod key_derivation;
pub mod vault_repository;
