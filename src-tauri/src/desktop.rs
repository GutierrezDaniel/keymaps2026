//! Tauri v2 desktop shell.
//!
//! PR 1: a bootstrappable shell. The ten typed commands and the
//! `Arc<Mutex<Option<Session>>>` state are added in Phase 3; this module only
//! stands up the Tauri runtime so the project compiles end-to-end on a machine
//! with the webkit2gtk-4.1 / gtk3 system libraries installed.

/// Starts the Tauri application. The entry point is annotated for mobile
/// support even though this MVP targets desktop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running keymaps2026");
}
