# Proposal: UI Component Refactor

## Intent

Decompose the React/TypeScript UI into maintainable component folders, shared helpers, and one justified context while preserving runtime behavior, Spanish copy, transport boundaries, and the `App.tsx` composition-root role.

## Scope

### In Scope
- Keep `App.tsx`, `api.tsx`, `index.html`, `vite.config.ts` root behavior, `tauri.conf.json`, and `test/setup.ts` stable; move global CSS import to `main.tsx`.
- Split `components.tsx` into folders for EntryCard, CategorySelect, EntryModal, CopyButton, DeleteConfirm, ImportConfirmModal, Toast, BackupActionsMenu, SearchFilters, FilterListbox, CategoryAdminModal, SwatchGrid, and BackoffNotice; extract CreateScreen/LoginScreen.
- Add `helpers/{sortCategories,useDismissable,spanishMessages,viewTransitions}`, `contexts/CategoriesContext`, and `useVaultCommands`; remove dead `MaskedPassword` and its tests.
- Partition tests, add direct screen/context/helper/hook tests, cover every exploration §Coverage gap, and enforce global 100% lines/functions/branches/statements.

### Out of Scope
- Any product behavior, Spanish wording, IPC/API contract, Rust/Tauri change, or state ownership migration out of `App`.
- Moving files outside `src/ui/`, changing the Vite root, or adding contexts beyond Categories.

## Capabilities

### New Capabilities
None; this is behavior-preserving refactoring.

### Modified Capabilities
None; existing UI and category requirements remain unchanged.

## Decision Resolutions

1. Option A under `src/ui/`; 2. `App.tsx` remains composition root; 3. add memoized `CategoriesContext` once in App; 4. consolidate message helpers; 5. extract view transitions; 6. extract `useDismissable`; 7. remove `MaskedPassword`; 8. import styles only in `main.tsx`; 9. extract named `useVaultCommands`; 10. install pinned `@vitest/coverage-v8@4.1.11` and configure explicit root-relative include/exclude, text+HTML reporters, global 100 thresholds [S1–S4]; 11. use chained PRs when the 400-line review budget is exceeded.

## Approach

1. Establish coverage tooling/configuration and a green baseline.
2. Mechanically extract components/helpers/context, preserve `key={editing?.id ?? "new"}`, keep `api.tsx` intact, and make App a thin composer. Memoize context value by `categories`/`usage` [S5–S7].
3. Replace three dismissable effects and test outside-click, Escape, and unmount cleanup with `renderHook`/`fireEvent` [S8–S9]. Add the listed branch tests; stub `document.startViewTransition`, using the prescribed V8 hint only if necessary.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/ui/{App.tsx,main.tsx,components/**,helpers/**,contexts/**}` | Modified | Decomposition, composition, shared behavior, and tests |
| `vite.config.ts`, `package.json`, lockfile | Modified | Coverage provider and thresholds |

## Risks

| Risk | Mitigation |
|---|---|
| >400 changed lines | Chained, reviewable PRs; preserve tested slices. |
| View Transitions branch | Helper-level stub; narrow `v8 ignore` only if jsdom-inaccessible. |
| Spanish copy drift | Reuse exact strings and branch assertions. |
| Strict TS unused symbols | Typecheck each slice; named handlers/guard clauses. |
| EntryModal key remount regression | Preserve and directly test remount behavior. |

## Rollback Plan

Revert the latest chained slice, restoring its prior imports/tests. If coverage setup blocks delivery, revert its package/config changes independently; no API, Rust, or data migration requires recovery.

## Dependencies

- Existing Vitest 4.1.11; add matching `@vitest/coverage-v8@4.1.11` [S4].

## Success Criteria

- [ ] `npm test`, `npm run build`, and `npx vitest run --coverage` pass.
- [ ] Global coverage is 100% for all four metrics, with all specified tests present.
- [ ] UI behavior, copy, and API boundaries are unchanged.
