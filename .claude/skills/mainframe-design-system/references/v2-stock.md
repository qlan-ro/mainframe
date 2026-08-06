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
- The legacy-bridge keyboard focus ring applies to **v1 islands only**: its selectors exclude
  `[data-slot]`, which every v2 element carries (Radix menu items are hover-focused divs with
  tabindex, and the un-scoped rule painted the v1 blue ring on them whenever WebKit's
  focus-visible heuristic leaned keyboard). v2 owns its focus treatment via ring utilities;
  `data-noring` remains the opt-out for v1-island elements with their own treatment.
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

- **Menu-shaped = native `DropdownMenu`, no exceptions** (user decision 2026-08-05). A floating
  list of actions/choices is a DropdownMenu; a searchable pick-list is Popover+Command (the
  combobox pattern — palette, VariablePickerButton); only forms, switch panels, and info cards
  are plain Popovers. Nested per-row buttons inside a DropdownMenuItem work: stop propagation on
  pointerdown/pointerup/click (Radix's item pointerup path otherwise treats the button press as a
  row select) and re-enable pointer events on the button. The short-lived `menu-row` primitive is
  deleted — don't reintroduce hand-styled menu rows.
  **Converted so far:** launch picker (ToolbarLaunchControls), branch menu (BranchPopover), the
  Run tab strip's `+` add menu, the automations add-trigger menu (WhenCard), the skills
  install-scope menu (SkillAction), the automations TokenPicker (Group + Label per source), and
  the composer's ProviderModelSelect.
  **Not converted, by inspection:** the workspace's empty-state card (now
  `layout/WorkspaceEmptyState.tsx`) is not a float — it is always visible, with no trigger, so a
  DropdownMenu would mean inventing one and hiding the content behind a click. It converted with
  the surface port below and stays a `Card` of ghost-Button rows.
- **`components/ui/menu.tsx` survives** the title-bar and menu sweeps. Remaining consumers:
  the composer worktree family — WorktreePopover,
  WorktreeDraftPanel, WorktreeExistingTab — and setup-advisor's InstallBand (`MenuRow`). It dies
  with those ports. `menu-variants.ts` outlives it either way: v1 `popover.tsx`,
  `dropdown-menu.tsx` and `context-menu.tsx` all compose it.
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
- **Radix gates opening on the TRIGGER's own `disabled`.** `DropdownMenuTrigger asChild` around a
  disabled `<button>` still opens on pointerdown — the child's `disabled` isn't consulted. Pass
  `disabled` to the trigger too, or an inert control opens its menu (caught in ProviderModelSelect).
- **In jsdom a submenu closes the moment the pointer leaves its SubTrigger.** Radix's grace-area
  polygon is computed from `getBoundingClientRect`, which is all zeros there, so `userEvent.click`
  on a SubContent item moves the pointer, closes the flyout, and the click lands on nothing. Open
  the flyout with `user.hover(subTrigger)`, then drive the items with `fireEvent.click` — it
  dispatches no pointer movement. Real browsers (Playwright) are unaffected.
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
- **The composer's effort chip and features gear are retired** (user decision 2026-08-05, the
  Cursor pattern). Effort and per-model options live in each model row's `DropdownMenuSub` flyout
  inside the model menu: click the row to choose the model, hover for its tuning. `EffortPicker`
  and `FeaturesPopover` are deleted; `composer-effort-select*` / `composer-features-trigger` /
  `composer-feature-*` are gone, replaced by `composer-model-<id>-effort-<level>` and
  `composer-model-<id>-feature-<key>`. A NON-active model's flyout previews that model's
  resolved defaults, and touching a control switches to the model WITH that tuning — one
  compound `setModelTuning(model, tuning)` write whose single guarded closure issues the config
  PATCH and the tuning PATCH together (`useTuningWarning` parks one closure, so a compound
  change must travel as one `guard()` call, never two).
  **Known cost:** the effective effort and the ultracode lock are no longer visible without
  opening the menu.

## Workspace surface (2026-08-05 merge + port)

