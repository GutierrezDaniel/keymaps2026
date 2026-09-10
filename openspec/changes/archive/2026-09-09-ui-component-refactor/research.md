# Research: ui-component-refactor — external evidence (gentle-ai.sdd-research/v1)

- revision: 1
- outcome: done
- change: `ui-component-refactor`
- exploration input: `openspec/changes/ui-component-refactor/exploration.md` (read-only input, not rewritten)
- artifact store mode: openspec (repo-local)
- verified stack (from `package.json` + `vite.config.ts`, read 2026-09-08): React 18.3.1,
  TypeScript 5.5.3, Vite 8.2.2, Vitest 4.1.11, @testing-library/react 16, jsdom 26,
  vite `root: "src/ui"`, `setupFiles: ["./test/setup.ts"]`

## Admission and grants

- capability: `gentle-ai.sdd-research-capability/v1`
- requested classes: `documentation`, `open-web`
- observed exact grants: `documentation` (Context7 MCP: Vitest, React, Testing Library
  official docs), `open-web` (web search + npm registry fetch)
- result: admitted — no denial. All source classes used were within the declared grants.
- No evidence capability was inferred from Bash, file access, or tool names: every claim
  below maps to the cited sources in §Sources.

## Questions (only these three lanes; nothing else)

1. Q1 — Vitest coverage: exact `@vitest/coverage-v8` version compatible with Vitest 4.1.11,
   configuration (`test.coverage.provider/include/exclude/reporter/thresholds`) for `.tsx`
   files in a project with `root="src/ui"`, how to exclude `*.test.tsx` and setup files,
   and recommended thresholds for demanding complete coverage.
2. Q2 — React Context + testing: canonical pattern for a data context (e.g. categories:
   value + functions) and how to test provider + consumer with @testing-library/react
   (`render` with `wrapper`).
3. Q3 — Custom-hook testing: how to test a hook (e.g. dismiss on outside-click/Escape with
   `addEventListener`/cleanup) with @testing-library/react v16 (`renderHook`, `act`).

## Sources

| ID | Class | Title | Publisher | URL | Accessed |
|----|-------|-------|-----------|-----|----------|
| S1 | documentation | Vitest Coverage Guide (providers, include/exclude, reporters, run with `--coverage`) | Vitest (official docs, via Context7 `/vitest-dev/vitest`) | https://vitest.dev/guide/coverage | 2026-09-08 |
| S2 | documentation | Vitest Coverage Config Reference (`coverage.provider/enabled/include/exclude/reporter/thresholds`, incl. `{100: true}` glob shortcut and negative-threshold form) | Vitest (official docs, via Context7 `/vitest-dev/vitest`) | https://vitest.dev/config/coverage | 2026-09-08 |
| S3 | documentation | `@vitest/coverage-v8` README (set `provider: 'v8'`, default provider) | vitest-dev/vitest GitHub (via Context7) | https://github.com/vitest-dev/vitest/blob/main/packages/coverage-v8/README.md | 2026-09-08 |
| S4 | documentation | npm registry metadata `@vitest/coverage-v8@4.1.11` (version exists; `peerDependencies: {vitest: 4.1.11}`) | npm registry | https://registry.npmjs.org/@vitest%2Fcoverage-v8/4.1.11 | 2026-09-08 |
| S5 | documentation | React `useContext` reference (pass object + function via provider; `useCallback`+`useMemo` value stabilization) | React official docs react.dev (via Context7 `/reactjs/react.dev`) | https://react.dev/reference/react/useContext | 2026-09-08 |
| S6 | documentation | React `createContext` reference (define/provide context, consume with `useContext`) | React official docs react.dev (via Context7) | https://react.dev/reference/react/createContext | 2026-09-08 |
| S7 | documentation | Testing Library `render(ui, options)` API (`wrapper` option) + `RenderOptions` types | Testing Library official docs (via Context7 `/testing-library/react-testing-library`) | https://testing-library.com/docs/react-testing-library/api#render | 2026-09-08 |
| S8 | documentation | Testing Library `renderHook(callback, options)` API (`initialProps`, `wrapper`, `result`/`rerender`/`unmount`; context-wrapper + unmount-cleanup example) | Testing Library official docs (via Context7) | https://testing-library.com/docs/react-testing-library/api#renderhook | 2026-09-08 |
| S9 | documentation | Testing Library `fireEvent` API + `act(callback)` API (sync/async state-update flushing) | Testing Library official docs (via Context7) | https://testing-library.com/docs/react-testing-library/api#fire-event | 2026-09-08 |

## Validated claims

### Q1 — Cobertura Vitest

