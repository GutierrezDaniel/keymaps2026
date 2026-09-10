# Tasks: UI Component Refactor

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

- Estimated changed lines: ~1,300–1,900 in 7 slices (exceeds 400-line budget).
- Delivery strategy `ask-on-risk`: chain strategy `stacked-to-main` (user decision).

### Suggested Work Units (7 chained PRs)

| # | Goal | Focused test | Rollback boundary |
|---|---|---|---|
| 1 | Coverage tooling baseline | `npx vitest run --coverage` | Revert `vite.config.ts`+`package*.json` |
| 2 | Extract EntryCard, SearchFilters, FilterListbox | `npm test` | Delete folders; restore imports |
| 3 | Extract EntryModal, CategorySelect, CopyButton, SwatchGrid | `npm test` | Delete folders; restore imports |
| 4 | Extract DeleteConfirm, ImportConfirmModal, Toast, BackupActionsMenu, BackoffNotice, CategoryAdminModal; CSS→`main.tsx` | `npm test` | Delete folders; restore imports |
| 5 | Extract CreateScreen/LoginScreen+useVaultCommands; delete `components.tsx`; move tests | `npm test` | Revert `App.tsx`; restore monolith |
| 6 | Helpers, CategoriesContext, provider wiring | `npm test` | Revert context/helper folders |
| 7 | Direct tests, remove MaskedPassword, coverage closure | `npx vitest run --coverage` | Revert added tests only |

Runtime harness per slice: `npm run build` (UI-only; Tauri runtime `N/A`).

## Phase 1: Coverage Tooling

- [x] 1.1 `npm i -D @vitest/coverage-v8@4.1.11`; commit `package.json`+`package-lock.json`
- [x] 1.2 In `vite.config.ts` add `test.coverage`: `provider:"v8"`, `reporter:["text","html"]`, `include:["App.tsx","api.tsx","components/**/*.tsx","helpers/**/*.tsx","contexts/**/*.tsx"]`, `exclude:["**/*.test.tsx","**/*.test.ts","**/test/**"]`, `thresholds:{lines:100,functions:100,branches:100,statements:100}`
- [x] 1.3 Record baseline `npx vitest run --coverage`; keep build green

## Phase 2: Mechanical Extraction (units 2–5)

- [x] 2.1 Move `EntryCard`, `SearchFilters`, `FilterListbox` into `src/ui/components/{EntryCard,SearchFilters,FilterListbox}/`; update `App.tsx` imports
- [x] 2.2 Move `EntryModal` (preserve `key={editing?.id ?? "new"}` remount), `CategorySelect`, `CopyButton`, `SwatchGrid`, `DeleteConfirm` into folders
- [x] 2.3 Move `ImportConfirmModal`, `Toast`(+`TOAST_DURATION_MS`), `BackupActionsMenu`, `BackoffNotice`, `CategoryAdminModal`(+`commandErrorFrom`) into folders
- [x] 2.4 Move `./styles.css` import from `components.tsx` to `src/ui/main.tsx`
- [x] 2.5 Extract `CreateScreen`/`LoginScreen` from `App.tsx` to `src/ui/components/{CreateScreen,LoginScreen}/`; App keeps state, phase logic, remount key
- [x] 2.6 Add `src/ui/helpers/useVaultCommands.tsx` (named handlers, injected setters/refs); `App.tsx` consumes it
- [x] 2.7 Delete `src/ui/components.tsx` once empty
- [x] 2.8 Relocate test blocks from `components.test.tsx`/`App.test.tsx` to co-located folder tests; assert exact Spanish copy

## Phase 3: Helpers, Context (unit 6)

- [x] 3.1 Create `src/ui/helpers/{sortCategories,useDismissable,spanishMessages,viewTransitions}.tsx`; exact outputs; consolidate `spanishMessage`+`categoryErrorMessage` into `spanishMessages`
- [x] 3.2 Create `src/ui/contexts/CategoriesContext/index.tsx`: provider + guarded hook; value `{categories,usage,categoryColor}` memoized on `[categories,usage]`
- [x] 3.3 Mount `CategoriesProvider` once in `App.tsx` around vault composition
- [x] 3.4 Re-point EntryCard, EntryModal/CategorySelect, SearchFilters, CategoryAdminModal to context; rest stay props
- [x] 3.5 Swap duplicated outside-click/Escape effects for `useDismissable` in `CategorySelect`, `FilterListbox`, `BackupActionsMenu`

## Phase 4: Test Closure / Cleanup (unit 7)

- [x] 4.1 Add `CreateScreen.test.tsx`, `LoginScreen.test.tsx`, `useVaultCommands.test.tsx`, `CategoriesContext.test.tsx`, helper tests via `renderHook`/`fireEvent`
- [x] 4.2 Stub `document.startViewTransition` for supported path; cover fallback; `/* v8 ignore next -- @preserve */` only if jsdom-inaccessible
- [x] 4.3 Cover gaps: `morphing` class, category-error kinds, `commandErrorFrom` fallback, CategoryAdminModal errors, App lock/NotFound/catch, CreateScreen empty-password
- [x] 4.4 Remove `MaskedPassword` and its test
- [x] 4.5 Gate: `npm test`, `npm run build`, `npx vitest run --coverage` pass with 100% all metrics

## Verification Commands

```bash
npm test
npm run build
npx vitest run --coverage
```