# Exploration: ui-component-refactor

Frontend React/TypeScript decomposition of `src/ui/*.tsx` into per-component
folders, shared helpers, and contexts — preserving identical functionality.

## Current State

- `src/ui/App.tsx` (881 lines): application shell + state machine. Owns 19
  state hooks (`phase`, `entries`, `emails`, `categories`, `usage`, `adminOpen`,
  `filters`, `details`, `leavingId`, `formOpen`, `editing`, `deleting`,
  `importConfirm`, `toast`, `error`, `notice`, `backoff`, `morphOriginId`,
  `morphActive`), 3 refs (`filtersRef`, `editingRef`, `toastTimerRef`), ~20
  async Tauri command handlers, 3 internal helpers (`supportsViewTransitions`,
  `withViewTransition`, `spanishMessage`) and 2 internal screen components
  (`CreateScreen`, `LoginScreen`).
- `src/ui/components.tsx` (1267 lines): 14 components — 9 exported and used by
  App (`EntryCard`, `EntryModal`, `DeleteConfirm`, `ImportConfirmModal`,
  `Toast`, `BackupActionsMenu`, `SearchFilters`, `CategoryAdminModal`,
  `BackoffNotice`), 1 exported but unused in production (`MaskedPassword`), 4
  private (`CopyButton`, `CategorySelect`, `FilterListbox`, `SwatchGrid`).
  3 internal helpers (`sortCategories`, `categoryErrorMessage`,
  `commandErrorFrom`), 1 exported constant (`TOAST_DURATION_MS`).
- `src/ui/api.tsx`: typed Tauri IPC client, domain types, `toCommandError`,
  `CATEGORY_PALETTE`, `passwordRequest`, `filtersPayload`, `backupFileName`.
  This is the transport/domain boundary (per FRONT.md), not a component.
- `src/ui/main.tsx`: entry. `src/ui/styles.css`: global styles (imported only
  by `components.tsx` today). `src/ui/test/setup.ts`: jsdom polyfills.
- `vite.config.ts`: `root: "src/ui"`, jsdom, setupFiles `./test/setup.ts`.
- `tsconfig.json`: `include: ["src"]` — already covers `src/ui` and any new
  `src/*` subtrees.
- `src-tauri/tauri.conf.json`: `frontendDist: "../src/ui/dist"` — pins build
  output under `src/ui/`.
- Tests: `App.test.tsx` (871 lines), `components.test.tsx` (752 lines),
  `api.test.tsx` (292 lines). Baseline: `npm test` → 3 files, 114 tests, all
  pass (verified 2026-09-08).
- Coverage tooling: NOT installed (`@vitest/coverage-v8` absent from
  node_modules and devDependencies; package-lock lists it only as an optional
  peer of vitest). `openspec/config.yaml` → `coverage_threshold: 0`.
- `MaskedPassword` is dead code in the app: exported and directly tested, but
  never rendered by App or any other production component.

## Component Inventory, Hierarchy, and Prop-Drilling Depth

```
App (composition root — all state lifted here)
├── CreateScreen            depth 1  (props: error, onCreated)
├── LoginScreen             depth 1  (props: error, notice, backoff, onExpireBackoff, onUnlock)
│   └── BackoffNotice       depth 2  (props: seconds, onExpire)
├── BackupActionsMenu       depth 1  (props: onExport, onImport)
├── SearchFilters           depth 1  (props: filters, categories, emails, onChange)
│   └── FilterListbox ×2    depth 2  (props: triggerLabel, emptyLabel, value, options, onChange, icon)
├── EntryCard               depth 1  (props: entry, color, leaving, morphOrigin, onOpen)
├── EntryModal              depth 1  (props: open, initial, categories, initialPassword, morphing, onSave, onCancel, onCopy, onDelete)
│   ├── CategorySelect      depth 2  (props: value, categories, onChange)
│   └── CopyButton ×4       depth 2  (props: label, onCopy)
├── DeleteConfirm           depth 1  (props: entry, onConfirm, onCancel)
├── ImportConfirmModal      depth 1  (props: onConfirm, onCancel)
├── CategoryAdminModal      depth 1  (props: open, categories, usage, onCreate, onUpdate, onDelete, onClose)
│   └── SwatchGrid ×2       depth 2  (props: value, onSelect)
└── Toast                   depth 1  (props: kind, message, onDismiss)
```