- C1.1 [S4]: The exact coverage package for this repo is `@vitest/coverage-v8@4.1.11`.
  Version 4.1.11 exists in the npm registry and declares `peerDependencies: { "vitest": "4.1.11" }`
  (its own devDependencies also pin `vitest: 4.1.11`). Install command (for propose/apply,
  NOT executed in this phase): `npm i -D @vitest/coverage-v8@4.1.11`.
- C1.2 [S1][S3]: Both `v8` and `istanbul` providers are optional packages; `v8` is the
  default provider (`coverage.provider` defaults to `'v8'`). After installing the package,
  set `test.coverage.provider: 'v8'` (or leave empty) and run coverage with
  `npx vitest run --coverage` (equivalently `vitest --coverage`, or set
  `coverage.enabled: true` in config with a `coverage` npm script).
- C1.3 [S1]: Uncovered source files are only in the report if matched by
  `coverage.include` — configure it to pick up the sources, e.g. `include: ['src/**/*.{ts,tsx}']`
  in a standard layout. Implication for this repo (vite `root: "src/ui"`): coverage globs
  resolve relative to the project root, so use root-relative patterns such as
  `include: ["App.tsx", "api.tsx", "components/**/*.tsx", "helpers/**/*.tsx", "contexts/**/*.tsx"]`.
- C1.4 [S1]: Files matching `coverage.include` can be removed from the report with
  `coverage.exclude` (documented example excludes a single file).
  Additionally, when coverage is enabled Vitest automatically adds the `include` (test-file)
  patterns to the default coverage `exclude`, so test files matching the test `include`
  are not counted as coverable sources. Implication: `**/*.test.tsx` is excluded by default,
  but the refactor should ALSO declare it explicitly —
  `exclude: ["**/*.test.tsx", "**/*.test.ts", "**/test/**"]` — so `test/setup.ts` and any
  future test helpers are excluded regardless of default-list drift between versions.
- C1.5 [S2]: Thresholds live under `coverage.thresholds` with keys
  `lines | functions | branches | statements` (positive number = minimum percent; negative
  number = max allowed uncovered items, e.g. `lines: -10` means at most 10 uncovered lines).
  Per-file enforcement is available (`thresholds.perFile: { lines, functions, branches, statements }`)
  and per-glob enforcement via `thresholds: { '<glob>': { 100: true } }` (the `{100: true}`
  shortcut requires 100% on all metrics for matching files).
- C1.6 [S2]: Standard reporters are configured via `coverage.reporter` (e.g.
  `reporter: ["text", "html"]`; custom reporters by npm name or absolute path). `text` gives
  the CI/console gate signal; `html` gives the per-file drill-down for the gaps listed in
  exploration §Coverage.
- C1.7 (recommendation derived from C1.5 + directive "complete coverage", decision-owned by
  propose): minimal config skeleton for `vite.config.ts` (root `src/ui`):

  ```ts
  test: {
    // ... existing: environment jsdom, globals, setupFiles
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["App.tsx", "api.tsx", "components/**/*.tsx", "helpers/**/*.tsx", "contexts/**/*.tsx"],
      exclude: ["**/*.test.tsx", "**/*.test.ts", "**/test/**"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  }
  ```

  Stricter per-module alternative: keep global thresholds slightly lower and enforce
  `'components/**/*.tsx': { 100: true }` (etc.) per glob. The View-Transitions true-path
  (`withViewTransition`) is NOT exercisable through App in jsdom (exploration risk) — if the
  global-100 gate is chosen, that branch must either live in an extracted helper tested with
  a stubbed `document.startViewTransition`, or be carved out with a `v8 ignore` hint
  (`/* v8 ignore next -- @preserve */`, whose `-- @preserve` suffix is required because the
  transpiler strips comments).

### Q2 — React Context + testing

- C2.1 [S6]: Canonical definition: `createContext(defaultValue)` defines the context;
  components read it with `useContext(Context)` (closest provider above them in the tree;
  number of layers does not matter).