The Files and Run surfaces became **one** `WorkspaceSurface`, and its chrome is v2. `SurfaceId` is
now `'chat' | 'workspace'` — there is no `files` or `run` id, component, store or drop target.
Conventions from the pass:

- **A closeable tab strip is NOT Radix `Tabs`.** `TabsTrigger` renders a `<button>`, so a per-tab
  close or stop inside it would nest buttons. The strip stays `div[role=tab]` pills carrying v2
  Buttons, and borrows Tabs' *vocabulary* only (resting `text-muted-foreground`, active
  `bg-muted text-foreground`). Radix `Tabs` remains right for segmented one-of-N switches.
- **`Button` gained `icon-2xs`** (16px, 12px glyph) for an affordance nested INSIDE another control
  — the tab pill's close and stop, where `icon-xs`'s 24px equals the 24px pill. Add the scale step;
  don't override `icon-xs` per call site.
- **A tab glyph carries TYPE by shape and STATE by ink.** Eight kinds (eye/globe/square-terminal/
  terminal/code/git-compare/file) each with their own hue did not survive having one strip, so the
  per-kind tints (`mf-term-cyan`, `mf-surface-run`, `mf-accent-amber`) are gone: active =
  `text-foreground`, inactive = `text-muted-foreground`. `mf-surface-files` and `mf-shadow-picker`
  died with this pass; **`mf-surface-run` survives via `ToolbarLaunchControls` only.**
- **The strip's two ends live in `WorkspaceStripChrome`** (grip + surface glyph; split/close
  cluster) with a shared `STRIP_ROW` height, because the empty-state header is the same row without
  a pane. The near-copy the merge inherited is what made this necessary — don't re-inline it.
- Geometry keeps v1's density on the v2 scale: strip `h-9` (36px), tab pill `h-6` (24px), tab titles
  `text-xs` (11px — same rung as the toolbar chip directly above), icon buttons 24px/12px glyph.
- Pick-list surfaces are `w-72` / `max-h-72`, matching `popover.tsx` and `command.tsx`.
- Tests: every suite that renders the strip, a pill or the surface bare needs the **v2**
  `TooltipProvider` wrapper — the pills are full of `Hint`s. Shadowing `render` with
  `rtlRender(ui, { wrapper: TooltipProvider })` beats threading the option through 15 call sites.

**Surface placement is deliberately NOT redesigned.** `layout-placement.ts` still carries the
three-slot algebra (top row of 1–2 + a bottom strip + flex) it had for three surfaces. Multi-session
side-by-side chat is a future decision; leave the shape alone until it is taken.

### Tab-body chrome (2026-08-05, second pass)

The strip was v2; the tab BODIES were still v1. Converted: `features/editor` (EditorTab/DiffTab
states, DiffHeader, SaveStatusChip, editor-banners, EditorContextMenu, references-panel,
InlineCommentWidget, the submit-review bar), `features/viewers` (ViewerShell, Segmented, Image/Svg/
Pdf/Csv/Unsupported, viewer-router), `features/preview` + `features/url-tab` (toolbars, url bar,
device toggle, run control, capture cluster, body states, CaptureAnnotationPopover), and
`features/run/ConsolePane`. Conventions from the pass:

- **`Segmented` is the Tabs recipe now**, so all three viewer toggles (Preview/Source, Fit/100%,
  Preview/Code) and `PreviewDeviceToggle` share it. It compacts the 36px `TabsList` to 24px by
  re-declaring **the primitive's own group modifier** — `group-data-horizontal/tabs:h-6`, not a bare
  `h-6`, which would stack instead of replace. tailwind-merge only dedupes classes whose modifier
  sets match; verified against `twMerge` directly rather than by eye. Same trick sizes `InputGroup`
  (`h-7`) and `Toggle` (`size-6 min-w-6 p-0`).
- **No `Hint` on a labelled segment.** `Segmented` lost its per-option tooltip: every call site had
  a visible label, so the tooltip only repeated it — and `TooltipTrigger asChild` would have
  clobbered `TabsTrigger`'s `data-state`, silently killing the active-segment fill. The unused
  `title` prop went with it. The same rule drove the capture cluster's Inspect/Region `Toggle`s to
  carry `pressed && …` chrome instead of `data-[state=on]:*`.
