//! Tauri v2 application entry point.
//!
//! The desktop shell is compiled only when the `tauri-app` feature is enabled
//! (see `Cargo.toml`). With the default feature set this binary is a no-op so
//! that headless builds (`cargo test --lib`) never require the webkit2gtk-4.1 /
//! gtk3 system libraries.
//!
//! Command registration and `Arc<Mutex<Option<Session>>>` state wiring land in
//! Phase 3; PR 1 ships a bootstrappable shell only.

#[cfg(feature = "tauri-app")]
fn main() {
    keymaps2026_lib::desktop::run();
}

#[cfg(not(feature = "tauri-app"))]
fn main() {
    eprintln!(
        "keymaps2026: the desktop shell is disabled. Build with `--features tauri-app` to run the app."
    );
}
