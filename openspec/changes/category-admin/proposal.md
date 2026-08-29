# Proposal: Category Administration

## Intent

Replace the hardcoded allow-list with user-managed categories. Preserve existing categories and colors; this lifts the archived MVP decision that custom-category management was out of scope.

## Scope

### In Scope
- Create, rename, recolor, and delete categories from an “Administrar categorías” modal opened in the vault header.
- Require at least one category; disable deletion when referenced by entries and explain why in a tooltip.
- Confirm renames with the affected-entry count; apply saved colors immediately to cards.
- Show categories alphabetically in the modal and entry dropdowns, using 20+ predefined swatches.
- Persist categories through database backup and restore.

### Out of Scope
- Editing entries as part of administration; manual ordering beyond alphabetical order.
- Custom per-entry colors, synchronization, sharing, or multi-user permissions.

## Capabilities

### New Capabilities
- `category-administration`: CRUD, ordering, colors, confirmations, deletion rules, and admin modal.

### Modified Capabilities
- `vault-entries`: Replace fixed categories with repository-backed values and add scenarios for ordering, rename cascades, color updates, and deletion rules.
- `vault-storage`: Persist and migrate the `categories` table while preserving seeded names and exact colors.

## Approach

Add `categories` (`name TEXT PRIMARY KEY`, `color TEXT`) through a `PRAGMA user_version` schema-v2 migration. Seed current categories with `#7a5220`, `#2f5d8c`, `#2f6b3f`, and `#6a4a8f`; make validation repository-backed. Add four Tauri commands: `list_categories`, `create_category`, `update_category`, and `delete_category`. Enforce `CategoryInUse` and the last-category rule in the service. Keep `entries.category` plain text and replace frontend constants/CSS selectors with dynamic data and a themed modal.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src-tauri/src/core/` | Modified | Model, validation, invariants, and errors. |
| `src-tauri/src/adapters/` | Modified | Migration, repository operations, DTOs, and commands. |
| `src/ui/` | Modified | Dynamic categories, modal, header access, and colors. |
| `openspec/specs/` | Modified/New | Entry, storage, and administration requirements. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migration or rename leaves inconsistent references | Med | Transactions, service invariants, and integration tests. |
| Dynamic colors regress WebKit/GTK rendering | Med | Reuse custom themed controls and verify cards. |

## Rollback Plan

Revert the feature and disable category administration. Preserve the migrated database and encrypted backups without rewriting user data.

## Dependencies

- Existing SQLite repository, Tauri IPC, React UI, and database backup/restore.

## Success Criteria

- [ ] Unlocked users can create, rename, recolor, and delete categories under all stated rules.
- [ ] Existing vaults migrate with all four seeded categories and unchanged initial card colors.
- [ ] Entry creation/editing, filters, alphabetical selectors, and cards use the current persisted category set.
- [ ] Rename cascades report affected-entry count, and category data survives backup/restore.
