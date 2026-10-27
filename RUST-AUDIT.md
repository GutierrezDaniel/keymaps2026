# Rust codebase audit against `rust-engineering`

> Status: F1–F4, F6, F7, F9, F11 and F20–F26 are fixed. F5 is half done:
> `src/lib.rs` now carries `#![forbid(unsafe_code)]`, while
> `#![warn(missing_docs)]` is deferred (it surfaces 130 undocumented public
> items — its own change, not a nit). F8, F10 and F12–F19 remain open.
>
> F9 deviation: the trail is `adapters/observability.rs`, a closed event enum
> rendered as one JSON line on stderr, instead of `tracing`. The crate needs no
> spans, levels or filtering, and `tracing` without `tracing-subscriber` emits
> nothing — that is a new dependency for the same bytes. Test builds record the
> events in a thread-local sink, so the suite asserts the exact trail a command
> produced (a wrong branch now fails; verified by mutating one). Known
> limitation: a windowed Windows build has no attached stderr, so the trail is
> only visible from a console; a size-capped file sink is the upgrade path.
>
> Two advisories were reported by independent verification and left open
> because neither is caused by this candidate: `require_unlocked()` then
> re-locking the session can panic if `lock()` lands between them (pre-existing,
> unchanged window), and a failed import can leave the main database file
> physically rewritten although the logical vault is intact (SQLite checkpoints
> partially before reporting `busy`; pre-existing).
>
> Fixed in PR #30 (`fix/vault-update-and-import-recovery`: F1, F2, the rollback
> hazard folded into F1, plus `tests/f1_f2_verification.rs`) and on
> `fix/vault-audit-integrity` (F3, F4, F5 partial, F11, F20–F26).
>
> F26 tradeoff: the command layer relocks on every import failure that is not a
> candidate-validation failure, so a corrupt candidate costs one extra unlock
> even though the active vault was never touched. Deliberate — the alternative
> is trusting a storage error to mean "nothing was written".

Scope: every Rust source file in `src-tauri/` — 25 files, 5,587 lines
(`src/`: 4,729 · `tests/`: 858).
Rules: `~/.config/opencode/skills/rust-engineering/SKILL.md` (9 hard rules + decision gates)
and `references/practices.md` (architecture, API, errors, ownership, concurrency, unsafe,
testing, quality gates, dependencies, observability, config, performance, anti-patterns).

Method: two independent read-only passes over disjoint file sets (adapters vs.
core/ports/tests/entry points), then a parent spot check that re-read the evidence for
F1–F4, F6 and F12 directly, including the `save` SQL behind F2.
Production code is judged separately from `#[cfg(test)]` code and from `tests/*.rs`.

Fix verdicts: **YES** = the rule applies to this code and the fix is worth its risk.
**NO** = test-only, documented tradeoff, false positive, or poor risk/benefit — the last
column says which.

---

## Verdict

The hexagonal boundary is real and the adapter discipline is above average for a Tauri
app: infrastructure errors are mapped inward, secrets use `secrecy`/`zeroize`, SQL is
parameterized, the import swap is temp-file + rename with rollback, file work is off the
main thread, and there is no `#[allow]`, no `env::var`, and no production `unsafe`
except one avoidable block.

Findings: **25 worth fixing** (2 of them real defects), **9 not worth fixing**.

Neither defect is a crash. Both are silent: they produce a wrong state and keep going.

| Order | Finding | Why it matters |
|---|---|---|
| 1 | F2 `vault_service.rs:103` | Updating a missing entry **creates** it instead of returning `NotFound` |
| 2 | F1 `sqlite.rs:349` | A successful vault import can report failure and leave the app on the old key |
| 3 | F3 `sqlite.rs:202` | A failed WAL checkpoint is indistinguishable from a completed one, so a backup can be stale |
| 4 | F4 `entry.rs:36` | The only production `unsafe`, with a safe one-line alternative |

---

## Correctness — fix first

