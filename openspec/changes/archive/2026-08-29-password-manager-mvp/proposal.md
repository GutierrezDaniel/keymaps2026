# Proposal: Password Manager MVP

## Intent

Build a personal desktop password manager. The pure master-password model must be explicit: losing it permanently prevents vault recovery.

## Scope

### In Scope
- Tauri/Rust desktop app, SQLite vault, and Spanish React/TypeScript UI.
- Master-password login, inactivity auto-lock, and login-attempt backoff.
- Card CRUD, delete confirmation, copying, site search, category/email filters, and multiple accounts per site.
- Fields: site, link, password, email, username, and category. Initial categories: `entretenimiento`, `trabajo`, `estudio`, `servicios`; extensible model.
- Masked/revealable password on the flipped card, clipboard auto-clear, and encrypted export. No plaintext backup or generator.

### Out of Scope
- Recovery, OS keychain integration, synchronization, sharing, and multi-user support.
- Custom-category management and password generation.

## Capabilities

### New Capabilities
- `vault-crypto`: Argon2id and AES-256-GCM field encryption.
- `vault-storage`: SQLite metadata and encrypted secrets.
- `vault-session`: Login, locking, memory hygiene, and backoff.
- `vault-entries`: CRUD, categories, search, filters, and copying.
- `vault-ui`: Spanish cards, forms, masking, and warnings.
- `vault-backup`: Encrypted native-format export.

### Modified Capabilities
- None; no existing specs.

## Approach

Use hexagonal architecture: `src/core/` domain/application, `src/adapters/` infrastructure, and typed Tauri DTOs to `src/ui/`. Keep site, category, email, and username indexable. Encrypt passwords with AES-256-GCM, per-field nonces, and record ID as AAD. Derive a key with Argon2id and random 16+ byte salt; keep it in Rust, never store the master password, and validate login through AEAD decryption. Add `zeroize`, `secrecy`, best-effort `mlock`, clipboard clearing after 15–30 seconds, and a design-selected timeout.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/` | New | Domain, ports, crypto, and application services. |
| `src/adapters/` | New | SQLite, security, and Tauri adapters. |
| `src/ui/` | New | Spanish login, cards, forms, and filters. |
| `openspec/` | New | MVP artifacts. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Security defect exposes or loses secrets | High | Isolate Rust crypto, use vetted crates, test failures, never export plaintext. |
| Master-password loss surprises users | High | Prominent Spanish warning before vault creation and when locked. |
| MVP exceeds review budget | Med | Forecast work units and chain PRs if required. |

## Rollback Plan

Revert the feature branch and stop distribution. Preserve only encrypted exports; never decrypt or rewrite backups during rollback.

## Dependencies

- Tauri, Rust crypto/SQLite crates, React/TypeScript, and tooling.

## Success Criteria

- [x] Users safely create, unlock, search, filter, copy, edit, and delete multiple entries.
- [ ] Secrets stay encrypted at rest and in backups; the derived key never reaches the frontend.
- [ ] Locking, clipboard clearing, masking, backoff, and Spanish risk warnings work as specified.