**Key finding: maximum prop depth today is 2 (App → component → private
subcomponent). No prop traverses more than 3 levels.** The directive's context
rule (>3 levels) does NOT trigger today and would only trigger if the refactor
introduces an intermediate screen wrapper (e.g., App → VaultScreen →
EntryModal → CategorySelect), which would put `categories` at 3 hops.

## App State Analysis (who consumes what)

| State | Consumers (props today) | After refactor |
|---|---|---|
| `categories` | EntryCard (via `categoryColor`), EntryModal→CategorySelect, SearchFilters, CategoryAdminModal — **4 consumers, wide fan-out** | Props at depth ≤2, or CategoriesContext |
| `usage` | CategoryAdminModal only | Props (narrow) |
| `filters` | SearchFilters only | Props (narrow) |
| `emails` | SearchFilters only | Props (narrow) |
| `details` (password cache) | EntryModal (`initialPassword`) only | Props (narrow) |
| `editing`/`leavingId`/`morphOriginId`/`formOpen` | EntryModal + EntryCard + DeleteConfirm | Props (narrow) |
| `deleting` | DeleteConfirm only | Props (narrow) |
| `importConfirm` | ImportConfirmModal only | Props (narrow) |
| `toast` | Toast only (App owns timer) | Props (narrow) |
| `error`/`notice`/`backoff` | CreateScreen + LoginScreen (+ banner) | Props (narrow) |
| `adminOpen` | CategoryAdminModal only | Props (narrow) |

All state already lives in App (the parent) and flows down as props — consistent
with directive rule 2 ("shared hooks → lift to parent, pass as props"). The
refactor must NOT move shared state into children.

**Context verdict:** only ONE context is justified — a CategoriesContext
(`categories` + `usage` + `categoryColor` lookup), matching the orchestrator's
hint (EntryCard + EntryModal/CategorySelect + SearchFilters +
CategoryAdminModal). It is not strictly required by the >3-level rule (depth is
2 today, 3 at most after a screen split), but it removes the widest prop fan-out
and is the only state with 4 consumers. Everything else stays as props.

## Helpers Extraction Plan

### Reused across multiple consumers → `src/helpers/` (per directive)

| Helper | Source | Consumers | Verdict |
|---|---|---|---|
| `sortCategories` | components.tsx | CategorySelect, SearchFilters, CategoryAdminModal (3) | **Move to helpers + test** |
| `useDismissable` (NEW) | duplicated outside-click/Escape effect in CategorySelect, FilterListbox, BackupActionsMenu (3 copies) | 3 components | **Extract to helpers + test** (also satisfies "avoid useEffect / extract to named functions") |

### Single-consumer helpers → co-locate with the component (per directive rule 2)

| Helper | Source | Consumer | Verdict |
|---|---|---|---|
| `commandErrorFrom` | components.tsx | CategoryAdminModal only (3 call sites) | Co-locate in CategoryAdminModal folder + test |
| `supportsViewTransitions` / `withViewTransition` | App.tsx | App only | Co-locate in App folder, **or** helpers (see open decisions — moving to helpers makes the View-Transitions true-path unit-testable via a stubbed `document.startViewTransition`, which jsdom App tests cannot hit) |
| `passwordRequest`, `filtersPayload`, `backupFileName` | api.tsx | api client only | **Stay in api.tsx** (transport-boundary internals; `backupFileName` is tested indirectly via `chooseExportPath`) |
| `toCommandError` | api.tsx | App (many), components via `commandErrorFrom` | **Stay in api.tsx** — it is the IPC error-normalization contract, exported and tested in `api.test.tsx`; it depends on `CommandErrorKind`/variant maps that live there. Moving it would couple helpers → api types anyway |

### Design opportunity (open decision)

`spanishMessage` (App.tsx, 15 branches) and `categoryErrorMessage`
(components.tsx, 7 branches) overlap in 6 category error kinds with identical
Spanish copy. Consolidating into one `spanishMessages` helper (e.g.,
`categoryErrorMessage` delegating to `spanishMessage` + fallback) is
behavior-identical and removes duplication — but it is a change beyond pure
mechanical extraction, so the proposal phase must decide.

