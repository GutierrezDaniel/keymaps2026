# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user is the owner-developer, using the app daily on their own
machines. The product is considered **potentially public**: it may be
distributed to a wider audience at some point, so the interface must feel
presentable as a product to non-technical people, not like an internal tool.

## Product Purpose

A personal, offline-first password manager for the desktop. The user creates a
vault with a single master password and manages site credentials (site, link,
password, email, username, category). Success means the user can store, find,
copy, edit, and delete secrets quickly and safely, with confidence that nothing
leaves the machine.

## Positioning

The master password is the only key to the vault: no recovery mechanism exists,
and losing it permanently makes the vault unrecoverable. The product is
offline by design — no cloud, no synchronization, no telemetry — and treats
that irreversibility as an explicit, prominently communicated contract rather
than a hidden risk.

## Operating Context

- Desktop app built with Tauri v2 (Rust core, SQLite storage, React/TS UI in a
  webview). Developed on Linux; multiplatform (Windows/macOS) is a live
  possibility and the design must be portable.
- Spanish-language UI (neutral professional Spanish).
- Daily use: unlock, search/filter, copy a field, lock. Sessions auto-lock
  after 5 minutes of inactivity; copied secrets clear from the clipboard after
  20 seconds; failed logins back off (1s → 2s → 4s → 16s…, capped at 60s).
- Entries render as summary cards grouped/colored by category
  (`entretenimiento`, `trabajo`, `estudio`, `servicios`); selecting a card
  opens the unified modal to view, copy and edit the secret fields.

## Capabilities and Constraints

- Master-password vault creation and login; irreversible-loss warning shown at
  creation and at the locked screen.
- Entry CRUD with delete confirmation; search by site; category and email
  filters; multiple accounts per site.
- Masked/revealable password; copy site link, password, email, username;
  clipboard auto-clear; encrypted native-format export.
- Explicitly out of scope: recovery, OS keychain integration,
  synchronization, sharing, multi-user support, custom-category management,
  and password generation.
- Security: passwords encrypted at rest (AES-256-GCM, per-field nonce, record
  ID as AAD); key derived with Argon2id; derived key never leaves the Rust
  process and is zeroized on lock.

## Brand Commitments

- The name "Keymaps2026" is a **working name**, not final identity — the visual
  identity must not be locked to it.
- UI copy is Spanish (neutral professional register).
- Repository is public on GitHub; no secrets or personal data may appear in
  the codebase or its history.

## Evidence on Hand

- README.md — stack, run/test/build commands, security notes.
- openspec/ — proposal, design, tasks, apply-progress and per-capability specs
  (vault-crypto, vault-storage, vault-session, vault-entries, vault-ui,
  vault-backup).
- src/ui/ — incumbent Spanish React UI (App.tsx, components.tsx, styles.css)
  with tests; 12 Tauri commands wired through api.tsx.
- No real user testimonials, case studies, or benchmark data exist; future
  work must not fabricate them.

## Product Principles

1. **Security is the product.** Every surface must communicate the
   irreversible master-password contract honestly and prominently; never
   obscure risk for polish.
2. **Offline and private by default.** No cloud, no telemetry, no recovery —
   these are features, not gaps.
3. **Speed of daily use.** Unlock, find, copy, lock should feel instant and
   frictionless; the interface must never make the user hunt.
4. **Clear for non-technical eyes.** Because the product may become public,
   every screen, label, and warning must be understandable without security
   expertise.
5. **Portable visual system.** The design must hold up across desktop
   platforms (Linux today, Windows/macOS potentially) without native-specific
   assumptions.
