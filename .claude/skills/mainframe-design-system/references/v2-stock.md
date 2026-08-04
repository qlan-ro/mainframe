# The v2 tree — stock shadcn, not warm chrome

`packages/ui/src/v2` started as a **parallel clone** of the sidebar/shell rebuilt on the shadcn
**radix-vega** preset. Since the 2026-08 shell integration it is **the main app's design system**: the
`index.html` entry styles itself with `src/styles/app.css`, which imports the v2 token layer plus
`legacy-bridge.css` (the `--mf-*` vars, `mf-*` mappings, v1 type rungs and keyframes the un-ported v1
areas still speak). Everything in `SKILL.md` about `mf-*` tokens, window styles and the 8-rung type scale
describes those **legacy islands only**; the compressed spacing scale is gone entirely.

The v2 tokens live in `packages/ui/src/v2/styles/globals.css` (kept preset-pure — app/host concerns go in
`app.css`, legacy compat in `legacy-bridge.css`).

## Boundaries

- **Never import `@/components/ui/*` into v2.** v2 has its own primitives under `src/v2/components/ui/`.
  (A v2 file may mount a whole *legacy island component* — `AppShell` does, and `DaemonSwitcher` mounts
  the v1 `AddRemoteDialog` — but never mix v1 primitives into v2 markup.)
- **Non-visual modules are imported, not cloned** — `view-model/`, `store/`, `runtime/`, `lib/api/*`,
  feature hooks all come from `@/…`. Only the render layer is duplicated.
- **Never edit a shared module to change a v2 look.** `view-model/relative-time.ts` has ten consumers
  across v1 sessions *and* automations; a v2 label style belongs in a v2-local file
  (`features/sessions/compact-time.ts` is the precedent).
- Seams outside `src/v2`: the `@v2` alias (`vite.config.ts` / `tsconfig.json` / `vitest.config.ts`),
  `src/styles/app.css` + `legacy-bridge.css`, `src/app/AppShell.tsx` (mounts the v2 shell), and the
  dev-only `v2.html` lab. Each area port should shrink the bridge; its death is the port's done-signal.

## Scales

| | v1 (warm chrome) | v2 (stock) |
|---|---|---|
| Spacing | **compressed** — `p-2` is 4px | **standard** — `p-2` is 8px |
| Type | 8 named rungs (`text-body` …) | Tailwind names, **desktop values**: `text-xs` **11px/16**, `text-sm` **13px/18**, `text-base` 16px |
| Radius | `--radius` 8px base, `mf` names | `--radius` 0.625rem, stock `rounded-*` |
| Color | ~90 `mf-*` extensions | shadcn contract only, **plus three additions below** |

`text-sm` is the UI size — a row name, a card title, a dialog's body. `text-xs` is metadata: timestamps,
field labels, the session row's second line. **`body` carries `text-sm`**, so unsized text lands on 13px
rather than the browser's 16px; that rule exists because the hover card shipped at 16px without it.

`mf-*` class names are **phantom** here — they compile to nothing, silently.

## Tokens beyond the preset

Three, each because the preset had no way to say the thing:

- `--sidebar-selection` — stock's `sidebar-accent` is the neutral hover, so hovered and selected rows
  would otherwise be identical.
- `--warning` — `color-mix(destructive 55%, muted-foreground)`. A wrong-but-not-broken state (a missing
  worktree). Sits at the panel's own ink lightness, so it carries hue without shouting.
- `--success` — green, for a connection indicator. The one hue here that is convention rather than
  choice; the accent would have said "selected".

`--ring` is `var(--primary)`, so focus rings are the accent everywhere.

