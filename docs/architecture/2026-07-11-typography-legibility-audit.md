# Typography & legibility audit — diagnosis and proposal (2026-07-11)

Status: **PROPOSAL — awaiting user triage.** Companion finding inventory:
[2026-07-11-typography-legibility-findings.md](2026-07-11-typography-legibility-findings.md).

Trigger: project-picker pills are barely readable in compact mode, their count
badge is near-invisible at any scale, and the sessions list reads as
black/washed-black instead of the macOS-sidebar gray + accent-selection
hierarchy. A full static audit of `packages/ui` (4 parallel surface audits +
measured WCAG math over all six theme blocks) found these are instances of
seven systemic root causes, not isolated styling mistakes: ~20 P0
(unreadable/invisible), ~300 P1 (fails legibility norms), ~115 P2
(inconsistency).

## How this was measured

- Type/zoom math: semantic tokens are micro 10 / caption 11 / label 12 /
  body 13 / heading 15 / title 17 px; "UI scale" is native page zoom
  (`store/theme.ts`: compact ×1.0, normal ×1.15, large ×1.3), so **compact
  renders raw token pixels**.
- Contrast: WCAG ratios computed from `globals.css` token values for all six
  appearance blocks, compositing alpha colors over their real backdrops
  (glass-over-window, accent-over-glass, white/25-over-primary). Script kept at
  the session scratchpad (`contrast-audit.mjs`, `token-solver.mjs`); the
  proposal below includes a CI guard so the numbers stay checked.

## Root causes