- **`PreviewIconButton` is deleted.** Its 7 call sites are `Hint` + `Button variant="ghost"
  size="icon-xs"`, except the two that toggle, which are `Toggle`s. The reason it existed —
  "`Button` hard-codes `[&_svg]:size-4`" — stopped being true when `icon-xs` gained its own
  `size-3`.
- **The preview address bar is `InputGroup` + `InputGroupAddon` + `InputGroupButton`**, per the
  shadcn rule that buttons inside an input are never absolutely positioned. Its invalid state is
  `aria-invalid` on the control (the group styles itself off it) — the old `ring-destructive` class
  assertion became `toHaveAttribute('aria-invalid', 'true')`.
- Bands are `bg-muted` (ViewerShell header/footer, ReadOnlyBanner) or `bg-card` (DiffHeader,
  submit-review, ConsolePane); chips are `Badge variant="secondary"` (SaveStatusChip, the console's
  log count) with the semantic hue on a dot, never on the label.
- ViewerShell's header went 24px → **`h-7`**: an `icon-xs` Button and a 24px segmented control both
  sit in it, and 24px left them flush to the band. Footer stays `h-5`. The preview/url-tab toolbars
  went 38px → **`h-9`**, matching the strip above them.
- **`viewer-checker.ts` was dead** while ImageViewer inlined a copy of it and SvgViewer used a
  *conic* gradient the helper's own docstring forbids ("both viewers must read identically"). Both
  route through `checkerStyle` now.
- Left v1 **by design**: `MarkdownPreview` (prose + `mf-code-*`/`mf-content2`/`mf-raised` content
  palette), `cm-setup.ts` (`mf-cm-*`/`mf-code-*` CodeMirror theme), `CmDiffEditor` + DiffHeader's
  ±N counts (`mf-diff-*`), `terminal-cache.ts` (`mf-term-*`), `mf-viewer-check-a/b` +
  `mf-viewer-matte`, and `ToolbarLaunchControls`' `mf-surface-run`.
- **Bridge shrank by two tokens:** `--mf-shadow-segment` (last consumer was `Segmented`) and
  `--mf-tab-bar` + its `@theme` mapping (last consumers were ViewerShell and ReadOnlyBanner).
  `--mf-auto-kind-parallel` is *also* consumerless but predates this pass and belongs to the
  deliberately bridge-owned automations step-kind palette — left alone.
- Tests: every suite rendering a viewer, the preview toolbar, or the url-tab needs the **v2**
  `TooltipProvider`; where a suite already passes its own `wrapper`, compose the provider INTO that
  wrapper — a `render` shim's default `wrapper` is overwritten by an explicit one, not merged.
  `TabsTrigger` interactions are `fireEvent.mouseDown`, not `click`.

## Toasts (2026-08-05 port)

Native sonner via the v2 `Toaster` (mounted once in App). **`mfToast` from `@/lib/toast` remains
the only raise API** — it owns the type→policy table (error/permission persist with a close
button; success/info/warning auto-dismiss; permission renders as a warning toast) and the
`chatId` → "Open session" CTA. The v1 `WsToastCard` and v1 sonner wrapper are deleted.
**Abstract failures carry a `details` option** (stack, stderr, response body): the toast grows a
Details button that opens `ToastDetailsHost` (v2 Dialog at the app root, monospace copyable
payload via the `toast-details` store). Prefer `mfToast.error(title, { description, details })`
over stuffing payloads into the toast body.

## Chat surface (2026-08-06 port)

**Layering rule (user decision):** aui owns state and behavior, shadcn owns pixels, and aui's *styled*
registry components contribute nothing visual. Where both libraries have "the same" component it is
behavior-vs-look — compose them.

