# Design: Category Administration

## Technical Approach

Extend the hexagonal flow without a foreign key: categories become SQLite metadata, while `entries.category` remains text and service validation guards references. Rust owns invariants and confirmation; SQLite owns atomic persistence; Tauri exposes unlocked commands; React threads one category map through selectors, filters, forms, and cards.

## Architecture Decisions

| Decision | Choice | Alternatives / rationale |
|---|---|---|
| Category storage | `categories(name TEXT PRIMARY KEY, color TEXT NOT NULL)` and `PRAGMA user_version` v2 | No FK avoids an entries-table rebuild; service checks prevent dangling writes. |
| Validation | Domain name/palette helpers plus repository-backed `category_exists` | Replaces `INITIAL_CATEGORIES` while keeping exact, case-sensitive duplicate checks. |
| Rename contract | Preview count, explicit confirmation, then one adapter transaction | UI-only confirmation is insufficient; service and IPC refuse unconfirmed renames. |
| UI colors | Backend `Category { name, color }` map with inline/CSS-variable card color | Replaces brittle selectors and provides an unknown-category fallback. |

`CATEGORY_PALETTE` is exactly these 24 swatches: `#7a5220`, `#2f5d8c`, `#2f6b3f`, `#6a4a8f`, `#ad3a2d`, `#c05640`, `#b76e2b`, `#d4a72c`, `#86601f`, `#5f7f35`, `#4f8a6b`, `#2f6b63`, `#3b7d91`, `#4a6fa5`, `#6b5b95`, `#8a4f7d`, `#a34f67`, `#9a5b4a`, `#7c5a3c`, `#596275`, `#36454f`, `#708090`, `#8f9e9d`, `#a67c52`.

## Data Flow

```text
unlock → list_categories → App category state → admin/selectors/filters/card map
admin update(confirm=false) → category_in_use count → confirmation UI
admin update(confirm=true) → service invariants → SQLite transaction(categories + entries)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src-tauri/src/core/domain/entry.rs` | Modify | Add `Category`, 24-swatch `CATEGORY_PALETTE`, and name/color validators; remove fixed allow-list validation. |
| `src-tauri/src/core/ports/vault_repository.rs` | Modify | Add category listing, existence, create, atomic update, delete, and usage-count methods. |
| `src-tauri/src/core/application/vault_service.rs` | Modify | Add CRUD use cases, preview result, repository-backed entry validation, all category invariants, and `CategoryInUse` mapping. |
| `src-tauri/src/adapters/persistence/sqlite.rs` | Modify | Set `SCHEMA_VERSION=2`; add idempotent migration and category SQL. `update_category` atomically updates `categories` and executes `UPDATE entries SET category=? WHERE category=?`. |
| `src-tauri/src/adapters/tauri.rs` | Modify | Add DTOs, validation errors, and `require_unlocked()`-gated `list_categories`, `create_category`, `update_category`, `delete_category` commands with mutex forwarding. |
| `src/ui/{api.tsx,App.tsx,components.tsx,styles.css}` | Modify | Dynamic client/state, `CategoryAdminModal` name input and swatch grid, prop threading through `CategorySelect`, `SearchFilters`, and `EntryModal`, header action, mapped card colors, and safe defaults. |
| `src-tauri/tests/vault_repo.rs`, `src/ui/{api.test.tsx,components.test.tsx,App.test.tsx}` | Modify/Create | Storage, IPC, component, and application coverage. |

## Interfaces / Contracts

```rust
struct Category { name: String, color: String }
trait VaultRepository {
    fn list_categories(&self) -> Result<Vec<Category>>; // case-normalized name, exact-name tie-break
    fn category_exists(&self, name: &str) -> Result<bool>;
    fn create_category(&self, category: &Category) -> Result<()>;
    fn update_category(&self, old: &str, category: &Category) -> Result<usize>; // atomic affected count
    fn delete_category(&self, name: &str) -> Result<()>;
    fn category_in_use(&self, name: &str) -> Result<usize>;
}
```

Commands use `CategoryDto { name, color }`; each command is unlocked-gated. Create receives `{ name, color }`, delete `{ name }`, and update `UpdateCategoryRequest { old_name, new_name, color, confirmed }`. Update returns `Applied` or `RenamePreview { affected_entries }`; recolors apply directly, while unconfirmed renames perform no write. The modal lists swatch/name/edit/trash and contains a “Nueva categoría” name-and-swatch form, disables in-use trash with a tooltip, confirms the count, and sends the confirmed request. At least one category remains.

## Testing Strategy

| Layer | Coverage | File |
|---|---|---|
| Core unit | Duplicate/blank/palette validation, custom entry acceptance, rename preview, in-use and last-category deletion | `src-tauri/src/core/application/vault_service.rs` |
| SQLite integration | v1→v2 seeds, idempotence/custom preservation, ordering, usage, atomic rename rollback, CRUD and backup visibility | `src-tauri/tests/vault_repo.rs` |
| Commands | DTOs, unlocked gating, error mapping, preview/confirmed rename | `src-tauri/src/adapters/tauri.rs` |
| Frontend | API wiring; modal validation/swatches/tooltips/count; unlock loading, threading, mapped colors, fallback | `src/ui/api.test.tsx`, `components.test.tsx`, `App.test.tsx` |

## Threat Matrix

| Boundary | Status / reason |
|---|---|
| Documentation-like paths | N/A — no executable-file classification. |
| Git repository selection | N/A — no repository selection. |
| Commit state | N/A — no commit automation. |
| Push state | N/A — no push automation. |
| PR commands | N/A — no PR command composition. |

## Migration / Rollout

`SCHEMA_V2` runs when `user_version < 2`, creates the table, and uses `INSERT ... ON CONFLICT(name) DO NOTHING` for `entretenimiento=#7a5220`, `trabajo=#2f5d8c`, `estudio=#2f6b3f`, and `servicios=#6a4a8f`. Entries remain unchanged and valid; whole-database backups include categories. Retained app data survives reinstall and reopens at v2; deleting it creates a fresh vault. A rollback binary preserves data but cannot administer custom categories. Forecast 1,100–1,300 changed lines: chain slice 1 (Rust core/storage/migration/commands/tests) and slice 2 (UI/tests), each green and reviewable under 400 lines.

## Open Questions

None blocking.
