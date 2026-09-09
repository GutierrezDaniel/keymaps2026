# Design: UI Component Refactor

## Technical Approach

Perform a mechanical decomposition under `src/ui/` while keeping `App.tsx` as
the composition root and owner of the existing state machine. Presentational
components remain backend-agnostic and receive props/callbacks. The only new
shared state boundary is `CategoriesContext`; `api.tsx` remains the untouched
typed IPC/domain boundary. Move global CSS ownership to `main.tsx`, then
extract helpers and command orchestration without changing Spanish strings,
callback order, timers, or view-transition behavior.

## Architecture Decisions

| Decision | Choice | Alternatives / rationale |
|---|---|---|
| Module base | `src/ui/components`, `helpers`, `contexts` | Do not use repo-level `src/*`: it would require Vite/Tauri root changes and can hide tests outside `root: "src/ui"`. |
| State boundary | `App` owns existing state; one `CategoriesProvider` supplies `categories`, `usage`, and `categoryColor` | Plain props preserve behavior but repeat the widest four-consumer fan-out; no other context is justified. |
| Command extraction | `helpers/useVaultCommands.tsx` exposes named command handlers and receives App setters/refs/callback dependencies | Keeping handlers inline leaves App oversized; moving state into the hook violates the ownership invariant. |
| Shared behavior | `sortCategories`, `useDismissable`, `spanishMessages`, and `viewTransitions` are independently testable | Preserve exact outputs and both transition paths; keep IPC normalization in `api.tsx`. |

## Data Flow

```text
api.tsx (unchanged IPC) ──→ useVaultCommands ──→ App state/setters
                                      │                    │
                                      └── callbacks/props ──┴── extracted screens/components
App categories + usage ──→ CategoriesProvider (memoized value)
                                      └──→ EntryCard, EntryModal, SearchFilters,
                                           CategoryAdminModal
```

`CategoriesContext` exports a provider and a consuming hook:

```ts
type CategoriesContextValue = {
  categories: CategoryDto[];
  usage: Record<string, number>;
  categoryColor: (name: string) => string | undefined;
};
```

The provider computes its value with `useMemo(..., [categories, usage])`, with
the lookup derived from the current category array. It is mounted once by App
around the unlocked vault composition. Consumers use context only for the
approved category data; filters, entries, modal state, errors, and commands
remain props.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/ui/App.tsx` | Modify | Keep state/render branches and `key={editing?.id ?? "new"}`; import extracted screens, provider, components, transition/message helpers, and command hook. |
| `src/ui/main.tsx` | Modify | Import `./styles.css` as the single global stylesheet owner. |
| `src/ui/components.tsx` | Delete | Replace monolith with per-folder modules. |
| `src/ui/components/{CreateScreen,LoginScreen,EntryCard,CategorySelect,EntryModal,CopyButton,DeleteConfirm,ImportConfirmModal,Toast,BackupActionsMenu,SearchFilters,FilterListbox,CategoryAdminModal,SwatchGrid,BackoffNotice}/*.tsx` | Create | One implementation module and focused test per approved component; co-locate `commandErrorFrom` with `CategoryAdminModal`. Remove `MaskedPassword` and its test. |
| `src/ui/helpers/{sortCategories,useDismissable,spanishMessages,viewTransitions}.tsx` | Create | Shared ordering, dismissal lifecycle, exact Spanish error mapping, and transition wrapper. |
| `src/ui/helpers/useVaultCommands.tsx` | Create | Named App command orchestration using injected state dependencies. |
| `src/ui/contexts/CategoriesContext/index.tsx` | Create | Provider, value type, and guarded consumer hook. |
| `src/ui/{App.test.tsx,api.test.tsx,components.test.tsx}` | Modify/delete | Keep App/API coverage, partition component cases into focused tests, and add direct screen/context/helper/hook tests. `api.test.tsx` remains boundary coverage; `api.tsx` is unchanged. |
| `vite.config.ts`, `package.json`, `package-lock.json` | Modify | Pin `@vitest/coverage-v8@4.1.11`; configure root-relative includes, explicit test/setup excludes, text+HTML reporters, and global 100% lines/functions/branches/statements. |

## Interfaces / Contracts

All extracted component props are the existing prop contracts. `useVaultCommands`
must return handlers equivalent to the current create/unlock/lock, backup,
entry, and category handlers, while preserving normalized error handling and
the existing async sequencing. No extracted module may import Tauri directly;
only `api.tsx` may cross the IPC boundary.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Every component, helper, context, and command branch | Partition existing tests; use `renderHook`/`fireEvent` for outside-click, Escape, cleanup, and exact Spanish mappings; stub `document.startViewTransition` for the supported path. |
| Integration | App phase transitions, API wiring, modal remount, category refresh, lock/error paths | Preserve App/API suites and add provider-backed consumer probes; assert exact copy and calls. |
| Coverage gate | All included UI sources | `npx vitest run --coverage`, global 100% for all four metrics; use a V8 hint only for a demonstrably inaccessible branch. |

## Threat Matrix

`N/A` — no routing, shell commands, subprocesses, VCS/PR automation,
executable-file classification, or process-integration boundary is changed.
The Tauri IPC boundary is explicitly preserved, not redesigned.

## Migration / Rollout

No data migration or feature flag. Implement in chained review slices when a
slice exceeds the 400-line budget: (1) coverage package/config plus baseline,
(2) mechanical component/screen extraction, (3) helpers/context/command hook,
(4) focused tests and coverage closure. Each slice must build and test before
the next; rollback is reverting the latest slice, with coverage config
revertible independently.

## Open Questions

None.
