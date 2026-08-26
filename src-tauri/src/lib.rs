//! keymaps2026 — hexagonal Rust core for a personal password manager.
//!
//! Layering:
//! - `core::domain`    — domain types (entries, record IDs, categories).
//! - `core::ports`     — hexagonal ports (repository, cipher, KDF, clipboard).
//! - `core::application` — use cases that orchestrate the ports.
//! - `adapters::crypto`  — infrastructure implementations of the ports.
//!
//! The desktop shell (`tauri`) is compiled only when the `tauri-app` feature is
//! enabled; see `Cargo.toml` for the rationale.

pub mod adapters;
pub mod core;

#[cfg(feature = "tauri-app")]
pub mod desktop;
