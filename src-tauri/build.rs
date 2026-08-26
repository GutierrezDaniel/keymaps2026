// Build script: embeds the Tauri context only when the desktop shell feature is
// enabled. With the default feature set this is a no-op so headless builds stay
// free of the Tauri system dependencies.

fn main() {
    #[cfg(feature = "tauri-app")]
    {
        tauri_build::build();
    }
}
