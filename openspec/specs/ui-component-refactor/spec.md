# UI Component Refactor Specification

## Purpose

Define the behavior-preserving decomposition of the React/TypeScript UI. This specification changes maintainability and test structure, not user-visible product behavior.

## Requirements

### Requirement: Preserve the composition root and state ownership

`src/ui/App.tsx` MUST remain the composition root and sole owner of existing application state. Extracted screens and components MUST receive existing state and handlers as props, except for the single `CategoriesContext`, which MUST expose `categories`, `usage`, and category-color lookup. Its value MUST be memoized from `categories` and `usage`.

#### Scenario: Render the refactored application

- GIVEN the application is built from the refactored modules
- WHEN App renders any existing vault phase
- THEN the same screens, controls, state transitions, and command outcomes are available

#### Scenario: Consume shared category data

- GIVEN category consumers are rendered below the App provider
- WHEN categories or usage changes
- THEN consumers receive the updated values without introducing a second context or moving unrelated state ownership

### Requirement: Extract the approved UI modules without changing contracts

The UI SHALL provide folders for EntryCard, CategorySelect, EntryModal, CopyButton, DeleteConfirm, ImportConfirmModal, Toast, BackupActionsMenu, SearchFilters, FilterListbox, CategoryAdminModal, SwatchGrid, BackoffNotice, CreateScreen, and LoginScreen. It MUST add `useVaultCommands`, `sortCategories`, `useDismissable`, `spanishMessages`, and `viewTransitions`; MUST remove dead `MaskedPassword` code and tests; and MUST keep `api.tsx` intact as the IPC/domain boundary.

#### Scenario: Preserve modal remount behavior

- GIVEN a new-entry or edit-entry modal is opened repeatedly
- WHEN the selected entry identity changes
- THEN fields resynchronize exactly as before, including preservation of `key={editing?.id ?? "new"}` behavior

#### Scenario: Preserve transport and presentation behavior

- GIVEN any existing success, validation, lock, import, export, or command-error path
- WHEN the path is exercised after extraction
- THEN IPC calls, Spanish strings, visible results, and error handling are unchanged

### Requirement: Centralize shared behavior and global styles

`useDismissable` MUST preserve outside-click, Escape, and unmount cleanup behavior for all three existing consumers. Shared category ordering and Spanish messages MUST preserve exact outputs. View-transition behavior MUST preserve both supported and fallback paths. Global CSS MUST be imported by `main.tsx`, not component modules.

#### Scenario: Dismiss and clean up an overlay

- GIVEN a dismissable overlay is mounted
- WHEN an outside event or Escape is dispatched, or the hook unmounts
- THEN dismissal and listener cleanup match the existing behavior

### Requirement: Prove complete refactor coverage

Every extracted component folder MUST have a focused test; direct tests MUST cover both screens, CategoriesContext, every helper, and `useVaultCommands`, while existing tests are partitioned without losing coverage. Vitest MUST use the pinned `@vitest/coverage-v8@4.1.11`, explicit root-relative source includes, explicit test/setup excludes, text and HTML reporters, and global 100% lines, functions, branches, and statements.

#### Scenario: Accept a complete verification run

- GIVEN all required tests and coverage configuration are present
- WHEN `npm test`, `npm run build`, and `npx vitest run --coverage` run
- THEN all pass and every global coverage metric is 100%

#### Scenario: Reject an uncovered branch

- GIVEN any extracted branch, including view-transition, dismiss, modal, category, or lock/error paths, is uncovered
- WHEN coverage runs
- THEN the global gate fails until that branch is tested or the narrowly justified prescribed V8 hint is used

### Requirement: Enforce refactor boundaries and reviewability

The change MUST NOT alter Spanish copy, product behavior, state ownership outside the approved context, IPC/API contracts, Rust/Tauri code, Vite root, or files outside `src/ui/` except approved coverage package/configuration and lockfile changes. If a slice exceeds the 400-line review budget, it SHOULD be delivered as chained, independently reviewable PRs.

#### Scenario: Verify the out-of-scope boundary

- GIVEN the refactor is complete
- WHEN the changed files and runtime boundaries are reviewed
- THEN no prohibited product, transport, Rust/Tauri, or repository-layout change is present
