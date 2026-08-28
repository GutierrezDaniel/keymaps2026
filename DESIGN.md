# Design — Keymaps2026 (vault UI)

<!-- impeccable:design-schema 1 -->

Visual world: **Cuaderno de Códigos** (spy codebook). Direction contract seed
key `326d7c1c`; see the contract comment in `src/ui/index.html`. Mode:
**Operate** — daily unlock/find/copy/lock. This record is written from the
built world (finish documentation), not from an intent before it.

## Identity

The vault is a classified codebook: cream security paper, ink, fountain-pen
blue, and classified-red rubber stamps. The irreversible master-password
contract is the product, so it is communicated as a physical seal, never as a
generic banner. The product is named **Clavemaestra** (the master key); the
visual identity is built around that name and its key mark.

## Color

| Role | Token | Value | Use |
|---|---|---|---|
| Paper | `--paper` | `#f4ecd8` | Ground |
| Raised paper | `--paper-raised` | `#fbf6e8` | Sheets, cards, modals |
| Deep paper | `--paper-deep` | `#ece1c6` | Hover wells, selected options |
| Ink | `--ink` | `#1c2333` | Body text, primary buttons |
| Muted ink | `--ink-muted` | `#5a5446` | Secondary text |
| Faint ink | `--ink-faint` | `#6e6755` | Borders, chevrons |
| Classified red | `--red` / `--red-deep` | `#ad3a2d` / `#8c2f24` | Warnings, danger, stamps |
| Red wash | `--red-paper` | `#f6e4dc` | Stamp backgrounds |
| Quiet red | `--red-quiet` | `#8f4a3c` | Locked-screen note |
| Fountain blue | `--blue` / `--blue-deep` | `#2f5d8c` / `#26496e` | Selection, category "trabajo" |
| Stamp green | `--green` | `#2f6b3f` | "Copiado" seal, category "estudio" |
| Gold | `--gold` / `--gold-deep` | `#86601f` / `#6e4d18` | Labels, icons (except danger) |
| Line | `--line` | `#cbc0a4` | Hairlines |

Category ink chips: `trabajo` blue, `estudio` green, `entretenimiento` amber
`#7a5220`, `servicios` violet `#6a4a8f`. All text pairs verified ≥ 4.5:1.

## Type

- Display / letterhead: **Libre Caslon Text** (400/700), self-hosted.
- Codes, secrets, labels, microprint: **IBM Plex Mono** (400/500), self-hosted.
- Body / UI: system-ui stack.
- No emoji or unicode glyphs as icons: icons are drawn from `lucide-react`
  with one consistent stroke weight, `aria-label` in Spanish.

## Material & motion

- Paper grain via fixed radial gradients; letterhead double rule (3px double
  ink) under titles; rubber-stamp seals (2px red border + dashed outline,
  slight rotation) for warnings, backoff and the create screen's loss warning.
- "The system breathes": exponential ease-out entrances (`breathe-in`,
  `card-enter`), the details modal flips in with perspective (`modal-flip-in`),
  cards lift on hover, deleted cards leave with `card-leave` before the list
  refresh. All motion disabled under `prefers-reduced-motion`.
- Cinematic View Transitions where the API exists (feature-detected, CSS
  fallback otherwise): unlock folds the locked sheet away and the vault rises
  (`sheet-fold-away` / `sheet-rise-in`); lock reverses the fold; the details
  modal morphs from the card that opened it and back (`view-transition-name:
  card-modal` shared between the origin card and the sheet).

## Components

- **Locked / create screens**: cream sheet with double-rule top; the master
  password is a signature line (bottom-border only); the locked-screen warning
  is a quiet muted-red note below the input; the create-screen warning is a
  prominent red stamp.
- **Vault header**: "Mi bóveda" letterhead, `Nueva entrada` ink stamp, lock as
  an icon button.
- **Filters**: site searchbox with search icon; category and email filters are
  icon-triggered listbox dropdowns (email uses the `@` glyph icon); the active
  filter shows a gold dot. WebKit/GTK `appearance: none` fix preserved.
- **Entry cards**: summary only — site name, category as a colored top chip
  (square top corners, rounded bottom), whole card opens the details modal.
- **Entry modal** (unified create/view/edit): one wide horizontal sheet —
  two-column grid so all six fields fit without scrolling. Six Spanish labels;
  password has a reveal/hide toggle; copy icons only for link, password,
  email, username of an existing entry; delete icon only for existing entries;
  Guardar/Cancelar actions. Fields reset on every open. The category picker is
  a custom themed listbox (a native `<select>` dropdown is painted by the OS
  white in WebKit/GTK, so the sheet draws its own paper+ink options). The
  modal closes itself when its entry is deleted.
- **Delete confirm**: Spanish alertdialog "Esta acción no se puede deshacer."
- **Backoff**: red stamp countdown.

## Accessibility

Spanish-neutral copy everywhere; `role` + `aria-label` on all icon controls;
focus-visible rings in gold (matching labels/icons); contrast floor 4.5:1;
reduced-motion support; keyboard reachable cards and dropdowns.