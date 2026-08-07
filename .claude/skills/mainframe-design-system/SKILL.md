---
name: mainframe-design-system
description: Mainframe's own design system — the token scales (type, radius, spacing, color), the dialog/popover/row recipes the app already uses, and the layout traps that make new UI look off. Covers BOTH render trees in packages/ui: v1's warm chrome and the stock shadcn v2 clone, which have different scales and inverted recipes. Use before building or restyling ANY component in packages/ui, and when reviewing UI for design conformance. Generic design skills (ui-ux-pro-max, apple-hig) answer "what looks good"; this answers "what looks like Mainframe".
---

# Mainframe design system

`packages/ui` is Tailwind **v4** + shadcn/ui on a hand-built warm-chrome theme. Every scale is defined once
in `packages/ui/src/styles/globals.css` under `@theme inline` (~line 793). Nothing here is invented — it is
what the shipped app already does.

**Before writing any markup: find the closest existing component and read it.** This app has a house style,
and the fastest way to violate it is to write generic shadcn from memory.

## First: which tree are you in?

`packages/ui` holds **two** render trees with different design systems — and since the 2026-08 shell
integration, **the main app runs on the v2 token layer**. The v2 sidebar/shell is the chrome; the
un-ported v1 areas render inside it as *legacy islands* kept alive by `src/styles/legacy-bridge.css`.

- **`src/v2/…` and new work** — the stock shadcn **radix-vega** preset. Standard Tailwind spacing, its own
  11/13px type scale (`text-sm` = 13px), and dialog/scroll recipes that are the **opposite** of v1's.
  **Read `references/v2-stock.md` first** — the Recipes table below will actively mislead you.
- **`src/…` legacy islands (v1, warm chrome)** — the sections below describe these. They still speak
  `mf-*` and the 8-rung type scale, resolved by the bridge, but sit on standard spacing and the v2 palette
  now. When you port one, delete its slice of the bridge; don't add new `mf-*` usage anywhere.

Check the path before you write a class name.

## Reach for the component before you write the markup

The four most repeated mistakes in this codebase are all the same mistake: building something the library
already has.

1. **Search `components/ui/` before writing markup that resembles a primitive.** A pill is `Badge`. A
   bordered container is `Card`. A bar showing a percentage is `Progress`. Hand-rolled versions have shipped
   for all three, each a near-copy of the primitive's own base classes minus its focus ring and aria.
2. **If a primitive doesn't expose what you need, extend the primitive.** You own that file — that is the
   shadcn model. Importing raw Radix at a call site to reach an inner element is the tell that a prop is
   missing (a `viewportProps` on `ScrollArea`, say). A feature importing `radix-ui` directly is a bug.
3. **A stack of overrides on a primitive means you picked the wrong one, or the decision belongs in the
   theme.** Five call sites overriding `text-muted-foreground` to escape a too-loud `foreground` is a token
   problem, not five styling problems. Stripping `p-0 gap-0` off a dialog to rebuild its bands is a
   different component.
4. **Never an arbitrary value where a token could exist.** `text-[10px]` and `text-[11px]` reached eight
   usages across six files before anyone noticed; no theme change could reach them. If the scale lacks the
   step you need, add the step.

## Ink is a scale, not a colour picker

- **One role, one ink.** The same *thing* — a session's name in a row, that same name as a hover-card title
  — must resolve to one token. Two inks for one role is what makes a popover read as a different app.
- **Check what else the token fills.** `foreground` is a tooltip's *background* (`bg-foreground`), so
  "make the text softer" silently restyles every tooltip.
- **A missing semantic gets a token, not the nearest hue.** Reaching for `destructive` to mean "warning",
  or `primary` to mean "connected", encodes the wrong meaning permanently. Add `--warning` / `--success`.
- **A comment that explains a token's behaviour goes stale when the token moves.** Fix it in the same pass;
  a confidently wrong comment costs more than none.

## The five rules that catch most of it

1. **Every text node takes an explicit type rung.** There is no default. Unstyled text inherits the 13px
   body size and silently sits at the wrong rung next to its siblings.
2. **Every color is a token, and the ink tier is load-bearing.** No raw hex, no `bg-slate-800`, no
   `shadow-2xl`. `foreground` and `muted-foreground` are the safe text inks;
   **`mf-text-4` is ornament and never text**. Never stack `opacity-*` on an ink token, and keep
   semantic hues (success/warning/priority) on the icon or tint background rather than the text. A
   contrast test enforces this — see `references/tokens.md`.
3. **`truncate` inside a flex row needs `min-w-0` on the shrinkable item.** `min-width: auto` is the flex
   default, so the item refuses to shrink below its content and blows the row out instead of truncating.
   This is the single most common visual break in this codebase.
4. **A panel's height comes from its container's flex column, never from a magic `max-h-[380px]`.**
   `flex flex-col` + `max-h-[85vh]` on the shell, `flex-1 min-h-0 overflow-y-auto` on the scrolling body.
