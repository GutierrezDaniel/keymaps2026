//! Tauri v2 desktop shell.
//!
//! PR 1: a bootstrappable shell. PR 3: wires the application state
//! ([`VaultApp`]) and the eleven typed commands into the Tauri builder and
//! starts the background auto-lock thread. `main.rs` delegates here; this
//! module is compiled only when the `tauri-app` feature is enabled.

/// Starts the Tauri application. The entry point is annotated for mobile
/// support even though this MVP targets desktop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::adapters::tauri::build(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("error while running keymaps2026");
}