**The chat kit lives in the v2 registry:** `message` (MessageGroup/Message/MessageAvatar/Content/Header/
Footer), `bubble` (7 variants + BubbleContent/BubbleReactions), `attachment` (the whole compound, states
idle→done), `marker` (default/separator/border). Hand-added from
`https://ui.shadcn.com/r/styles/radix-vega/<name>.json` — never `pnpm dlx shadcn add`, which churns the
lockfile. Three upstream classes were dropped as phantom-or-wrong here and the reasons live in the files:
`scroll-fade-b` (a mask fades a sticky child along with the content), the `scrollbar-*` family (app.css
paints ONE global thin scrollbar; `[scrollbar-width:none]` is the opt-out idiom), and `shimmer` (a bridge
class, and no attachment of ours has an upload state). `AttachmentGroup`'s `scroll-fade-x` went too: an
unconditional both-ends ramp eats items that fit, and the app's other horizontal rails (tab strips) clip.

### MessageScroller spike — VERDICT: fallback taken, aui's Viewport stays

`@shadcn/react`'s `MessageScroller` was spiked against today's `ThreadPrimitive.Viewport` (aui autoscroll
off, `ThreadPrimitive.Messages` inside `MessageScrollerViewport`/`Content`, one `MessageScrollerItem` per
message id). **Both passed all four exercised behaviors** — streamed follow, scroll-away release,
full-list history re-seed without a jump, jump-to-bottom — so nothing functional forced the choice. The
kit primitive and the `@shadcn/react` dependency were **removed again**; carrying an unused primitive on a
four-hour-old dependency is a leftover. Four reasons, in order of weight:

- **The kit scroller has no footer-inset concept.** Measured: its footer is necessarily a flex sibling
  *outside* the scroll region (viewport `clientHeight` 604 of a 700px window), while aui's
  `ViewportFooter` sits *inside* it, sticky, with its height measured into the scroll inset (`clientHeight`
  700). Adopting the kit means moving the composer out of the scroll region — messages would stop scrolling
  under it. That is a composer layout change, and the composer's config toolbar is explicitly not to be
  touched.
- **aui's viewport is not the dumb stick-to-bottom the port assumed.** 0.14.27 already ships
  `turnAnchor="top"` + `topAnchorMessageClamp` — the same anchor-the-user-turn-to-the-top model that is the
  kit scroller's distinguishing feature. The premise that this was "the one real collision" did not hold.
- **Feeding the kit needs two more unstable aui APIs.** `MessageScrollerItem` throws outside a
  `MessageScrollerProvider` and must be a DIRECT child of `Content` (the primitive reads
  `content.children` for `data-message-id`), so it cannot be the role components' root without also
  breaking subagent transcripts, which reuse `boundedMessageComponents`. The working shape was
  `unstable_useThreadMessageIds` + `ThreadPrimitive.Unstable_MessageById`, on top of the deprecated-hook
  debt already tracked in `packages/ui/CLAUDE.md`.
- **`@shadcn/react@0.3.0` is days old, sub-1.0, four versions ever**, and would own the most
  behavior-critical mechanism on the surface — while aui is already pinned exactly, already owns thread
  state, and its viewport is already wired to `thread.runStart`, `threadListItem.switchedTo`,
  `useOnScrollToBottom` and `isAtBottom`, all of which would need re-bridging.

Two facts worth keeping from the spike: aui's content observer **ignores `style` attribute mutations** by
design (`useOnResizeContent`), so a footer that grows by autosize alone does not re-pin — growth by node
insertion does; and any measurement of that path must add a node, or it measures the wrong thing. And the
kit's per-item `[content-visibility:auto] [contain-intrinsic-size:auto_10rem]` is plain CSS — it can be
applied to aui message rows on its own merits, without the scroller.

## Known deviations, and why

Recorded so nobody "fixes" them back:

- `SidebarMenuButton`'s `sm` variant is `text-sm`, not stock's `text-xs` — under the v2 scale `text-xs`
  would put every row *name* at 11px.
- `Progress` forwards `value` to the Radix root. Stock destructures it for the indicator transform only,
  which leaves the root `data-state="indeterminate"` with no `aria-valuenow`.
- `SidebarRail` drag-resizes as well as toggling (3px slop separates the gestures).
- A parked section header and its content are **siblings**, never wrapped together — a sticky element
  cannot be lifted above its own containing block, so a wrapper would pin the header below the fold.
