# Tasks: Category Administration

## Slice 1: Rust Core, Storage, and Tauri Commands

### Phase 1: Domain and Application Foundation

- [x] 1.1 Modify `src-tauri/src/core/domain/entry.rs` with `Category`, the exact 24-color `CATEGORY_PALETTE`, blank/name/palette validators, and repository-backed entry validation; remove the fixed allow-list.
- [x] 1.2 Modify `src-tauri/src/core/ports/vault_repository.rs` and `vault_service.rs` with category list/existence/CRUD/usage ports, preview and confirmed rename, rename cascade, `CategoryInUse`, duplicate/last-category invariants, and no-write failure paths.

### Phase 2: Persistence and IPC

- [x] 2.1 Modify `src-tauri/src/adapters/persistence/sqlite.rs` for idempotent v1→v2 migration, four seeded colors, deterministic ordering, category CRUD/usage, atomic rename updates, and backup/restore coverage.
- [x] 2.2 Modify `src-tauri/src/adapters/tauri.rs` with `CategoryDto`, update/preview result and validation errors, plus unlocked-gated `list_categories`, `create_category`, `update_category`, and `delete_category` commands.

### Phase 3: Rust Verification

- [x] 3.1 Extend `src-tauri/tests/vault_repo.rs` for migration/idempotence, custom preservation, ordering ties, CRUD, usage, rename cascade/rollback, deletion guards, and backup/restore seeded/custom colors.
- [x] 3.2 Extend unit tests in `src-tauri/src/core/application/vault_service.rs` and `src-tauri/src/adapters/tauri.rs` for invalid/no-write input, custom entry acceptance, preview versus confirmed rename, unlocked gating, and error mapping.

## Slice 2: Tauri React UI

### Phase 4: API and State Wiring

- [x] 4.1 Modify `src/ui/api.tsx` to expose category DTOs and all four commands; remove frontend category constants.
- [x] 4.2 Modify `src/ui/App.tsx` to load categories after unlock and thread the category map through administration, entry forms, filters, cards, header access, refreshes, and unknown-category defaults.

### Phase 5: Administration UI and Verification

- [x] 5.1 Modify `src/ui/components.tsx` for `CategoryAdminModal`: alphabetical list, create/rename/recolor, 24 swatches, instant recolor, rename/delete confirmation with entry count, disabled in-use trash tooltip, and last-category protection.
- [x] 5.2 Modify `src/ui/styles.css` for the themed modal, swatch grid, tooltip, and CSS-variable/inline card colors; keep selectors alphabetically ordered.
- [x] 5.3 Update `src/ui/api.test.tsx`, `components.test.tsx`, and `App.test.tsx` for API calls, modal validation/swatches/tooltips/count, unlock loading, dynamic selectors/filters, mapped colors, fallback, and header wiring.

The design threat matrix marks every row `N/A`; no threat-specific RED tasks are required. Strict TDD is disabled, so tests remain verification tasks after implementation. Complete Slice 1 and its tests before starting Slice 2. Product wording “delete with cascade” conflicts with the specs’ in-use refusal; resolve this before apply, while the task list follows the explicit safe-delete rules and confirmed rename cascade.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,100–1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Rust slice → PR 2: UI slice |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Complete and verify Rust slice; UI remains on old API | PR 1 | `npm test && (cd src-tauri && cargo test --lib && cargo test --test vault_repo)` | N/A: no Tauri desktop harness; SQLite integration is the runtime boundary | Revert listed Rust core, adapter, and test changes |
| 2 | Complete dynamic category administration UI after PR 1 | PR 2 | `npm test` and `npm run build` | N/A: no E2E driver; Testing Library covers rendered UI behavior | Revert listed `src/ui/` changes |