- C2.2 [S5]: Canonical data+functions pattern: the provider component owns state and passes
  an object with both value and updater through `value`, e.g.
  `value={{ currentUser, setCurrentUser }}` (docs' `CurrentUserContext` example), or
  `value={{ currentUser, login }}`. Direct implication: `CategoriesContext` =
  `createContext` holding `{ categories, usage, categoryColor }` (optionally + actions),
  provided once at the App composition root; `EntryCard`, `EntryModal`/`CategorySelect`,
  `SearchFilters`, `CategoryAdminModal` consume via `useContext(CategoriesContext)`.
- C2.3 [S5]: Passing a fresh object/function literal as `value` on every provider re-render
  causes unnecessary re-renders of all consumers; the documented fix is `useCallback` for
  functions + `useMemo` for the value object
  (`useMemo(() => ({ currentUser, login }), [currentUser, login])`). Implication: memoize the
  `CategoriesContext` value (deps: `categories`, `usage`) so typing in `SearchFilters` or toast
  updates in App do not re-render every category consumer.
- C2.4 [S7]: Provider+consumer testing: Testing Library's `render(ui, options)` accepts a
  `wrapper` component rendered around the UI (documented `Wrapper` example providing
  `ThemeContext` value `"dark"`). Implication: test each consumer with
  `render(<EntryCard … />, { wrapper })` where `wrapper = ({ children }) =>
  <CategoriesContext.Provider value={…}>{children}</CategoriesContext.Provider>` (or the real
  `CategoriesProvider`), asserting rendered output and firing interactions; test the provider
  itself by rendering a probe consumer inside it and asserting the delivered value/actions.
  The same `wrapper` mechanism exists for hooks (see C3.2).

### Q3 — Testing de hooks personalizados

- C3.1 [S8]: `renderHook(renderCallback, options)` renders a hook inside a hidden test
  component and returns `{ result, rerender, unmount }`; `result.current` always holds the
  latest return value. `options.initialProps` feeds the callback argument (driven further via
  `rerender(newProps)`); `options.wrapper` wraps the hook (e.g. context providers).
  Implication: `useDismissable(ref, onDismiss)` is tested via
  `renderHook(({ onDismiss }) => useDismissable(ref, onDismiss), { initialProps: { onDismiss } })`.
- C3.2 [S8]: The documented context-wrapper + unmount-cleanup example proves `unmount()`
  synchronously triggers effect cleanup (there: `clearTimeout`). Implication: the hook's
  `removeEventListener` cleanup is verified by `unmount()` + asserting the listener is gone
  (e.g. dispatching the event post-unmount no longer calls `onDismiss`, or spying
  `removeEventListener`); this is the direct analogue for the `useDismissable` cleanup test.
- C3.3 [S9]: `fireEvent.<eventName>(element, init?)` dispatches synthesized events
  (e.g. `fireEvent.click`, `fireEvent.change`); a pre-constructed `Event` can also be
  dispatched (`fireEvent(element, new Event(...))`). `act(callback)` (sync `act(() => …)`,
  async `await act(async () => …)`) flushes React state updates to the DOM. Implication for
  `useDismissable`: attach the hook's listeners to `document`, then
  `fireEvent.mouseDown(document, …)` / click-outside for the outside branch and
  `fireEvent.keyDown(document, { key: "Escape" })` for the Escape branch, wrapped in `act`
  where state updates occur; assert `onDismiss` called exactly for outside/Escape and NOT for
  inside clicks. (`render`/`fireEvent` auto-wrap most updates in `act`; explicit `act` is for
  direct state triggers outside event handlers.)
- C3.4 (versions): `renderHook`/`act` are exported from `@testing-library/react` v16 itself
  (the repo already depends on `^16.0.0`, React 18.3.1) — no additional test package is
  required. `renderHook` requires React ≥ 18 (satisfied); no `legacyRoot` flag needed.

## Contradictions, uncertainty, freshness

- No contradictions between sources: Vitest docs, React docs, and Testing Library docs agree
  within their domains; npm metadata corroborates the version pin.
- Uncertainty U1: the exact built-in default `coverage.exclude` list is version-dependent
  (a broader default list including `**/*.{test,spec}.*`, config files, etc. was observed in a
  secondary source for 4.1.2, not in the primary config reference). Mitigation already baked
  into C1.4: declare excludes explicitly rather than relying on defaults.
- Uncertainty U2: npm showed latest `@vitest/coverage-v8` as 4.1.10 in one listing snapshot and
  4.1.9 in another, but the registry confirms `4.1.11` exists with exact `peerDependencies`
  on `vitest 4.1.11` — the pin `@vitest/coverage-v8@4.1.11` is therefore exact-audited, not
  "latest-chasing".
- Freshness: all sources accessed 2026-09-08. Vitest 4.x docs used throughout (v4 config
  reference + v4 guide); React docs `__branch__v18`-compatible `useContext`/`createContext`
  references (matches repo React 18.3.1); Testing Library v16-era `renderHook` docs.
  Re-validate pins if `vitest` is upgraded (coverage package must track the same version).

## Product choices (non-authoritative, owned by propose/orchestrator)

- PC1: global `thresholds: 100` vs per-glob `{100: true}` vs lower-startup-ramp thresholds
  (`openspec/config.yaml → coverage_threshold: 0` today). Research evidences the mechanism;
  propose decides the number.
- PC2: create `CategoriesContext` vs plain props (exploration: depth is 2 today; context only
  removes the 4-consumer fan-out). Research evidences the canonical pattern either way.
- PC3: `spanishMessages` consolidation, `viewTransitions` extraction, `MaskedPassword` fate,
  folder base Option A/B, delivery strategy (chained PRs). Untouched by this research —
  no claim made.