## Target Folder Structure (Option A — under `src/ui/`, recommended)

```
src/ui/
├── index.html / main.tsx / styles.css / api.tsx(+test) / App.tsx(+test)
├── components/
│   ├── CreateScreen/         ← from App.tsx (new direct tests needed)
│   ├── LoginScreen/          ← from App.tsx (new direct tests needed)
│   ├── EntryCard/  EntryModal/  CopyButton/  CategorySelect/
│   ├── DeleteConfirm/  ImportConfirmModal/  Toast/  BackupActionsMenu/
│   ├── SearchFilters/  FilterListbox/
│   ├── CategoryAdminModal/  SwatchGrid/   (+ commandErrorFrom co-located)
│   ├── BackoffNotice/
│   └── MaskedPassword/       ← dead code; keep with test or remove (decision)
├── helpers/
│   ├── sortCategories.tsx(+test)      (3 consumers)
│   ├── useDismissable.tsx(+test)      (3 consumers, extracted)
│   └── spanishMessages.tsx(+test)     (consolidation — decision)
│   └── viewTransitions.tsx(+test)     (decision)
├── contexts/
│   └── CategoriesContext/index.tsx(+test)   (categories + usage + categoryColor)
└── test/setup.ts
```

Each component folder: `<Name>.tsx` + `<Name>.test.tsx` (vitest default include
matches `*.test.tsx` anywhere under root — no config change needed for Option A).

## Import Tree and Path Implications

Current: `main.tsx → ./App → ./api + ./components`; `components.tsx → ./api +
./styles.css`; tests import `./App`, `./components`, `./api`. No path aliases.

**Option A (recommended): everything under `src/ui/`.** No changes to
`vite.config.ts` (root stays `src/ui`), `tsconfig.json` (include "src" already
covers it), `tauri.conf.json` (`../src/ui/dist` unchanged), `test/setup.ts`, or
`index.html`. Only intra-`src/ui` import paths change:
- App.tsx: `./components` → per-component imports (10 imports).
- Component files: `./api` → `../api`; `./styles.css` → `../styles.css`.
- `TOAST_DURATION_MS` moves to `components/Toast/Toast.tsx` (App.test.tsx import
  updates accordingly).
- Optionally move `import "./styles.css"` from components.tsx to main.tsx
  (single global stylesheet import; behavior identical) — small decision.

**Option B (literal `src/components`, `src/helpers`, `src/contexts` at repo
`src/` level):** feasible but requires coordinated changes — vite `root` →
`src`, `index.html` + `main.tsx` move up to `src/`, `setupFiles` path update,
`tauri.conf.json` `frontendDist` → `../src/dist`. Vitest test discovery with
`root: "src/ui"` would NOT pick up tests outside the root, so keeping root at
`src/ui` while placing components outside would silently break `npm test`.
Higher churn/risk; only worth it if the user explicitly wants the `src/` layout.

## Coverage: Current State and What Is Needed

- **Provider not installed.** `npm install -D @vitest/coverage-v8@4.1.11`
  (must match vitest 4.1.11). Then add to `vite.config.ts`:
  ```ts
  test: { coverage: { provider: "v8", reporter: ["text", "html"],
    include: ["components/**", "helpers/**", "contexts/**", "App.tsx", "api.tsx"],
    exclude: ["**/*.test.tsx", "**/test/**"] } }
  ```
  Run: `npx vitest run --coverage`. Threshold stays 0 until proposal decides
  (directive demands "complete coverage" → per-module ~100% line target).
- **Statically known gaps in current tests** (verified against the 114 tests):
  - `categoryErrorMessage`: only the `DuplicateCategory` branch is covered
    (inline rejection test); `BlankCategoryName`, `InvalidCategoryColor`,
    `CategoryInUse`, `LastCategory`, `CategoryNotFound`, default uncovered.
  - `commandErrorFrom`: `{ kind }` passthrough covered; `toCommandError`
    fallback branch uncovered.
  - `spanishMessage` (App): `AuthenticationFailed`, `Backup`, `Import`,
    `Locked` paths covered; `InvalidCategory`, `BlankCategoryName`,
    `InvalidCategoryColor`, `DuplicateCategory`, `CategoryInUse`,
    `LastCategory`, `CategoryNotFound`, `NotFound`, `InvalidField`, `Crypto`,
    `Store`, `Clipboard`, default uncovered.
  - Outside-click close effects: untested in `CategorySelect` and
    `FilterListbox` (covered for `BackupActionsMenu`).
  - `EntryModal` `morphing` class branch: not asserted.
  - `CategoryAdminModal`: editError-from-backend and actionError branches
    uncovered; rename preview with `affected_entries === 1` branch uncovered.
  - `CreateScreen`: empty-master-password branch untested (mismatch branch is
    covered via App.test).
  - App Locked branches for export/import/save/delete and the delete-`NotFound`
    branch: untested. `handleLock` catch branch: untested.
  - View Transitions true-path (`withViewTransition`): not exercisable in
    jsdom through App — extracting to a helper makes it unit-testable by
    stubbing `document.startViewTransition`.
