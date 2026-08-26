# Keymaps2026 — Personal Password Manager

A personal, offline password manager: a Tauri v2 desktop app with a Rust
hexagonal core, SQLite vault storage, and a Spanish React/TypeScript UI.

**The master password is the only key to the vault. There is no recovery
mechanism — losing it makes the vault permanently unrecoverable.**

## Stack

- Tauri v2 + Rust (domain core, application services, adapters)
- SQLite (rusqlite, bundled) — vault storage
- Argon2id key derivation + AES-256-GCM field encryption
- React 18 + TypeScript + Vite frontend (Spanish UI)

## Prerequisites

- Rust 1.98+
- Node.js 18+
- Linux system libraries: `webkit2gtk-4.1`, `gtk3`, `libsoup-3.0`
  (Tauri v2 prerequisites — https://tauri.app/start/prerequisites/)

## Run in development

```bash
npm install
npm run tauri dev
```

## Test

```bash
npm test -- --run              # React component/API tests (vitest)
cargo test --lib               # Rust unit tests — run from src-tauri/
cargo test --test vault_repo   # SQLite vault integration tests — run from src-tauri/
```

## Build

```bash
npm run tauri build
```

## Security notes

- The master password is never stored; the vault key is derived with
  Argon2id and lives only in the Rust process (zeroized on lock).
- Passwords are encrypted at rest with AES-256-GCM — per-field nonce and
  record ID as AAD — in both the vault and in backups.
- Auto-lock after 5 minutes of inactivity; failed login attempts back off
  (1s → 2s → 4s → 16s…, capped at 60s).
- Copied secrets are cleared from the clipboard after 20 seconds, only if
  unchanged.
- Backups are encrypted native-format vault copies: export refuses while
  locked and never leaves partial files.