# Token reference

Source of truth: `packages/ui/src/styles/globals.css`. `:root` (~line 23) and `.dark` (~216) define the
values; three schemes (`[data-scheme="ocean"]`, `[data-scheme="velvet"]`) override them; `@theme inline`
(~793) is what turns a variable into a Tailwind utility.

## The mapping rule — a var is not a utility

`--mf-foo` exists as a CSS variable. `bg-mf-foo` only works if `@theme inline` contains
`--color-mf-foo: var(--mf-foo);`. **Grep before you use.** An unmapped name compiles to nothing and renders
silently unstyled — no build error, no console warning.

Deliberately unmapped (use as arbitrary values, never as a color utility):

| Variable | Correct usage |
|---|---|
| `--mf-shadow-modal`, `-pop`, `-panel`, `-panel-soft`, `-panel-ambient`, `-panel-glass-ambient`, `-card`, `-card-hover`, `-picker`, `-rail-active`, `-user-card`, `-segment`, `-keycap`, `-edit-ring` | `shadow-[var(--mf-shadow-panel)]` |
| `--mf-focus-ring` | applied globally by the `:focus-visible` rule; opt out with `data-noring` |
| `--mf-find-tint`, `--mf-find-active` | `bg-[var(--mf-find-tint)]` |
| `--mf-cm-*` (editor UI states) | CodeMirror theme objects, not classes |
| `--mf-um-card`, `--mf-um-fade`, `--mf-checker-*`, `--mf-provider-*-avatar` | arbitrary values |

## Type — 8 rungs

| Class | Size | Leading | Use |
|---|---|---|---|
| `text-xs` | 11px | 16px | secondary metadata, chips, footnotes, form labels, ornament |
| `text-sm` | 13px | 18px | **baseline** — body copy, rows, menu items |
| `text-base` | 16px | 24px | dialog and pane titles |
| `text-lg` | 18px | 28px | surface titles |

`text-sm` is the inherited baseline — so an *unstyled* text node looks plausible and is still wrong.
**`text-xl` and above are phantoms**: nothing uses them, so Tailwind never generates them and the
class silently does nothing. Add a real usage before reaching for one.

### Which rung for which role