- **New tests required by the directive**: every extracted component folder
  gets its own test (split/relocate the existing `components.test.tsx`
  blocks + add `CreateScreen.test.tsx` and `LoginScreen.test.tsx` direct
  tests), plus `sortCategories.test.tsx`, `useDismissable.test.tsx`,
  `spanishMessages.test.tsx` (if consolidated), `viewTransitions.test.tsx`
  (if extracted), and `CategoriesContext` test.

## Design Decisions for Proposal Phase

1. **Option A (`src/ui/...`) vs Option B (`src/...`)** — recommend A (zero
   infra churn; B requires vite root + index.html/main.tsx + tauri.conf.json
   changes).
2. **App stays as composition root at `src/ui/App.tsx`** (state + handlers
   remain; screens extracted) vs moving App into a folder. Recommend stay.
3. **CategoriesContext**: create (recommended, 4-consumer fan-out, matches
   hint) vs plain props (no >3-level drilling exists today).
4. **spanishMessages consolidation** (merge `spanishMessage` +
   `categoryErrorMessage`) vs keeping both co-located.
5. **viewTransitions helper extraction** (enables true-path unit test) vs
   co-locating in App.
6. **useDismissable hook extraction** (3 duplicated effects) — recommended.
7. **MaskedPassword**: keep (dead code, own test) vs remove. Removing changes
   the test suite but not runtime functionality.
8. **styles.css import** moves to main.tsx vs per-component `../styles.css`.
9. **`useVaultCommands` custom hook** for App's ~20 handlers (named-function
   extraction per directive) vs handlers inline in App.
10. **Coverage threshold** target and provider install (`@vitest/coverage-v8`).
11. **Delivery strategy**: refactor touches ~2,900 source lines + ~1,900 test
    lines → far over the 400-line PR budget → chained PRs recommended.

## Risks

- **PR size / review load**: >4,000 changed lines across the change; needs
  chained PRs and work-unit commits.
- **View Transitions coverage**: the true-path is untestable through App in
  jsdom; only the helper-level stub can cover it — do not block verification
  on it.
- **MaskedPassword removal** would alter the test inventory — needs explicit
  user sign-off to keep the "same functionality" promise clean.
- **Spanish copy drift**: tests assert exact Spanish strings — the extraction
  must not reword anything (tests are the safety net).
- **Strict TS flags** (`noUnusedLocals`, `noUnusedParameters`): moving private
  components/helpers must not leave dangling imports.
- **Vitest discovery trap (Option B)**: tests outside vite root
  (`root: "src/ui"`) are silently not discovered — must not mix folder bases.
- **`key={editing?.id ?? "new"}` remount pattern** must survive the EntryModal
  move (it is what makes the field-resync effect work).

## Recommendation

Split `components.tsx` into per-component folders under `src/ui/components/`,
extract `CreateScreen`/`LoginScreen` from App.tsx into folders, extract
`sortCategories` + `useDismissable` to `src/ui/helpers/`, create
`src/ui/contexts/CategoriesContext`, keep `api.tsx` and App-as-composition-root
in place, and install `@vitest/coverage-v8` with per-module coverage targets.
App remains the single state owner; screens receive props; the only context is
Categories. Mechanical extraction first (Option A, zero infra churn), then the
optional consolidations as explicitly-scoped follow-ups.

## Ready for Proposal

Yes — with the open decisions above resolved by the proposal phase (folder
base, MaskedPassword, spanishMessages consolidation, coverage threshold,
delivery strategy).