5. **Every interactive element gets `data-testid="<surface>-<element>"`**, kebab-case, keyed by domain id —
   not array index. `components/ui/` primitives stay passthrough.

## Scales

Full tables with every token name: `references/tokens.md`. The shape of them:

- **Type — 6 rungs, 10→17px**, each with paired leading: `text-micro` 10 · `text-caption` 11 · `text-label` 12
  · `text-body` 13 · `text-heading` 15 · `text-title` 17. Chrome density is deliberately tight;
  `text-body` is the baseline, `text-heading` is a dialog title. (`text-display`/`text-hero` retired
  with the v2 shell — welcome/empty-state moments are v2 surfaces now.)
- **Weight rises with the rung.** `text-heading` and above is `font-bold`; below that, medium and
  semibold are both live (semibold for row titles and active state, medium for secondary). `font-normal`
  is effectively unused — muted text gets a muted *color*, not a lighter weight — and `font-extrabold`
  appears once, on the brand mark.
- **Spacing — integer steps are COMPRESSED**: `p-2` is 4px, not 8px (`--spacing-1: 2px` … `--spacing-12: 64px`).
  Fractional steps (`p-1.5`, `py-2.5`) are standard Tailwind. Getting this wrong is why ported UI reads
  twice as airy as the app around it.
- **Radius — `rounded-xs` 4 · `sm` 6 · `md` 8 (base) · `lg` 11 · `xl` 13.** Chips and small controls sit at
  6–7px, cards at 8–11px, modals at 13px.
- **Color — shadcn contract (`background`/`foreground`/`card`/`popover`/`primary`/`muted`/`accent`/`border`/…)
  plus ~90 `mf-*` extensions.** `accent` is the HOVER surface, not the brand — brand is `primary`.
  Three schemes (classic/ocean/velvet) × light/dark all resolve through the same names, so a token is the
  only way to stay correct in all six.
- **Window style is a third axis** — `unified` · `split` · `glass` change panel radius, fill, shadow, and
  gutter. Never give a feature component its own panel chrome; the shell owns it via
  `lib/appearance/window-style.ts`. Style the inside of your surface, not its outer edge.

### Three traps worth knowing

- **Integer `size-N` on an SVG is a bug.** The spacing scale is compressed, so `size-3` renders 6px and
  `size-4` renders 8px. Use `size-3.5` (14px), `size-[12px]`, or lucide's `size={12}`. Meaningful glyphs
  sit on a 12/14/16 grid. This shipped app-wide once already — every Button rendered 8px icons.

- **Phantom tokens fail silently.** `mf-*` names only exist if mapped under `@theme inline`. A typo renders
  as *nothing* — no error, no warning. Grep `globals.css` for the exact `--color-mf-…` line before using one.
- **The `/opacity` modifier DOES work here.** 112 shipped uses (`bg-primary/10`, `border-destructive/30`).
  Tailwind v4 compiles it to `color-mix`, which handles the hex/rgba token values fine. Any "never use
  `/opacity` on CSS-var colors" guidance you meet is a carryover from the Tailwind-v3 `packages/app-electron`
  and does not apply here. One real caveat: `accent`, `border`, and `input` are *already* alpha
  colors, so a modifier on those compounds toward invisible.

## Recipes

Copy the structure from the named file — do not re-derive it. Details in `references/recipes.md`.
**These are v1's.** In `src/v2` the dialog and scroll recipes invert — see `references/v2-stock.md`.

| Surface | Canonical implementation |
|---|---|
| Large panel dialog | `features/tasks/TaskEditModal.tsx` — `hideClose` + `flex flex-col p-0 gap-0 max-h-[90vh]`, bordered `DialogHeader`, scrolling body, action footer |
| Simple list dialog | `features/sessions/sidebar/ArchivedSessionsDialog.tsx` — default padding, visible `DialogTitle`, `ScrollArea` |
| Confirm | `components/ui/confirm-dialog.tsx` |
| Menu / popover | `@v2/components/ui/dropdown-menu` — a floating list of actions is ALWAYS a DropdownMenu; see `features/git/BranchPopover.tsx` |
| Toolbar icon button | `layout/MainToolbar.tsx` `ICON_BTN` — 24×28, `rounded-[6px]`, `hover:bg-accent` |
| Section header / eyebrow | `components/ui/section-header.tsx` — sentence-case `text-xs font-medium text-muted-foreground`. Never hand-roll `text-micro font-bold uppercase` |
| Count / badge | `components/ui/count-badge.tsx` — capsule-less gray numeral by default; `alert` is the only filled variant |
| Toast | `mfToast` from `@/lib/toast` — **not** sonner directly |

Dialog defaults you inherit from `components/ui/dialog.tsx` and must not restate: `rounded-xl`,
`border border-border`, `bg-popover`, `shadow-[var(--mf-shadow-modal)]`, the scrim, the open/close animation.
Re-declaring them is dead class weight; overriding them with raw Tailwind (`shadow-2xl`, `bg-card`) breaks
the app's material language.