`--font-mono` ("SF Mono", ui-monospace, …) is also first-class in the v2 sheet — v2 markup uses
`font-mono`, so it cannot live in the bridge. Several bridge tokens are now **aliases** onto v2 tokens
(`--mf-text-3` → `muted-foreground`, `--mf-chip` → `accent`, `--mf-selection` → `sidebar-selection`,
`--mf-success` → `success`), so legacy islands track the shell; `--mf-warning` deliberately stays amber
(caution ≠ v2's wrong-but-not-broken red).

## Ink

`foreground` is `oklch(0.32)` light / `0.92` dark — deliberately off stock's `0.145`/`0.985`. Stock assumes
body copy on a white page; every v2 surface is chrome, and full-strength ink there reads as a different,
louder application.

**A tooltip inverts `foreground` into a fill** (`bg-foreground text-background`). Any change to the ink
token changes a background — check tooltips before touching it.

## Recipes that differ from v1

| Surface | v1 | v2 |
|---|---|---|
| Large dialog | `hideClose` + `p-0 gap-0` + bordered bands | **stock composition** — close button, `DialogHeader` with a `DialogDescription`, `DialogFooter`, the primitive's own `p-6 gap-6`, whole dialog scrolls |
| Cancel button | — | `variant="outline"` inside `DialogClose asChild` |
| Sidebar scrolling | — | `SidebarContent` **is** the scroller, as shadcn documents. No nested `ScrollArea`; shadcn's sidebar has no visible scrollbar by design |
| Overflowing label | `truncate` | `truncate-fade` — a `mask-image` ramp instead of an ellipsis. **Only on a label that fills its row**; on a content-sized one the ramp eats text that fits |

## Dialog ledger (2026-08 pass)

Every dialog in the app was audited; state as of the shell integration:

- **v2-native:** pairing (AddRemoteDialog + steps + InputOTP), DirectoryPickerModal,
  ArchiveWorktreeDialog, ConfirmDialog (alert-dialog recipe → GitConfirm, TuningWarning),
  DaemonSmallDialog, TaskEditModal (sidebar), ArchivedSessions/ImportSessions,
  SpotlightPalette + FindInPathModal (both on the stock cmdk `Command` engine,
  `shouldFilter={false}` — the daemon does the matching; v1 `command.tsx` is gone and
  automations' VariablePickerButton uses the v2 one).
- **v2 shell, legacy body** (chrome converted, panes port with their surface): SettingsDialog,
  TasksModalHost (board) + TaskEditModal (board) + QuickTaskDialog, FilePickerDialog,
  SetupAdvisorHost, ReviewPanel (fixed columns as in v1 — resizable panels land with the review
  surface port), AutomationsHost (Radix replaces the hand-rolled overlay: focus trap, scroll
  lock, Escape; autofocus is suppressed there — the first focusable is a Hint-wrapped button
  whose focus-opened tooltip would eat the first Escape).
- **Bare-frame Dialog variant** (panel chrome stripped; the image is the dialog): the chat
  lightboxes + the aui attachment preview.
- **ConnectionOverlay** stays a bespoke non-dialog window-state overlay by design (renders
  before providers, never dismissable, above every Radix layer) — rebuilt on v2 tokens with
  the stock indeterminate `Progress` (no `value` → Radix's indeterminate state).

**The v1 dialog primitive is deleted.** Every modal in the app renders through
`@v2/components/ui/dialog` / `alert-dialog` / `command`.

Two Radix rules every dialog outlet must follow (both bit during this pass):
- **Never early-return `null` while open** — unmounting an open modal leaves
  `pointer-events: none` on `<body>`. Render closed (`open={x}`) and let Radix close first.
- **Bridge-resolving buttons `preventDefault()`** the built-in close, or `onOpenChange` fires
  after the click and resolves the bridge a second time.

## Known deviations, and why

Recorded so nobody "fixes" them back:

- `SidebarMenuButton`'s `sm` variant is `text-sm`, not stock's `text-xs` — under the v2 scale `text-xs`
  would put every row *name* at 11px.
- `Progress` forwards `value` to the Radix root. Stock destructures it for the indicator transform only,
  which leaves the root `data-state="indeterminate"` with no `aria-valuenow`.
- `SidebarRail` drag-resizes as well as toggling (3px slop separates the gestures).
- A parked section header and its content are **siblings**, never wrapped together — a sticky element
  cannot be lifted above its own containing block, so a wrapper would pin the header below the fold.