| ID | Location | Rule | Evidence | Sev | Fix | Why |
|---|---|---|---|---|---|---|
| F1 | `adapters/persistence/sqlite.rs:341,349` | Error handling · atomicity | `self.conn = installed;` … `fs::remove_file(&rollback).map_err(...)?;` | major | **YES** | The new vault is already installed and verified; only rollback-file cleanup remains. Its failure returns `Err`, so `replace_atomically` (`:641-646`) yields `Err` and `tauri.rs:738-742` skips re-locking — vault replaced, session still holding the old key. Cleanup must be best-effort after a successful install. |
| F2 | `core/application/vault_service.rs:103` | Error handling · anti-pattern (dead call) | `// Read to confirm existence before overwriting.` / `self.repo.list(&Filters::new())?;` | major | **YES** | The result is discarded, so existence is never confirmed: the comment is false. `save` is an upsert (`sqlite.rs:494 ON CONFLICT(id) DO UPDATE SET`), so `update_entry` on an unknown id silently inserts a row. A password manager must return `NotFound` here. |
| F3 | `adapters/persistence/sqlite.rs:202-206` | Error handling · guarantee | `.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], \|_\| Ok(()))` | major | **YES** | The row carries `busy/log/checkpointed`; discarding it makes a partially-checkpointed WAL look successful. `backup.rs:65` then copies a file that may be missing recent writes — the module doc claims the opposite. Read the row; return an error when `busy != 0`. |
| F4 | `core/domain/entry.rs:36` | Rule 4 (zero unsafe) · "safe API" | `f.write_str(unsafe { std::str::from_utf8_unchecked(&s) })` | major | **YES** | The `// SAFETY:` comment is correct and the invariant holds, so this is not UB today — but the rule is zero unsafe by default and `std::str::from_utf8(&s).map_err(\|_\| fmt::Error)?` or `hex::encode` costs nothing here. It is the only production `unsafe` in the crate; removing it makes `#![forbid(unsafe_code)]` reachable. |
| F5 | `src/lib.rs:1` | Quality gates · rule 6 | file starts at `//! keymaps2026 — hexagonal Rust core` (no crate lints) | minor | **YES** | One line — `#![forbid(unsafe_code)]` plus `#![warn(missing_docs)]` — would have blocked F4 structurally instead of by review. Cheap, and it is the skill's stated way to "enforce with boundaries, not discipline". |
| F26 | `sqlite.rs:353-390`; `tauri.rs:738-741` | Error handling · documented contract | doc: "the command layer locks the app instead of serving a partial vault" … `let result = self.import.import(true, confirmed, source)?;` | major | **YES** | When the restore of the previous vault also fails, the repository keeps an in-memory placeholder. The doc says the command layer then locks, but `import_backup` returns on error *before* `self.lock()`, so the session stays unlocked and later writes go to memory and vanish. Fix needs a distinct "vault unusable" error variant (or an equivalent signal) so the command layer can lock on it. Found while fixing F1. |

## Design & safety — fix soon

| ID | Location | Rule | Evidence | Sev | Fix | Why |
|---|---|---|---|---|---|---|
| F6 | `adapters/tauri.rs:791-793` | Rule 3 (no lock across work) | `let guard = self.session.lock().unwrap();` / `f(&session.key)` | minor | **YES** | The session mutex is held for the whole crypto/DB operation inside `f`, blocking auto-lock and activity updates. `VaultKey` is `Secret<[u8; 32]>` (`ports/cipher.rs:13`) and is `Clone`: clone the key, drop the guard, then call `f`. |
| F7 | `adapters/tauri.rs:547,552,585` | Performance · blocking work | `let key = self.kdf.derive(master_password, &salt)?;` | minor | **YES** | Argon2id is intentionally slow and runs on the command thread; in `create_vault` it also runs while the repo lock is held. The module already offloads file work with `spawn_blocking` — the KDF needs the same treatment. |
| F8 | `adapters/tauri.rs:751-755`; `vault_service.rs:124-132` | Performance · API design | `let summaries = self.service.list_entries(&Filters::new())?;` / `.find(\|s\| &s.id == id)` | minor | **YES** | Every detail read loads and scans the whole vault, and `get_entry_details` collects a `Vec` only to take `.next()`. The port has no `find_by_id`. Scope note: this is a port addition plus three adapters, not a one-liner. |
| F9 | adapters + command layer | Rule 7 (structured tracing) | zero `tracing`; one `eprintln!` at `main.rs:19`; auth failure at `tauri.rs:592-595` returns silently | minor | **YES** | A password manager with no backend trail cannot be diagnosed: failed unlocks, checkpoint failures, and import errors leave nothing. Add `tracing` fields at handling boundaries — never the secret, never the password length. |
| F10 | `adapters/crypto/argon2_aes.rs:93-97`; `adapters/clipboard.rs:90-91` | Secrets · module guarantee | `let text = String::from_utf8(plaintext.to_vec())...` / `Ok(current) => current == *copied,` | minor | **YES** | Decrypted plaintext is copied into a `Vec`/`String` that is dropped unzeroized, contradicting the module's "all secrets are zeroized" claim. Wrap in `Zeroizing`. Cheap and it is the file's own documented invariant. |
| F11 | `core/application/vault_service.rs:95-116, 119-135` | Rule 5 · coverage ∝ risk | `update_entry` and `get_entry_details` have no negative test (tests span `:258-675`) | major | **YES** | This gap is exactly what let F2 ship: no test updates a missing id or reads a missing id. Add both `NotFound` cases. |
| F12 | `core/domain/entry.rs:181-188` | Decision gate (>~3 params) | `pub fn new(site, link, password, email, username, category)` — 5 `impl Into<String>` | minor | **YES** | Two `&str` arguments swap silently (`email` ↔ `username`). Fields are already `pub`: delete `new` or take a builder. |
| F13 | `core/application/vault_service.rs:52-69` | Architecture · dead generic | `pub struct VaultService<R, C, K> { … _kdf: kdf, }` | minor | **YES** | `K` is never called by any use case; only tests read `svc._kdf`. An unused type parameter is a promise the type does not keep — remove it, or move the KDF use case into the service. |
| F14 | `core/application/vault_service.rs:413-418` | Architecture · test seam | `crate::adapters::crypto::argon2_aes::Argon2Aes,` | minor | **YES** | A core unit test reaches into a concrete adapter, defeating the port fake and paying real Argon2 cost. The port exists precisely so the test can use a fake. |
| F15 | `vault_service.rs:16`; `vault_import_service.rs:17`; `ports/*.rs` | Decision gate (`#[non_exhaustive]`) | `pub enum ServiceError {` | minor | **YES** | Six growing public enums in a lib target: adding a variant is a breaking change. One attribute each. |
| F16 | `vault_import_service.rs:57-62`; `vault_service.rs:201-207` | API design · boolean params | `confirmed: bool,` / `unlocked: bool,` | minor | **YES** | `import(false, true, …)` is silently the opposite of `import(true, false, …)`. Name the intent in an enum. |
| F17 | `vault_service.rs:80,104` | Ownership · secret hygiene | `self.cipher.encrypt(&id, key, input.password.clone())?` | minor | **YES** | Cloning duplicates the plaintext secret on the heap for a call that does not need ownership. Take `EntryInput` by value and move the secret. Scope note: ripples to command-layer callers. |
| F18 | `adapters/tauri.rs:64-164` | Architecture · layering | `pub struct Session { … }` / `pub struct BackoffPolicy { … }` | minor | **YES** | Session lifetime and login-backoff are application policy in the interface adapter. Movable with its tests unchanged — but it is the largest refactor here; do it after the correctness work. |

