//! Tauri v2 application entry point.
//!
//! The desktop shell is compiled only when the `tauri-app` feature is enabled
//! (see `Cargo.toml`). With the default feature set this binary is a no-op so
//! that headless builds (`cargo test --lib`) never require the webkit2gtk-4.1 /
//! gtk3 system libraries.
//!
//! State management and command registration (Phase 3) live in
//! [`desktop::run`], which boots the Tauri builder with the `VaultApp` state
//! and the typed commands from `adapters::tauri`.

#[cfg(feature = "tauri-app")]
fn main() {
    keymaps2026_lib::desktop::run();
}

#[cfg(not(feature = "tauri-app"))]
fn main() {
    eprintln!(
        "clavemaestra: the desktop shell is disabled. Build with `--features tauri-app` to run the app."
    );
}