Settled by the typography audit (`docs/architecture/2026-07-11-typography-legibility-audit.md`, shipped as
PR #452). The scale was being authored a rung low; the fix retuned `UI_SCALE_FACTORS` to
`compact 0.92 / normal 1.0 / large 1.15`, so **normal is now true ×1.0 zoom and `body` really is 13px**.

> **The v1 rungs were retired 2026-08-07.** The table below is the surviving role map on the stock
> names. Mapping used: `caption`→`text-xs` and `body`→`text-sm` (lossless, same px), `label` 12→11,
> `micro` 10→11, `heading` 15→`text-base` 16, `title` 17→`text-lg` 18.

| Role | Rung |
|---|---|
| Primary content and anything the user acts on — session titles, menu items, picker values, button labels, inputs | `text-sm` 13 |
| Secondary supporting text — descriptions, tooltips, code/diff text, table cells, meta rows | `text-xs` 11 |
| Compact annotations — chips, badges, section headers, keycaps, timestamps | `text-xs` 11 |
| Dialog and pane titles | `text-base` 16 |
| Surface titles | `text-lg` 18 |

Tracking: `tracking-tight` (-0.02em) on headings. **`tracking-wide` is not a licence for uppercase
eyebrows** — the `text-micro font-bold uppercase tracking-wide` muted-ink stack was an app-wide
antipattern the audit removed. A section header is `text-xs font-medium text-muted-foreground` in
sentence case; if an uppercase eyebrow is genuinely wanted, the floor is 11px semibold in
`muted-foreground`.

### Weight

There are no `--font-weight-*` tokens. What follows is **measured from shipped `packages/ui` markup**, not
imported from the design prototype — the prototype specifies a stricter ladder (500 resting · 600 active ·
700 titles · 800 brand) that the app does not actually follow. Match the app.

| Rung | What ships | Take |
|---|---|---|
| `text-xs` | medium · semibold | either; medium resting, semibold for emphasis |
| `text-sm` | semibold · medium | **semibold** for row titles, medium for secondary |
| `text-base` | bold · semibold | **bold** — this is the dialog-title weight |
| `text-lg` | bold | bold |

Practical rules that do hold: **`font-normal` is effectively unused** (3 sites) — muted text gets a muted
*color*, not a lighter weight; **`font-extrabold` appears once**, on the brand mark; and weight rises with
the rung, so anything `text-base` and above is `font-bold`. Below that, medium/semibold is a live
choice — copy the neighbouring component rather than deciding fresh.

`cn()` used to be an `extendTailwindMerge` registering the v1 rungs as a font-size group — without it
tailwind-merge read them as colours and dropped the size. Both the rungs and that config went on
2026-08-07; every size is a stock name now. Still compose through `cn()`, and if you ever add a custom
size, register it there again (`lib/__tests__/cn.test.ts` pins the behaviour).

## Spacing — compressed integers

`--spacing-1: 2px` · `2: 4px` · `3: 6px` · `4: 8px` · `5: 12px` · `6: 16px` · `7: 20px` · `8: 24px` ·
`9: 32px` · `10: 40px` · `11: 48px` · `12: 64px`

So `gap-2` = 4px and `p-4` = 8px — roughly **half** of stock Tailwind. Fractional steps (`p-1.5` = 6px,
`py-2.5` = 10px) follow the default 4px base and are used freely. When porting a prototype measured in px,
use an arbitrary value (`px-[7px]`) rather than guessing a step.

## Radius

| Class | px | What sits here |
|---|---|---|
| `rounded-xs` | 4 | badges, chips, keycaps |
| `rounded-sm` | 6 | list rows, segmented controls, small icon buttons |
| `rounded-md` | 8 | buttons, fields, cards, menus, popovers (`--radius` base) |
| `rounded-lg` | 11 | panels, code blocks, composer surfaces |
| `rounded-xl` | 13 | message bubbles, modals and dialogs |
| `rounded-full` | 999 | pills and toggles (circles use `rounded-full` too) |

Toolbar buttons and chips in shipped code often use `rounded-[6px]`/`rounded-[7px]` directly.
Panel-level rounding is **not yours to pick** — see the window-style axis below.

## Color — shadcn contract

| Token | Meaning |
|---|---|
| `background` / `foreground` | content surface + primary text |
| `card` / `card-foreground` | subtly raised card |
| `popover` / `popover-foreground` | **menus, dropdowns, dialogs** |
| `primary` / `primary-foreground` | brand accent (themed per mode+scheme) |
| `secondary` | secondary/ghost button fill |
| `muted` / `muted-foreground` | muted fill / **secondary text** |
| `accent` / `accent-foreground` | **hover surface** — not the brand |
| `destructive` | error / danger |
| `border` / `input` / `ring` | hairlines · field borders · focus color |

`accent`, `border`, and `input` are alpha colors (`rgba(0,0,0,0.04–0.08)`) — an `/opacity`
modifier on them compounds toward invisible.

## Color — `mf-*` extensions (all mapped to utilities)

> **RETIRED 2026-08-07.** Every generic `mf-*` colour is gone from the bridge. Use the v2 semantic
> instead: `muted-foreground` (was `mf-text-3`), `accent` (`mf-chip`), `success`, `warning`,
> `muted` (`mf-content2`/`mf-raised`), `bg-background/85` (`mf-glass`), `border-input`
> (`mf-border-hover`), `bg-success/10` / `bg-warning/10` for the tints.

- **Surfaces:** `mf-window` (the ErrorState backdrop), `mf-selection`, `mf-scrim`
- **Text:** `mf-text-4` (ornament only — never text)
- **Semantic:** `mf-destructive-tint`
- **Surface identity:** `mf-surface-files` (violet), `mf-surface-run` (green)
- **Tool families:** `mf-tool-read` / `-search` / `-bash` / `-web`, each with a `-tint`
- **Directives:** `mf-directive-skill` + `-tint`, `mf-directive-command-tint`
- **Diff:** `mf-diff-add-bg` / `-border` / `-text`, `mf-diff-del-*`
- **Code + terminal:** `mf-code-bg/fg/kw/str/fn/type/num/cmt`, `mf-code-inline-fg`,
  `mf-term-bg/fg/cmt/green/cyan/amber`
- **Tasks:** `mf-task-type-{bug,enhancement,question,duplicate}`,
  `mf-priority-{critical,high,medium}` + `mf-priority-{critical,high,medium,low}-dot`
- **Automations:** `mf-auto-violet`, `mf-auto-kind-{question,loop,parallel,call}`
- **User message:** `mf-um-ink`, `mf-um-edge`, `mf-um-dash`
- **Viewer:** `mf-viewer-matte`, `mf-viewer-check-a/b`
- **Accents:** `mf-accent-amber`, `mf-accent-violet`

Task/tool/automation/diff hues are **design constants** — no per-scheme override. Everything else is
redefined in `.dark` and in each scheme block, which is exactly why hardcoding a hex breaks five of six
themes.

## Motion

`--ease-default` (cubic-bezier(.4,0,.2,1)) · `--ease-signature` (cubic-bezier(.22,1,.36,1)) · plus
`--ease-in` / `-out` / `-bounce`. Chrome transitions run 120–200ms (`duration-[120ms]` on hovers,
`duration-200` on dialogs). Only `--ease-default` and `--ease-signature` are mapped as utilities
(`ease-default`, `ease-signature`).

## Fonts

`font-sans` = system stack (`-apple-system`/SF Pro Text). `font-mono` = SF Mono. Branch names, commands,
paths, and code are always `font-mono`.

## Icons — the compressed-scale trap

Icons are `lucide-react` at the library's default stroke (explicit `strokeWidth` appears ~16 times total,
and when it does it is *heavier*, 2.4–3, for emphasis glyphs — the prototype's 1.6px convention did not
come across, so don't apply it).

**Integer `size-N` on an SVG is a bug.** The spacing scale is compressed, so `size-3` renders **6px** and
`size-4` renders **8px**, not 12 and 16. Use one of:

- a fractional utility — `size-3.5` = 14px (these follow stock Tailwind's 4px base)
- an explicit arbitrary value — `size-[12px]`
- the lucide prop — `size={12}` (the most common form in this codebase, 164 uses at 12)

Meaningful glyphs sit on a **12 / 14 / 16** grid: 12 inside chips and meta rows, 14 for default UI, 16 for
headers and nav. Decorative dots are exempt. `button.tsx` guards the default with
`[&_svg:not([class*='size-'])]:size-3.5`, which respects a child's own `size-*` — don't reintroduce a bare
`[&_svg]:size-4`, which silently defeats overrides and was the original 8px-icon bug.

## Ink tiers — contrast is enforced

`src/styles/__tests__/contrast.test.ts` composites every ink token over its real backdrop across all six
appearance blocks and asserts the WCAG floors. Changing a color token means keeping that test green.

- `foreground` (≥13:1) and `muted-foreground` (4.8–7:1) are the two safe text inks.
- **`mf-text-4` was ornament, not text — and as of 2026-08-07 it is not a utility at all.** The sweep
  moved its last class consumers (gutter numerals, inactive tour dots) to `muted-foreground/50`, so the
  `@theme` mapping went and only the bare `--mf-text-4` var survives, for `app.css`'s `scrollbar-color`.
  Reach for `muted-foreground/50` when you want ornament ink.
- **Never stack `opacity-*` on an ink token.** Pick the right tier instead; the stack was measured as low
  as 1.3:1.
- **Semantic hues are not text colors.** `success` / task-type / priority / workflow hues
  belong on the icon, the dot, or a tint background — the text beside them stays
  `foreground` / `muted-foreground`.
- **`text-white` only on true scrims.** On an accent fill use `text-primary-foreground`; two dark schemes
  have light accents and hardcoded white breaks them. White-on-accent needs ≥12px medium/semibold, and
  never a translucent `white/NN` capsule.

## The fourth axis — window style

Appearance is **mode × scheme × window style × ui scale**, not just mode × scheme. Window style
(`unified` · `split` · `glass`, `data-window-style` on the shell root, default `glass`) is *structural*:
it decides whether a panel is a floating rounded card, a full-bleed hairline-divided pane, or a frosted
blur card — and the three disagree on radius, fill, shadow, and gutter.

All of that geometry lives in **`lib/appearance/window-style.ts`** (`windowStyleGeometry(style)`) and is
applied by `AppShell` / `SidebarShell` / `SurfaceHost`. A feature component that gives itself a panel
radius, a window-colored fill, or a panel shadow will look correct in one style and wrong in the other
two. Style the *inside* of your surface; let the shell own its outer edge.

`uiScale` is applied as webview zoom, so it needs nothing from you — but it is the reason arbitrary px
values should stay rare and small.