## A dialog needs an exit

`hideClose` is legitimate — but only when the dialog supplies its own: a footer action row, or a header
close button. A `hideClose` dialog with neither leaves Escape as the sole exit. Check which you have before
reaching for the prop.

## Build the whole state matrix, and only the real states

Two rules carried over from the design prototype, where every component is specified as a grid of states
rather than one happy path.

**Enumerate the states before you write the markup.** For anything with more than one, that means: empty ·
loading · error · populated · resolved; one item vs many; a short string vs one that has to clamp;
disabled and running variants of every control. A component built for the populated case and patched
afterwards is how a panel ends up with a magic `max-h` and an unstyled error branch.

**Don't design an affordance for data that doesn't exist.** Before adding a field, a badge, or an elapsed
timer, confirm the type in `@qlan-ro/mainframe-types` (or the daemon route) actually carries it. Sessions
have exactly three statuses (`idle` · `working` · `waiting`) and no timer; tasks have exactly
`open | in_progress | done`. Inventing UI for a mechanism the backend lacks is worse than leaving it out —
it reads as a bug forever.

## Verifying

Design conformance is not a typecheck. **And do not settle a visual question by looking — measure it.**
Nearly every "is this bigger / darker / more indented?" question in this codebase has been answered wrong
by eye and right by `getComputedStyle`. Two glyphs that looked different sizes were both 12px (it was
stroke density); a background that read "pinkish" had chroma 0 (the tint was in a neighbouring token); a
sticky header that looked broken was at y=1186 against a 483px viewport.

The probe: drive the running app with Playwright from inside `packages/e2e/`, read
`getComputedStyle`/`getBoundingClientRect`, print the numbers, then screenshot. Delete the script after.
Resolve colours through a canvas — `getComputedStyle` returns `oklch(…)` strings that naive parsing
misreads as rgb.

Before calling UI work done:

- Render it. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` proves it mounts, not that it looks
  right — for anything visual, run the app (`pnpm tauri:dev` from `packages/app-tauri`, isolated via
  `DAEMON_PORT` + `MAINFRAME_DATA_DIR`) and look at it, or dispatch the `design-conformance` agent.
- Check it at a narrow width and with a long string in every truncating slot.
- Check both light and dark (the theme toggle is in the toolbar), and at least one non-`glass` window
  style — that is where borrowed panel chrome shows up.
- Walk the state matrix above, not just the state you happened to build.
- If you touched a color token: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/styles/__tests__/contrast.test.ts`.
- Check compact UI scale (0.92) too, not just normal — it is where undersized type stops being readable.
- Typecheck: `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

## The visual spec

Most surfaces have an artboard. They live in the **claude.ai design project "Mainframe"**
(`63fecfba-4e43-416e-8ef7-e753512d2a25`), readable through the DesignSync MCP tool — `list_files`, then
`get_file`. Worth knowing they exist before you invent a layout:

- **Per-surface state matrices:** `Composer States.html`, `Chat Cards Review.html`, `User Message States.html`,
  `Popovers Review.html`, `Tasks Review.html`, `Viewers Review.html`, `Workflows Review.html`,
  `New Session Review.html`, `Window States.html`, `Sidebar Compact.html`, `Workspace Surfaces.html`
- **Atoms + the full icon inventory:** `Primitives.html`
- **Anatomy map — which shadcn/assistant-ui component each element becomes, plus the field-level data
  contract per card:** `handoff/component-map.md`. The most useful single file in the project.

Two caveats. The prototype is hand-built HTML with its own vocabulary (`T.*`, `ACCENT`, `FS`, `RADIUS`,
`window.*` module globals) — read it for *intent and anatomy*, never copy its mechanics into `packages/ui`.
And `Design Tokens Report.html` predates the ocean/velvet schemes: it still shows one shared `#0a84ff`
accent. **`globals.css` is authoritative for values; the artboards are authoritative for layout and states.**

The `design-conformance` agent exists to diff a built component against these artboards — dispatch it after
a port rather than eyeballing.

## Related

**`docs/architecture/2026-07-11-typography-legibility-audit.md`** and its findings companion — the
measured basis for the type roles, ink tiers, icon grid, and count-badge treatment above. It shipped as
PR #452 (token re-tints, `UI_SCALE_FACTORS` 0.92/1.0/1.15, the contrast test, the primitive repairs), so
read it as *what the app decided*, not as a proposal. Its remaining open items are the P2 tail.

`references/v2-stock.md` — the `src/v2` tree: its scales, its three extra tokens, and the recipes that
invert v1's. Required reading before any work under `src/v2`.

`packages/ui/CLAUDE.md` (assistant-ui golden rule, surface model, architecture), the `shadcn` and
`radix-ui-design-system` skills for primitive-level questions, `ui-ux-pro-max` for general visual judgment
when no in-app template exists.