## Hygiene, tests & docs — fix in passing

| ID | Location | Rule | Evidence | Sev | Fix | Why |
|---|---|---|---|---|---|---|
| F19 | `clipboard.rs:164-198` | Rule 5 (determinism) | `for _ in 0..100 { … sleep(Duration::from_millis(10)); }` | minor | **YES** | Wall-clock polling and `sleep(150ms)` can flake on a loaded CI. Inject a clock/scheduler or assert on the state machine instead. |
| F20 | `tauri.rs:1146-1163` | Rule 4 in tests | `unsafe { std::slice::from_raw_parts(ptr, 32) }` | minor | **YES** | No `// SAFETY:`, and it reads memory captured before `zeroize()` replaces the value — a test that can read freed/changed memory is not proving what it claims. Assert via the safe API. |
| F21 | `argon2_aes.rs:230-241` | Rule 5 (behavior, not name) | `fn malformed_field_non_utf8_plaintext()` … `assert!(…is_ok());` | minor | **YES** | The test never produces non-UTF-8 input, so the `from_utf8` error branch (`:96`) stays untested and the name lies. Rename it or craft raw bytes. |
| F22 | `sqlite.rs:782,813` | Rule 5 (clear behavior) | `fn replace_with_backup_reports_the_failing_wal_swap_stage()` … `panic!("WAL replacement failed: …")` | nit | **YES** | Name says failure path; body asserts success. Rename to what it proves. |
| F23 | `tests/vault_repo.rs:309-310` | Anti-pattern (dead code) | `let _ = (a.password.clone(), b.password.clone());` | nit | **YES** | No assertion depends on it; it exists to silence an unused binding. Use `_a`/`_b` or assert on the values. |
| F24 | `sqlite.rs:355-357` vs `388-390` | Documentation correctness | comment: "keeps an empty placeholder connection" … `self.conn = active;` | nit | **YES** | On `close_active_connection` failure the failed-install connection is restored, not the placeholder. Fix the comment (or the behavior) — a wrong comment about recovery is worse than none. |
| F25 | `sqlite.rs:449-450` | Anti-pattern · input handling | `clauses.push("site LIKE '%' \|\| ? \|\| '%'");` | nit | **YES** | Parameterized (no injection), but user `%`/`_` act as wildcards: searching `100%` matches everything. Add `ESCAPE`. |

## Not worth fixing — with the reason

