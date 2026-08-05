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

**In-dialog chrome rules** (2026-08 drift sweep — these held in v1 bodies and were fixed):
- **Close is on the RIGHT, always** — the stock position. Workspace dialogs with their own
  header band (tasks board, workflows, review) put a `Button variant="ghost" size="icon-sm"`
  with the legacy testid at the band's far right; form dialogs just use the stock built-in
  close (header gets `pr-12` to clear it). A LEFT chevron is a *Back* affordance (automations
  editor) and stays left — only close-X's were drifted.
- Compact band headers (`px-4 py-3 pr-12`) pass `closeButtonClassName="top-1.5"` to
  `DialogContent` — the stock close is positioned for the `p-6` dialog (`top-4`) and sits
  ~10px low in a 44px band otherwise.
- Inputs with no ring utility of their own leak the legacy-bridge keyboard focus ring
  (`input:focus-visible { box-shadow: var(--mf-focus-ring) }`, base layer). v2 inputs with
  `focus-visible:ring-*` override it; ring-less ones (the cmdk palette input) opt out with
  `data-noring`.
- Band titles are `text-base font-semibold` (DialogTitle's scale), counts/chips are `Badge
  variant="secondary"`, and every action that reads as a button IS a v2 `Button` (primary
  default, cancel `outline`, icon actions `ghost icon-sm`).
- Still bridge-styled by design: deep body content (automations editor forms, settings panes,
  board filter bar/segmented switch, file-picker rows) — those convert with their surface
  ports, not chrome passes.

Two Radix rules every dialog outlet must follow (both bit during this pass):
- **Never early-return `null` while open** — unmounting an open modal leaves
  `pointer-events: none` on `<body>`. Render closed (`open={x}`) and let Radix close first.
- **Bridge-resolving buttons `preventDefault()`** the built-in close, or `onOpenChange` fires
  after the click and resolves the bridge a second time.

**Dialog BODIES are converted too** (2026-08-04 sweep — "not just a chrome pass"):
tasks family, setup advisor, review columns, all five settings panes, and the automations
workspace all run on v2 primitives (Input/Textarea/Label/Checkbox/Switch/Select/RadioGroup/
Tabs/Toggle/ToggleGroup/Badge/Alert/Hint/Button). New stock primitives added for it: `tabs`,
`toggle`, `toggle-group`, `switch`, `radio-group`, `alert`. Conventions that came out of it:

- **Segmented one-of-N switches are `Tabs` (List+Trigger only, no TabsContent)** — TasksBoard
  List/Board, automations `SegmentedControl`, ActionCatalog source filter, setup-advisor
  category tabs. In tests Radix `TabsTrigger` activates on **mouse-down, not click** — use
  `fireEvent.mouseDown`. `ToggleGroup type="single"` is for option sets in forms (appearance,
  update channel, quick-task type/priority); guard `if (v) onChange(v)` against deselection.
- **Radix Select can't hold `value=""`** — null-ish choices need a sentinel (`__auto__`,
  `__inherit__`). In jsdom, drive it with `fireEvent.click(trigger)` then click the item
  (setup.ts already shims `hasPointerCapture`/`scrollIntoView`).
- **v2 `Hint`/`Tooltip` need the app-root `TooltipProvider`** (SidebarProvider mounts it);
  unit tests rendering a Hint-bearing component bare must wrap in `@v2` `TooltipProvider` —
  the v1 one is a different context and won't satisfy it. `Hint` keeps v1's empty-label guard.
- **Warning callouts are `Alert` + `border-warning/30 bg-warning/10`** (config conflicts,
  unviewed-files). Chromeless inline inputs stay raw by design: editor title/description,
  chip-draft inputs (OptionsEditor/ConditionRow), menu search fields.
- **Domain palettes stay in the bridge deliberately**: `mf-diff-*` + amber `mf-warning`
  (git/diff family, lives with CmDiffEditor) and `mf-auto-*`/`mf-accent-violet` (automation
  step-kind colors). Generic tokens all map: success, warning, sidebar-selection,
  muted-foreground; `mf-border-hover` → `input`; `mf-content2` → `card`.
- **shadcn-skill sweep applied** (`.claude/skills/shadcn/rules/`): no `space-y-*` (flex+gap),
  `size-*` for equal dims, no size props on icons inside `Button` (the `[&_svg]` rule sizes
  them), semantic tokens only.
- **WKWebView + hidden window wedges Radix exit animations**: with `document.hidden`, the
  0.1s `exit` animation never starts (`pending: true`), so a closed dialog stays mounted at
  `data-state="closed"` until the window is visible again. Environmental, not a bug — don't
  chase it as a close-handler regression; check `document.hidden` first.

## Title bar (2026-08-05 port)

MainToolbar + SurfaceRail + UpdatePill + ToolbarLaunchControls + the whole `features/git` branch
popover family run on v2 primitives; `SHELL_GEOMETRY.toolbar` is deleted (SurfaceHost/InspectorPane
slices remain). Conventions from the pass:

- **`@v2/components/ui/menu-row`** — the dropdown-item recipe as a plain button (`MenuRow` +
  `menuRowClass()`), for menu-shaped panels that are NOT Radix menus (the launch picker with
  nested per-row buttons). Don't rebuild rows ad hoc.
- **The branch popover is a native `DropdownMenu`** (user decision 2026-08-05, replacing the v1
  artboard's side-by-side cards): quick actions are items, sections are Groups whose headers are
  `Collapsible` triggers (non-items — toggling never closes the menu; Remote starts collapsed; an
  active search forces sections open), each branch is a `DropdownMenuSub` whose SubTrigger is the
  row and whose SubContent is the action flyout (destructive variant for deletes). The search
  field lives in the content with `onKeyDown` stopPropagation (except Escape) so typeahead can't
  eat keystrokes. Forms NEVER live inside Radix menus: New Branch / Rename are v2 Dialogs the menu
  hands off to, and an active merge/rebase swaps the menu for the conflict Dialog.
- Menu-item tests: Radix items are divs — assert `aria-disabled`, not `toBeDisabled()`; a bare
  SubContent harness needs `userEvent.setup({ pointerEventsCheck: 0 })` (modal menus set body
  pointer-events:none); SubTriggers open on plain click in jsdom.
- `BranchSelect` is a real v2 `Select` now (same `testId`/`-list`/`-option-*` contract; jsdom tests
  drive it click-trigger → click-option, unchanged).
- **Branch/worktree names are UI sans, never mono** (user decision 2026-08-05, GitHub model):
  popover rows, submenu header, toolbar chip, SessionMetaCard, composer worktree panels, and the
  branch-form inputs. Weight + status dot carry the identifier signal. Mono is reserved for
  hashes, hosts, ports, numeric counts, and keycap hints.
- Segmented surface toggles = `ToggleGroup type="multiple"` on a `bg-muted` pad, active item
  `bg-background shadow-sm`; toggled id = symmetric diff in `onValueChange`.
- Git-family amber (`mf-warning` divergence arrows, worktree glyphs) stays bridge-owned by design;
  the green side moved to v2 `success`.
- Tests: any component rendering a v2 `Hint`/`Tooltip` bare needs the **v2** `TooltipProvider`
  wrapper (`render(ui, { wrapper: TooltipProvider })`) — the v1 provider satisfies nothing.
- **Hint around a Toggle/ToggleGroupItem clobbers `data-state`**: `TooltipTrigger asChild` writes
  the tooltip's open-state ("closed"/"delayed-open") onto the child, so `data-[state=on]:*`
  styling silently never matches. Drive pressed chrome from the state variable
  (`pressed && 'bg-background shadow-sm'`), never from the Radix attribute, on any
  Hint-wrapped toggle. `aria-pressed` survives — assert that in tests.
- v1 `components/ui/menu.tsx` still serves: SurfacePicker, RunTabStrip, composer config-toolbar,
  setup-advisor skills rows. It dies with those ports.

## Known deviations, and why

Recorded so nobody "fixes" them back:

- `SidebarMenuButton`'s `sm` variant is `text-sm`, not stock's `text-xs` — under the v2 scale `text-xs`
  would put every row *name* at 11px.
- `Progress` forwards `value` to the Radix root. Stock destructures it for the indicator transform only,
  which leaves the root `data-state="indeterminate"` with no `aria-valuenow`.
- `SidebarRail` drag-resizes as well as toggling (3px slop separates the gestures).
- A parked section header and its content are **siblings**, never wrapped together — a sticky element
  cannot be lifted above its own containing block, so a wrapper would pin the header below the fold.