**R1 — The app is authored one type-rung below its own scale.**
`text-caption` (11px) is the de-facto body (417 uses); `text-micro` (10px) is
the de-facto secondary (162 uses); `text-body` (13px) has only 157. The zoom
factors were then tuned to compensate (`UI_SCALE_FACTORS` comment: "tuned so
Normal dominant text ≈ 13px" — i.e. 11px caption ×1.15 ≈ 12.7px). Compact
(×1.0) exposes the raw 10–11px text.

**R2 — The bottom half of the ink ramp fails everywhere.**
`foreground` (≥13:1) and `muted-foreground` (4.8–7:1) pass. But `mf-text-3`
measures **2.5–4.4:1** (fails the 4.5:1 text floor in every theme; worst on
light glass) and is used pervasively as the everyday secondary text color.
`mf-text-4` measures **1.5–2.3:1** and carries real content (timestamps, file
paths, log tails, status rings, kbd hints, placeholders); one site stacks
`opacity-50` on it (≈1.3:1). Opacity-stacking on muted inks appears in ~10
more places.

**R3 — Semantic hues used as text color.**
`text-mf-success` / `text-mf-warning` ≈ 2.7–2.9:1 on light themes (PR links,
diff +N/−N stats, "Viewed", saved/unsaved chips, branch ahead/behind). The
fixed task-type/priority/workflow hues have **no dark-theme overrides** and
fail hardest on dark cards. Colored text on a same-hue tint (green-on-green
"Approved") compounds it.

**R4 — The badge/count treatment is mathematically invisible.**
`FilterPill`: 10px bold `text-white` on `bg-white/25`-over-primary =
**1.8–2.9:1** (the reported badge). Inactive: white-on-primary 2.1–4.1:1 —
and hardcoded `text-white` breaks the two dark schemes whose accents are
light (should be `primary-foreground`). Same pattern in BottomPanel tab
counts, tool-group "N calls", workflow "Answer now"/"Needs you".

**R5 — The eyebrow antipattern, copied everywhere.**
`text-micro font-bold uppercase tracking-wide text-mf-text-3` — 10px + bold +
uppercase + wide tracking + failing color, stacked. Verbatim in ≥13 feature
files **and** in five shared primitives (`menu.tsx` MenuLabel,
`dropdown-menu.tsx`, `command.tsx` ×2, `context-menu.tsx`), so every popover
section header in the app inherits it.

**R6 — Compressed-spacing icon traps and icon anarchy.**
The theme redefines integer spacing (`--spacing-3`=6px, `--spacing-4`=8px), so
`size-3` icons render 6px and `size-4` 8px. `button.tsx` applies
`[&_svg]:size-4` → **8px icons in every Button**, and its specificity silently
defeats child `size-*` overrides (the composer's Paperclip/AtSign, authored
6px, render 8px — both wrong). Two icons are larger than their boxes and clip
(`WfEditorChrome.tsx:89`, `TaskListRow.tsx:83`). Meaningful lucide glyphs span
6–16px with no scale (9px warning triangles, 9px close buttons, 6px chevrons).

**R7 — Sessions sidebar ignores the macOS label hierarchy it's aiming for.**
Row titles are near-black `foreground`, then metadata falls off a cliff to the
failing `mf-text-3/4` grays — there is no macOS-like secondary-label middle
step in use ("black / washed black"). Selection is a 2px left border + 4%
black wash, not the Finder-style rounded fill + accent treatment. The idle
status glyph is `mf-text-4` + `opacity-50` (≈1.3:1, invisible).

## Proposal

### 1. Fix the ink ramp values (token-only; biggest visual lift, zero call-site churn)

Adopt macOS label semantics and re-tint the failing tiers, hue-preserved,
solved per theme to clear 4.5:1 on glass, background, and card:

| Token | Role | classic L | classic D | ocean L | ocean D | velvet L | velvet D |
|---|---|---|---|---|---|---|---|
| `--mf-text-3` | Tertiary text (short metadata only) | `#92918d`→**`#6c6b68`** | `#7d8099`→**`#8b8ea4`** | `#89989d`→**`#5f6d72`** | `#76869b`→**`#7e8da1`** | `#94899c`→**`#72677b`** | `#877b97`→**`#9287a1`** |
| `--mf-success` (text use, light only) | | `#28a745`→**`#1d7b33`** | keep | `#1e9e58`→**`#177a44`** | keep | `#1f9e54`→**`#187b41`** | keep |
| `--mf-warning` (text use, light only) | | `#d97706`→**`#a15804`** | keep | `#c07a12`→**`#955f0e`** | keep | `#c0741f`→**`#9a5d19`** | keep |

`--mf-text-4` keeps its value but is **reclassified as ornament**
(hairlines, drag grips, scrollbars — it already paints `mf-thin-scrollbar`).
Policy: never on text or meaning-bearing icons; the ~20 P0 sites move up to
`mf-text-3`/`muted-foreground`. (Alternative if visible "disabled" text is
wanted: solved 3:1 values exist — classic L `#8b877f`, classic D `#6c708e`,
ocean L `#738c94`, ocean D `#607085`, velvet L `#93829d`, velvet D `#75688c` —
but this thickens every hairline; policy-only is recommended.)

Additional color rules:
- Never stack `opacity-*` on an ink token; pick the right tier instead.
- Semantic hues (success/warning/task-type/priority/wf-kind) live on the
  icon/dot/tint-background; the text next to them is `foreground`/
  `muted-foreground`. Fixed-hue chip tokens get dark-theme overrides.
- `text-white` only on true scrims; on accent fills use `text-primary-foreground`.
- White-on-accent text (active pills, primary buttons) is kept per Apple
  convention but only ≥12px medium/semibold — never 10px, never on
  translucent `white/NN` fills.

### 2. Re-anchor the type roles (the compact-mode fix)

Keep the 8-rung scale (it is macOS HIG). Fix the **role mapping** and promote
must-read text one rung, per the findings inventory:

| Role | Token | Goes here |
|---|---|---|
| Primary content, labels users act on | `body` 13 | session titles (already), menu items, picker values, question text, message/inputs, button labels |
| Secondary supporting text | `label` 12 | descriptions, tooltips, code/diff text, table cells, meta rows users rely on |
| Compact annotations | `caption` 11 | chips, badges, eyebrows, keycaps, timestamps |
| Ornament only | `micro` 10 | nothing that must be read (target: deprecate) |

Then retune `UI_SCALE_FACTORS` **in the same PR** (coupled — see phasing):
`compact 0.92 / normal 1.0 / large 1.15` → dominant text 12 / 13 / 15 px.
Normal becomes true HIG 13px at crisp ×1.0 zoom (today it's a zoomed 12.65px);
compact becomes a legible small mode (12px dominant, ~11px secondary) instead
of 11px/10px.

**Interim option (single line, ships day 1):** bump compact 1.0 → **1.08**
(dominant 11.9px, micro 10.8px). Honest tradeoff: compact temporarily sits
close to normal (×1.08 vs ×1.15) until the re-anchor lands.

### 3. One `CountBadge` primitive (the pill badge fix)

macOS-style, replacing every ad-hoc count:
- **Informational count** (project pills, tab counts, "N calls"): no capsule —
  `text-caption font-semibold tabular-nums text-muted-foreground`, switching to
  `text-primary` when it means unread. (Finder/Mail sidebar style.)
- **On accent fills** (active pill): same size, `text-primary-foreground` at
  full opacity; the `bg-white/25` capsule is deleted.
- **Alerting badge** (needs-input): filled `bg-primary`/`bg-destructive`
  capsule, ≥16px tall, `text-caption` semibold `primary-foreground`.

Pill labels move `caption→label` (12px) with `max-w` widened accordingly.

### 4. Primitive repairs (each clears dozens of call sites)

- `menu.tsx` MenuLabel + `dropdown-menu.tsx:179` + `command.tsx:32,89` +
  `context-menu.tsx:183` → one **`SectionHeader`** recipe:
  `text-caption font-medium text-muted-foreground`, sentence case, no
  bold/uppercase/tracking-wide below 12px. (If uppercase eyebrows are wanted
  as a design signature: 11px semibold + `tracking-wide` is acceptable **only**
  in `muted-foreground`.)
- `menu.tsx:64` MenuRow hint: `text-mf-text-4` → `text-mf-text-3` (new value).
- `tooltip.tsx:33`: `text-caption` → `text-label` (tooltips are the only label
  for every icon-only control).
- `button.tsx:13`: `[&_svg]:size-4` (8px) →
  `[&_svg:not([class*='size-'])]:size-3.5` (14px + child overrides respected —
  the guard `menu-variants.ts` already uses).
- `Composer.tsx:125` placeholder → `placeholder:text-mf-text-3`.
- Add paired line-height tokens so text utilities emit sane leading:
  `--text-micro/caption/label--line-height: 1.3`, `--text-body: 1.45`,
  `--text-heading/title: 1.25`.

### 5. Icon grid

Meaningful glyphs land on a 12/14/16 px grid (12 inside chips/meta rows,
14 default UI, 16 headers/nav); 9–11px glyphs promoted; decorative dots
exempt. Icons never use integer `size-N` utilities (compressed scale) — always
fractional (`size-3.5`) or explicit (`size-[12px]`, lucide `size={12}`).
Fix the two clip bugs (`WfEditorChrome.tsx:89`, `TaskListRow.tsx:83`) and the
6px glyph family (quote/directive/attachment/ImportSessionsDialog chevron).

### 6. Sessions sidebar — macOS treatment (the color complaint)

- **Selection:** inset rounded fill (`rounded-md`, neutral 6–8% ink wash, the
  existing `mf-chip`/`accent` family) with the accent carried by the status
  dot + unread/title accents — replacing the 2px left border + 4% wash.
  (Finder model: gray fill, accent glyph.)
- **Row inks:** title `foreground`; metadata/timestamps `muted-foreground`
  (not `mf-text-3`); group headers = SectionHeader (caption,
  `muted-foreground` — the Finder "Favorites" gray); hover actions
  `muted-foreground`→`foreground`; idle status glyph loses `opacity-50` and
  uses `mf-text-3` minimum.
- Meta row `micro`→`caption`; PR link uses the new success value at `caption`.

### 7. Guardrails (keep it fixed)

- **Contrast unit test** in `packages/ui`: parse `globals.css`, composite the
  real backdrops, assert `muted-foreground`/`mf-text-3` ≥ 4.5:1 and every
  `*-tint`+hue text pair ≥ 4.5:1 across all six blocks.
- **Static lint sweep** (script or CI grep): forbid `text-mf-text-4`/
  `border-mf-text-4` outside an allowlist; forbid integer `size-N` on svg;
  forbid `text-white` outside scrim contexts; forbid `opacity-*` adjacent to
  ink tokens; forbid the `text-micro font-bold uppercase` stack.

## Phasing (PR-sized, each independently shippable)

1. **PR-1 "ink & primitives"** — token re-tints (§1), primitive repairs (§4),
   CountBadge (§3), sidebar treatment (§6), icon-clip/6px bug fixes, guardrail
   test. Zero-to-low call-site churn, immediate app-wide lift; fixes the
   reported badge + washed-gray complaints at every scale. Optionally includes
   the interim compact ×1.08 bump.
2. **PR-2 "P0/P1 sweep"** — mechanical promotion of the ~320 flagged sites per
   the findings doc (micro→caption, caption→label/body, hue-text→foreground,
   9–11px→12/14px icons). Bulk-mechanical: suited to codex delegation with the
   findings doc as the worklist, then a design-conformance pass.
3. **PR-3 "re-anchor"** — the coupled change: dominant text to `body` where
   still below it + `UI_SCALE_FACTORS` → 0.92/1.0/1.15 (+ revert the interim
   bump). Must land atomically or normal mode grows ~15%.
4. **PR-4 "icon grid + P2s"** — sibling-size normalization, status-dot grid,
   token-drift cleanups (destructive vs diff-del-text, wf-violet pairing).

Verification per PR: `pnpm --filter @qlan-ro/mainframe-ui typecheck`, the new
contrast test, and a live render pass (test-worktree / design-conformance)
across classic/ocean/velvet × light/dark × compact/normal.

## Decision points

1. Eyebrows: sentence-case (recommended) vs keep-uppercase-at-11px signature.
2. Informational counts: capsule-less gray text (recommended, Finder-style) vs
   keep filled capsules with fixed contrast.
3. Interim compact ×1.08 in PR-1: yes (quick relief) / no (wait for PR-3).
4. `mf-text-4`: policy-only reclassification (recommended) vs darken to 3:1.
5. Selection: neutral fill + accent glyphs (recommended, Finder) vs
   accent-tinted fill (`mf-selection`).