| ID | Location | Apparent rule break | Fix | Why not |
|---|---|---|---|---|
| N1 | `tauri.rs:470,547,568,578,601,616,775,791`; `backup.rs:62`; `clipboard.rs:82,87`; `sqlite.rs:642` | Rule 1 (`lock().unwrap()`) | **NO** | Deliberate fail-fast. If a thread panicked while holding the vault lock, the in-memory session or DB state may be inconsistent; recovering with `into_inner` would serve possibly-corrupt secrets. For a password manager, dying is the safer failure. This supersedes the earlier `map_err` suggestion in conversation: the uniform policy is defensible — what is missing is a comment stating it once. Document, do not rewrite. |
| N2 | `tauri.rs:760` | Rule 1 (`unreachable!`) | **NO** | Provably unreachable: the outer match already returns for `Password`. Restructuring is churn with no behavior change. |
| N3 | `backup.rs:62-66` | Rule 3 (lock across I/O) | **NO** | Documented requirement (`:60-61`): no write may interleave between checkpoint and read, or the backup is inconsistent. It runs inside `spawn_blocking`, so it blocks no command thread. |
| N4 | `ports/vault_repository.rs:15`; `clipboard.rs:14`; `vault_import_storage.rs:18-20` | Error handling (`String` variants, no `#[source]`) | **NO** | Deliberate: keeps `rusqlite`/`io` types out of the core, and the enums derive `Clone`/`Eq` which callers and tests rely on. Typed causes would drag infrastructure into the port. Document the tradeoff instead. |
| N5 | `desktop.rs:14` | Rule 1 (`expect`) | **NO** | Binary composition root: if the desktop shell cannot start there is nothing to recover to. `anyhow` would only improve the message. |
| N6 | `tests/vault_repo.rs:35,292-299,327` | Performance (Argon2 per helper) | **NO** | Deterministic and real-crypto, which is why the integration tests are trustworthy. Optimize only if suite time actually hurts. |
| N7 | `domain/entry.rs:34` | Rule 1 (`expect`) | **NO** | The rule's own allowed case: provably impossible, documented with a reason. |
| N8 | `tauri.rs:17-19,46-47,265-266`; `backup.rs:1-16,87-98`; `clipboard.rs:5-8,53-57,95`; `sqlite.rs:22-23,95-97,748-751` | Various | **NO** | Each carries a comment stating the deliberate tradeoff (offloaded file work, in-code config per spec, error/path stripping, the native format *is* the SQLite file, conditional clipboard clear, single `!Sync` connection behind a `Mutex`). Reviewed and accepted. |
| N9 | `vault_service.rs:232-242` | Concurrency · atomicity | **NO** | TOCTOU between the category checks and the delete, but the repository is serialized behind one mutex in a single-user desktop app, and a correct fix needs a new transactional port operation. Revisit if multi-process access ever lands. |

## Rules verified satisfied

| Rule | Evidence |
|---|---|
| 2 — dependencies point inward | `domain/entry.rs` imports only `secrecy`; `ports/*` only `std`, `secrecy`, `thiserror`, `core::domain`; `application/*` only `std::path`, `thiserror`, `core::*`. No `rusqlite`, `tauri`, `fs` or `env` in the core. Adapters map `rusqlite`/`arboard`/`argon2` errors into core port errors. |
| 3 — no `.await` with a lock | Zero `async` in the crate; locks are synchronous only. `export_vault`/`import_vault` use `spawn_blocking`. |
| 4 — unsafe | Zero `unsafe` in the crate (F4 and F20 fixed), enforced structurally by `#![forbid(unsafe_code)]`. |
| 5 — deterministic tests | Integration tests use `tempfile::TempDir` outside the worktree, in-memory SQLite, no network, no retries. One exception: F19 (sleeps), open; F21/F22 (misnamed) are fixed. |
| 6 — no `#[allow]` | Zero `#[allow]` in the crate. |
| 7 — no secret logging | Zero logging at all (that is F9); no secret ever reaches an error variant, and `Debug` masking is asserted at `tauri.rs:1569-1613`. |
| 8 — config | No `env::var`, no global mutable state; `main.rs` → `desktop::run` is a thin composition root; constants are documented. |
| 9 — decision gates | Constructors ≤3 params except F12; `dyn SystemClipboard` exists only as a test seam; hand-written `FakeClipboard`, no `mockall`; `RecordId` is parsed at the command edge (`tauri.rs:900,922,929,977`); SQL fully parameterized. |

## Not covered / open questions

- CI runs `npm test` and `cargo test --lib` only (`.github/workflows/windows-release.yml`). No `cargo fmt --check`, no `clippy -D warnings`, no `cargo audit`, and no `cargo test --test …` step — the skill's quality gate is half-missing. That must be accepted deliberately or tracked as its own change.
- The boundary in rule 2 is convention inside one crate, not a crate split; F14 already leaked and it compiled.
- `tests/*.rs` reach into raw `rusqlite` on purpose (`vault_repo.rs:96-106,422-427`) to prove plaintext absence and schema version. Justified, not flagged.
- Environment-dependent, not reproducible read-only: whether `wal_checkpoint(TRUNCATE)` can return busy here (F3), and the exact UB exposure of F20.
