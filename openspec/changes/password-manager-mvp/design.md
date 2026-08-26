# Design: Password Manager MVP

## Technical Approach

Greenfield Tauri v2 application with a hexagonal Rust core: domain/application services depend on ports, while SQLite, crypto, clipboard, backup, and Tauri commands are adapters. React/TypeScript renders Spanish UI. Metadata remains queryable; secrets are decrypted by Rust commands only when needed. No source patterns, manifests, or test infrastructure exist.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Crypto crates | `argon2` (Argon2id), `aes-gcm` (AES-256-GCM), `rand` (`OsRng`), `zeroize`, `secrecy` | OpenSSL, hand-rolled crypto, OS keychain | Focused Rust crates and explicit zeroization fit the pure master-password model; the key never crosses IPC. |
| SQLite | `rusqlite` with `bundled` | System SQLite, ORM | Reproducible Tauri builds and a small SQL surface suit this MVP. |
| Session | Managed `Arc<Mutex<Option<Session>>>`; `Session` owns `Secret<[u8;32]>` and is replaced with `None` on lock | Frontend key, global key, OS keychain | Rust owns key lifetime and synchronously clears it; attempt best-effort `mlock`. |
| Schema and salt | Singleton `vault_metadata` stores random 16+ byte salt, validation nonce, and ciphertext. `entries` stores UUID ID, plaintext site/link/category/email/username, password nonce, and ciphertext; ID bytes are AAD. | Encrypt all metadata, config salt, shared nonce | Preserves indexing, authenticated identity, and restart recovery without storing the master password. |
| Tauri boundary | Typed `unlock`, `lock`, `list`, `get_entry_details`, `create`, `update`, `delete`, `export`, `copy_field`, and `record_activity` commands | Direct React database access, broad JSON | Keeps policy and secrets in Rust and makes IPC contracts testable. |
| Locking and clipboard | Five-minute activity timer; five failures trigger delays of 1, 2, 4, 8, 16 seconds, capped at 60; success resets. Rust `arboard` clears after 20 seconds only if value is unchanged. | Browser clipboard, unlimited attempts, UI timer | Enforces timing outside the UI and avoids destroying a newer clipboard copy. |
| Frontend styling | React with scoped/plain CSS and CSS variables | Tailwind, UI kit | Small greenfield scope needs fewer dependencies while retaining explicit Spanish warning/category styles. |

## Data Flow

```text
Master password → unlock command → Argon2id(salt) → AEAD validation → Session(key)
                                              ↓
list command → metadata DTOs → card grid → flip → get_entry_details → decrypted DTO
                                                              ↓
                                                  copy_field → Rust decrypt → clipboard
                                                                            ↓ 20s
                                                                        conditional clear
activity events → Rust timer reset → 5 min inactivity → lock → zeroize Session
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` | Create | Tauri bootstrap, dependencies, state, and command registration. |
| `src-tauri/src/core/domain/entry.rs`, `src-tauri/src/core/application/vault_service.rs` | Create | Entry/category types and use cases. |
| `src-tauri/src/core/ports/{vault_repository,cipher,key_derivation,clipboard}.rs` | Create | Hexagonal port traits. |
| `src-tauri/src/adapters/crypto/argon2_aes.rs` | Create | KDF, AEAD, nonce/AAD handling, safe errors, zeroization. |
| `src-tauri/src/adapters/persistence/sqlite.rs` | Create | Schema, migrations, CRUD, metadata filters, atomic transactions. |
| `src-tauri/src/adapters/{clipboard,backup,tauri}.rs` | Create | Clipboard expiry, encrypted export, DTOs/commands, and activity timer. |
| `src/ui/{App,api,components,styles}.tsx`, `src/ui/styles.css` | Create | Login, cards/flip, form modal, filters, confirmations, and Spanish warnings. |
| `package.json`, `src-tauri/tests/`, `src/ui/**/*.test.tsx` | Create | Scaffold tooling and Rust/React tests. |

## Interfaces / Contracts

```rust
trait VaultRepository { fn list(&self, f: Filters) -> Result<Vec<EntryRecord>>; fn save(&self, e: EntryRecord) -> Result<()>; fn delete(&self, id: RecordId) -> Result<()>; }
trait CipherPort { fn encrypt(&self, id: &RecordId, key: &VaultKey, p: SecretString) -> Result<EncryptedField>; fn decrypt(&self, id: &RecordId, key: &VaultKey, f: &EncryptedField) -> Result<SecretString>; }
trait KeyDerivationPort { fn derive(&self, password: SecretString, salt: &[u8]) -> Result<VaultKey>; }
trait ClipboardPort { fn copy_for(&self, value: SecretString, expiry: Duration) -> Result<()>; }
```

Commands use these DTOs; `EntryDetailsDto.password` is transient and `copy_field` returns only success/error:

```rust
struct UnlockRequest { master_password: SecretString }
struct EntryInput { site: String, link: String, password: SecretString, email: String, username: String, category: String }
struct EntrySummaryDto { id: String, site: String, link: String, email: String, username: String, category: String }
struct EntryDetailsDto { summary: EntrySummaryDto, password: SecretString }
struct FilterDto { site: Option<String>, category: Option<String>, email: Option<String> }
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | KDF/AEAD tampering, domain validation, backoff, lock policy | Rust tests with fixed IDs and generated salts. |
| Integration | SQLite CRUD/filters, restart identity, export atomicity, clipboard | Temporary databases and adapter fakes. |
| Component | Spanish labels, masking, flip, warnings, confirmation, command states | React Testing Library; tooling arrives with scaffold. |
| E2E | Unlock-to-copy and auto-lock | Add Tauri/WebDriver coverage if feasible. Strict TDD is false because this is greenfield. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Greenfield release; encrypted native export is the rollback-preserved artifact.

## Open Questions

None blocking; platform-specific `mlock` support and E2E driver availability are implementation-validation risks, not design blockers.
