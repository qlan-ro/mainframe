# Artboard-Parity Drift Audit — app-tauri (Electron → Tauri rebuild)

**Date:** 2026-06-17  
**Method:** 14 parallel `design-conformance` audits (one per built surface) diffing built code against its warm-chrome artboard + prototype JSX + the `styles/globals.css` token contract; each surface’s findings adversarially re-verified against the real code; then synthesized. 29 agents, ~2.9M tokens.  
**Result:** **179 confirmed drifts** (2 blocker · 95 major · 82 minor) across 14 surfaces · 2 refuted · 4 foundational token claims independently re-verified by the orchestrator.  
**Status:** proposal — *no fixes applied*.

> Parity audit against the artboards in `docs/design-reference/`. Documented **approved divergences** (@mention Badge chip, 4-line read-more clamp, native collapsed reasoning, side-by-side-only review) and **tracker-deferred** features were excluded from drift; deferred items observed during the sweep are listed per surface under *Deferred (not drift)*.

---

## Executive summary

_(Synthesis agent's narrative; the precise verified count is **179 drifts across 14 surfaces** — the "186/13" below is the agent's estimate, the per-surface tables are exact.)_

179 verified design-drift findings across the surfaces of the Electron→Tauri rebuild (packages/app-tauri/src), all already adversarially verified (refuted ones removed). The dominant signal is systemic, not per-surface: four token-level defects repeat across nearly every surface and account for the majority of "major" findings. (1) Selection state uses bg-accent (the near-invisible hover tint, rgba(0,0,0,0.04)) instead of bg-mf-selection (the brand-blue tint) in 5+ places — command palette, dir picker, review tree, settings nav, composer chip open-states. (2) Three letter-spacing tokens (--tracking-tight/normal/wide) are all hard-set to 0 in globals.css:740-742, overriding Tailwind's defaults AND the prototype values (-0.02em / 0 / 0.06em), so every uppercase eyebrow/caps label renders with zero tracking app-wide. (3) Pop-up surfaces and the annotation popover use Tailwind's built-in shadow-lg/shadow-md instead of var(--mf-shadow-pop) (the warm-chrome shadow with a 0.5px hairline ring) — ContextMenu and CaptureAnnotationPopover. (4) Warm content surfaces are swapped: bg-mf-tab-bar / bg-background / bg-card / bg-muted used where the prototype wants bg-mf-content2 / bg-card / bg-mf-code-bg — affecting surface headers, code blocks, tables, settings sidebar, viewers, inputs. Two blockers (markdown code-block has no outer container; review panel renders a duplicate close button). Plus systemic gaps: missing dialog-root data-testids (4 dialogs), selection-as-button keyboard a11y gaps, and missing open/active visual states. I verified the four foundational claims directly: globals.css confirms tracking tokens at 0, --mf-viewer-check-a/b defined (84-85) but NOT mapped in @theme inline (latent phantom-token trap), --color-mf-selection IS mapped (678) so the selection fixes are immediately viable, and --mf-shadow-pop exists (88). Recommended approach: land the cross-cutting token/primitive fixes FIRST (they ripple into ~40 of the per-surface findings for free and de-risk the rest), then per-surface blockers, then majors, then minor polish. Several uncertain items (none in this set — all 186 carry verdict=confirmed) would need a live render check; flagged none.

---

## 0. Cross-cutting fixes — DO THESE FIRST

Four token/primitive defects repeat across nearly every surface and account for the majority of the `major` findings. Fixing them at the source ripples into ~40 per-surface findings for free. **All independently re-verified against source.**

> **STATUS — 2026-06-17: Phase 0 IMPLEMENTED & verified** (993 tests green in touched areas; typecheck clean except a pre-existing `ConsolePane.test.tsx` `variant`-prop error in the uncommitted preview WIP). Refinements made during implementation:
> - **Letter-spacing:** restored the documented scale (`--tracking-tight:-0.02em`, `--tracking-wide:0.06em`) rather than inventing `--tracking-caps` — the Design Tokens Report maps uppercase eyebrows to **`LS.wide`**, so the 12 uppercase caps callers were repointed `tracking-normal`→`tracking-wide`. The `design-token-audit.test.ts` typography lint was updated to allow the 3 named tokens (tight/normal/wide) while still banning arbitrary/framework tracking; a new guard test locks the values + the `@theme` mappings.
> - **Dialog scrim:** added a per-scheme `--mf-scrim` token (light `rgba(22,19,15,.40)`, dark `rgba(0,0,0,.55)`) + `--color-mf-scrim` mapping, and used `bg-mf-scrim` — **not** a raw `rgba()` literal (which the color-lint bans in TS/TSX).
> - **viewer-check phantom-token** closed (`--color-mf-viewer-check-a/b` mapped in `@theme inline`).
> - **Primitives:** command selection (`bg-mf-selection`/`text-foreground`), context-menu shadows→`--mf-shadow-pop` + `rounded-lg` + muted `ContextMenuLabel`, input/textarea `bg-card` + `border-[0.5px]`, button `disabled:opacity-[0.45]`, scroll-area thumb `bg-mf-text-4`.
> - **Deferred from Phase 0 (deliberate):** scroll-area *auto-hide* (opacity/group-hover) — can fight Radix's own visibility state, wants a live check; input/textarea `bg-card` fill wants a live render check (could blend on content2 surfaces); the pre-existing `terminal-cache.ts` xterm-hex color-lint red was allowlisted (xterm `ITheme` legitimately needs literal hex), not tokenized.

> **STATUS — 2026-06-17: Phase 1 (the 2 blockers) IMPLEMENTED & verified.**
> - **Markdown code-block container:** the audit's "wrap `pre`'s children" one-liner was **wrong** — verified in the `@assistant-ui/react-markdown` source that `CodeHeader` and `SyntaxHighlighter` are **Fragment siblings** (`DefaultCodeBlock`), and our `pre` slot only wraps the highlighter body, never the header. Fixed with a **CSS-composed container**: `CodeHeader` rounds the top + full border (`mt-3 border border-border rounded-t-md`); the shiki `<pre>` rounds the bottom + side/bottom border with `border-t-0` (shared divider) + `mb-3`. Together they read as one bordered block.
> - **Review-panel double close:** added an opt-in `hideClose` prop to `DialogContent` (default `false` — every other dialog unchanged); `ReviewPanel` sets `hideClose` so only its own header close (`review-close`) renders.
> - **Tests:** 3 new (2 markdown container-class assertions + 1 "exactly one close control"), TDD red→green. Typecheck clean for all touched files (only the pre-existing `ConsolePane.test.tsx` `variant` WIP error remains).

### 🟠 Major — Letter-spacing tokens --tracking-tight/normal/wide all resolve to 0, overriding Tailwind + prototype values app-wide  `[S]`
- **Where:** `packages/app-tauri/src/styles/globals.css:740-742`
- **Fix:** In globals.css @theme inline (740-742) set --tracking-tight: -0.02em and --tracking-wide: 0.06em (keep --tracking-normal: 0). Then add a named --tracking-caps: 0.6px (or 0.05em) for uppercase eyebrow/caps labels, mapped in @theme inline. This single change fixes the 'tracking-normal renders 0' drift cited in chat-cards-3, markdown-markers-15, window-chrome-sidebar-11, overlays-palette-6, review-panel-3, and primitives-tokens-1 simultaneously. After the token fix, repoint callers that need caps spacing (GateShell.tsx:48, marker-pill.tsx:99, SessionGroup.tsx:33, SessionSidebar.tsx:67, TagFilterBar.tsx:110, command.tsx group-heading) to tracking-caps.

### 🟠 Major — Selection state uses bg-accent (hover tint, rgba(0,0,0,0.04)) instead of bg-mf-selection (brand-blue) — selected rows look identical to hover across 5 surfaces  `[M]`
- **Where:** `packages/app-tauri/src/components/ui/command.tsx:106`
- **Fix:** Fix in the shared primitive first: command.tsx:106 change data-[selected=true]:bg-accent -> data-[selected=true]:bg-mf-selection and text-accent-foreground -> text-foreground (covers SearchPalette + FilePickerDialog). Then DirectoryPickerModal.tsx:72, ReviewFileTree.tsx:43, SettingsSidebar.tsx:26 active state. --color-mf-selection IS already mapped (globals.css:678) so bg-mf-selection is a valid utility. Covers overlays-palette-4, overlays-dirpicker-1, review-panel-6, settings-3.

### 🟠 Major — ContextMenu uses Tailwind shadow-lg/shadow-md instead of var(--mf-shadow-pop) — pop-up shadow contract violation  `[S]`
- **Where:** `packages/app-tauri/src/components/ui/context-menu.tsx:60,74`
- **Fix:** In context-menu.tsx replace shadow-lg (line 60, SubContent) and shadow-md (line 74, Content) with shadow-[var(--mf-shadow-pop)], and bump rounded-md -> rounded-lg for parity with DropdownMenu/Popover which already use the token. Same fix pattern applies to CaptureAnnotationPopover.tsx:19 (sandbox surface).

### 🟠 Major — Input and Textarea use bg-transparent + 1px border instead of content2 fill + 0.5px hairline  `[S]`
- **Where:** `packages/app-tauri/src/components/ui/input.tsx:12`
- **Fix:** In input.tsx:12 and textarea.tsx:10 change bg-transparent -> bg-card (== --mf-content2, adapts per scheme) and replace the default `border` with `[border-width:0.5px] border-input`. Fixes both primitives-tokens-2 and primitives-tokens-5 at the source; ripples to every form field.

### 🟠 Major — Dialog overlay scrim is pure cool black (bg-black/40) instead of warm-brown tint  `[S]`
- **Where:** `packages/app-tauri/src/components/ui/dialog.tsx:15`
- **Fix:** In dialog.tsx:15 DialogOverlay change bg-black/40 backdrop-blur-sm -> bg-[rgba(22,19,15,0.40)] (or add a --mf-scrim token). Consider a lighter 28% variant for the palette. Fixes overlays-palette-9, settings-7, review-panel-12-adjacent, and the SearchPalette scrim in one place.

### 🟠 Major — --mf-viewer-check-a/b defined per-scheme but NOT mapped in @theme inline — latent phantom-token trap  `[S]`
- **Where:** `packages/app-tauri/src/styles/globals.css:84-85`
- **Fix:** Add to globals.css @theme inline block (near line 712 where viewer-matte is mapped): --color-mf-viewer-check-a: var(--mf-viewer-check-a); and --color-mf-viewer-check-b: var(--mf-viewer-check-b);. Required before viewers-1 can use bg-mf-viewer-check-* utilities (otherwise they silently drop to transparent per the known phantom-token trap).

### 🟡 minor — ScrollArea thumb always visible (bg-border) instead of warm auto-hide mf-text-4  `[M]`
- **Where:** `packages/app-tauri/src/components/ui/scroll-area.tsx:37`
- **Fix:** In scroll-area.tsx:37 change the thumb to bg-mf-text-4 opacity-0 group-hover/scroll:opacity-100 transition-opacity (add group/scroll to the Root), OR apply the existing .mf-thin-scrollbar CSS class (globals.css:902-929) to ScrollAreaPrimitive.Root and drop the Radix scrollbar. Affects every scroll surface.

### 🟡 minor — Button disabled opacity-50 vs spec 0.45; ContextMenuLabel oversized/full-ink vs muted caption  `[S]`
- **Where:** `packages/app-tauri/src/components/ui/button.tsx:12`
- **Fix:** button.tsx:12 change disabled:opacity-50 -> disabled:opacity-45. context-menu.tsx:167 change ContextMenuLabel to px-2 py-1.5 text-caption font-semibold text-muted-foreground (match DropdownMenuLabel).

**Additional cross-cutting patterns flagged by synthesis:**
- SELECTION TINT (5 surfaces): bg-accent (rgba(0,0,0,0.04), the hover tint) used for the SELECTED/active state instead of bg-mf-selection (brand-blue) — selected rows are visually indistinguishable from hover. Sites: command.tsx:106 (SearchPalette+FilePickerDialog), DirectoryPickerModal.tsx:72, ReviewFileTree.tsx:43, SettingsSidebar.tsx:24-28, composer chip open-states. Fix the shared command.tsx primitive first. --color-mf-selection is already mapped (globals.css:678) so the utility is live.
- LETTER-SPACING TOKENS (8+ surfaces): --tracking-tight/normal/wide all hard-set to 0 in globals.css:740-742, overriding Tailwind defaults AND prototype values (-0.02em / 0 / 0.06em). Every uppercase eyebrow/caps label app-wide renders at 0 tracking. One token edit + a new --tracking-caps: 0.6px resolves chat-cards-3, markdown-markers-15, window-chrome-sidebar-11, overlays-palette-6, review-panel-3, primitives-tokens-1.
- SHADOW CONTRACT (2+ surfaces): Tailwind built-in shadow-lg/shadow-md used instead of var(--mf-shadow-pop) (the warm-chrome shadow with a 0.5px hairline ring) on pop-up surfaces — context-menu.tsx:60,74 and CaptureAnnotationPopover.tsx:19. DropdownMenu/Popover already use the token correctly; align the stragglers.
- DIALOG OVERLAY SCRIM (4 dialogs): bg-black/40 backdrop-blur-sm (pure cool black) instead of a warm-brown scrim (rgba(40,36,30,0.32) / rgba(22,19,15,0.40)) in the shared dialog.tsx:15 — affects SearchPalette, DirectoryPicker, Settings, Review. Fix once in the primitive.
- WARM CONTENT SURFACE SWAPS (8+ surfaces): the content-surface token family is consistently wrong — bg-mf-tab-bar / bg-background / bg-card / bg-muted used where the prototype wants bg-mf-content2 (raised card), bg-card (==content2), or bg-mf-code-bg (code surface). Sites: surface tab strips + ChatCardHeader (workspace-surfaces-1), CodeHeader (markdown-markers-2), markdown table head/stripe (markdown-markers-7,8), settings sidebar/nav (settings-2), CSV thead (viewers-8), SVG source pre (viewers-5), UnsupportedViewer (viewers-14), CodeRefCard (user-messages-1), inputs (primitives-tokens-2), device toggle (sandbox-preview-run-1). No single fix, but a one-pass token-replacement sweep with a clear mapping table.
- HARDCODED TAILWIND COLORS vs THEME TOKENS: bg-green-500 (PreviewUrlBar.tsx:52), priority pills using bg-orange-100/bg-blue-500 (tasks), --mf-checker-* cool-gray instead of --mf-viewer-check-* warm (viewers-1) — none follow the per-scheme theme tokens, so they don't adapt across the 6 color schemes.
- SELECTION-AS-BUTTON A11Y: interactive elements built as <div onClick> or non-button spans that aren't keyboard-focusable — PreviewBodyState CTA (sandbox-preview-run-7), task status dot (tasks-1). Plus the latent phantom-token trap (--mf-viewer-check-* unmapped, globals.css:84-85) per the documented app-tauri token rule.
- MISSING DIALOG-ROOT data-testid (3 modals): SearchPalette (CommandDialog), DirectoryPickerModal (DialogContent:259), FindInPathModal (DialogContent:186) lack the required <surface>-<element> data-testid on the modal root, violating the project code rule that every dialog/modal root carries one.
- ACCENT-COLOR ICON DRIFT: brand-accent affordances rendered in muted-foreground grey instead of text-primary — DirectoryPicker folder icons (overlays-dirpicker-6), TasksBoard header icon (tasks-7), settings active nav icon (settings-3), New-branch plus when no search (popovers-6). Plus wrong-glyph choices (Search vs Crosshair, Crop vs Frame, Rocket vs Play, FileX vs File, XCircle vs X) that should be a single icon-inventory reconciliation pass.

---

## Recommended fix order

1. PHASE 0 — Foundation tokens & shared primitives (do FIRST, highest leverage, ripples into ~40 per-surface findings): (1) Fix the three tracking tokens + add --tracking-caps in globals.css:740-742. (2) Map --color-mf-viewer-check-a/b in @theme inline (closes the latent phantom-token trap before viewers-1). (3) Fix the selection tint in the shared command.tsx:106 primitive (covers SearchPalette+FilePicker). (4) Fix the dialog overlay scrim once in dialog.tsx:15 (covers 4 dialogs). (5) Fix context-menu shadows -> --mf-shadow-pop. (6) Fix Input/Textarea bg-card + 0.5px hairline. (7) ScrollArea auto-hide thumb, Button disabled opacity, ContextMenuLabel. These are nearly all effort=S and unblock the rest.
2. PHASE 1 — Per-surface blockers (2): markdown code-block outer container (markdown-text.tsx:262) and review-panel duplicate close button (DialogContentNoClose variant). Both effort=S, both break rendering/UX.
3. PHASE 2 — Selection/token sweep across remaining surfaces (apply the Phase-0 patterns to the sites the shared primitives don't cover): selection tint in DirectoryPickerModal, ReviewFileTree, SettingsSidebar, composer chips; the warm content-surface token sweep (one pass with the mapping table from crossCutting); hardcoded-color replacements (bg-green-500, priority pills, checkerboard tokens).
4. PHASE 3 — Per-surface majors, grouped by file-locality to minimize context switching: markdown-markers (table fonts/surfaces, headings, blockquote, lists, line-gutter, copy label, skill body); review-panel (header restructure, file-tree two-line rows, status badges, viewed state, file toolbar, commit rail — the two effort=L items are the panel's primary missing CTA); chat-cards (gate resolved state, plan steps+footer, tool-group header); window-chrome-sidebar (answer pills, dimensions, surface-rail floor, halo dot); workspace-surfaces (RunSurface controls, SurfacePicker drill-down); settings (header band + a11y Title, provider avatar/status, headings); viewers (zoom controls, white cards, ViewerShell actions consolidation, cm dark:true fix); sandbox-preview-run (console drawer, inspect badge, CTA-as-button a11y); user-messages (queued FIFO/sending states, code-ref surface); tasks (status-dot button + keyboard + delete + sort key); composer (send-button shape, plan-mode amber, lock icon).
5. PHASE 4 — A11y + testid hardening: add the 3 missing dialog-root data-testids; convert PreviewBodyState CTA and task status dot to real <button>s (overlaps Phase 3 majors); add run-surface-* testids when building the RunSurface controls.
6. PHASE 5 — Minor polish (after structure is right): icon-inventory reconciliation pass (Crosshair/Frame/Play/File/X, accent-color icons), spacing/radius/padding nudges (MarkerPill padding, HR margin, table radius, session row padding), micro-interactions (gate button press-scale, queued action slide-in, segmented-toggle shadow, starting CSS spinner), label copy ('New task', 'Create task', 'Esc to cancel', 'Permission Requests'), and the named --leading-um/--tracking-um user-bubble tokens.

---

## Per-surface findings (179)

### Markdown & chat markers  ·  17 findings (1B / 11M / 5m)

**🔴 **BLOCKER** — Code block: no outer container — missing border, rounded corners, and overflow clip**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:261 + packages/app-tauri/src/features/chat/parts/syntax-highlight.tsx:17`  
*Artboard:* 08-markdown.jsx MdCode: outer <div style={{ borderRadius:8, overflow:'hidden', border:'0.5px solid T.border', background:T.codeBg }}>  
*Drift:* The assistant-ui DefaultCodeBlock renders CodeHeader and SyntaxHighlighter into a React Fragment (no wrapping DOM element). The `pre` override strips the only element that could serve as a container: `pre: ({ children }) => <>{children}</>`. ShikiCode then renders its own internal `<pre>` with p-3 styling. The two elements are siblings in the markdown flow with no shared container, so the code block has no outer border, no border-radius, and no overflow clip.  
*Fix:* Override the `pre` component in markdownComponents to render a container div: `pre: ({ children }) => <div className="my-3 rounded-md border border-border overflow-hidden">{children}</div>`. This wraps both the CodeHeader and the ShikiCode output in a single rounded, bordered card matching the prototype spec (borderRadius:8, border:0.5px, overflow:hidden).  
<sub>verify: markdown-text.tsx:262 pre override is `<>{children}</>` (Fragment with no container); no outer div for border/radius/overflow</sub>  

**🟠 Major — CodeHeader background token wrong — uses code bg instead of content2**  
`packages/app-tauri/src/features/chat/parts/CodeHeader.tsx:30`  
*Artboard:* 08-markdown.jsx MdCode header bar: background T.content2 (the subtly raised card surface, not the code body bg)  
*Drift:* CodeHeader uses `bg-mf-code-bg` for the header bar, making the header the same color as the code body. The prototype uses `T.content2` (--mf-content2, the standard raised surface) for the header and `T.codeBg` (--mf-code-bg) only for the code area itself. The two-tone visual contrast that distinguishes the header from the body is lost.  
*Fix:* Change `bg-mf-code-bg` to `bg-mf-content2` in the header div className at CodeHeader.tsx:30.  
<sub>verify: CodeHeader.tsx:30 renders `bg-mf-code-bg` for header bar; should be `bg-mf-content2` per prototype spec</sub>  

**🟠 Major — CodeHeader copy button: icon-only, missing 'Copy'/'Copied' text label**  
`packages/app-tauri/src/features/chat/parts/CodeHeader.tsx:43-45`  
*Artboard:* 08-markdown.jsx MdCode copy button: renders Icon + text label 'Copy' (resting) / 'Copied' (feedback), font-size 10, font-weight 600  
*Drift:* The built copy button renders only an icon (Copy/Check). The prototype shows an icon + text label ('Copy' / 'Copied') with fontWeight 600, fontSize 10. The button is icon-only with aria-label for accessibility but no visible text.  
*Fix:* Add a text label inside the button: `{copied ? 'Copied' : 'Copy'}` adjacent to the icon, styled `text-micro font-semibold`.  
<sub>verify: CodeHeader.tsx:45 renders only icon (Check or Copy), no visible 'Copy'/'Copied' text label</sub>  

**🟠 Major — Code block: no line-number gutter**  
`packages/app-tauri/src/lib/shiki-tokens.tsx:109-129`  
*Artboard:* 08-markdown.jsx MdCode: each line prefixed with a 34px line-number column (MONO, 10px, T.text4, userSelect:none, right-aligned)  
*Drift:* ShikiCode renders token lines with no line-number column. The prototype renders a 34px left gutter with right-aligned 1-indexed line numbers in mf-text-4, MONO font, 10px. This gutter is visually distinctive and helps users reference specific lines.  
*Fix:* In ShikiCode's highlighted branch, render each line as a flex row: a `<span className="w-8 shrink-0 text-right pr-3 text-micro font-mono text-mf-text-4 select-none">{i+1}</span>` followed by the token span. Remove the 12px horizontal padding from `PRE_CLASS` to compensate.  
<sub>verify: shiki-tokens.tsx:112-121 ShikiCode renders TokenLine without line-number gutter; lines rendered as plain token spans</sub>  

**🟠 Major — Blockquote: wrong border color (grey) and wrong width (2px)**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:231`  
*Artboard:* 08-markdown.jsx blockquote: borderLeft '3px solid ACCENT66' — brand-accent color at ~40% opacity, 3px wide  
*Drift:* Built blockquote uses `border-s-2 border-mf-text-3` — a 2px grey left border. The prototype uses a 3px brand-accent (--primary) border at 40% opacity. The grey border loses the accent-brand identity that visually distinguishes quoted text.  
*Fix:* Change to `border-s-[3px] border-primary/40` (in Tailwind v4 /opacity modifiers work via color-mix). Or use `border-s-[3px]` with an inline `style={{ borderColor: 'color-mix(in srgb, var(--primary) 40%, transparent)' }}`.  
<sub>verify: markdown-text.tsx:231 blockquote uses `border-s-2 border-mf-text-3` (2px grey); prototype spec is `border-s-[3px] border-primary/40`</sub>  

**🟠 Major — Table th and td: font-mono + uppercase applied to table cells — prototype uses sans-serif, no uppercase**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:91-107`  
*Artboard:* 08-markdown.jsx MdTable thead: fontFamily FONT (sans), fontSize 12, fontWeight 700, color T.text2, padding '7px 12px' — no textTransform; tbody td: fontFamily FONT (sans)  
*Drift:* MarkdownTh applies `font-mono uppercase tracking-normal` and MarkdownTd applies `font-mono`. The prototype uses sans-serif (FONT) for both header and data cells, with no uppercase transform. Using monospace + uppercase in table headers and data cells makes tables look like code output rather than structured content.  
*Fix:* Remove `font-mono` and `uppercase` from MarkdownTh. Use `font-sans font-bold text-label text-muted-foreground`. Remove `font-mono` from MarkdownTd, use `font-sans text-label text-foreground`.  
<sub>verify: markdown-text.tsx:93 MarkdownTh applies `font-mono uppercase`; line 103 MarkdownTd applies `font-mono`; prototype uses sans-serif FONT</sub>  

**🟠 Major — Table even-row alternating color: uses hover tint (bg-accent) instead of raised surface (bg-mf-content2)**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:110-114 (MarkdownTr: even:bg-accent)`  
*Artboard:* 08-markdown.jsx MdTable tbody tr: even rows `background: T.content2` (the subtly raised warm surface), odd rows `T.content`  
*Drift:* Built alternating rows use `even:bg-accent` which is `rgba(0,0,0,0.04)` in light mode — the hover ghost tint, not a distinct surface. The prototype uses `mf-content2` (#f8f6f2) which is a distinctly warm raised card color. The alternating stripe is barely perceptible with the hover tint.  
*Fix:* Change `even:bg-accent` to `even:bg-mf-content2` in MarkdownTr.  
<sub>verify: markdown-text.tsx:111 MarkdownTr uses `even:bg-accent` (hover tint); prototype uses `T.content2` (raised surface)</sub>  

**🟠 Major — Table header background: uses bg-muted instead of bg-mf-content2**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:83-87 (MarkdownThead: bg-muted)`  
*Artboard:* 08-markdown.jsx MdTable thead: background T.content2 (--mf-content2)  
*Drift:* MarkdownThead uses `bg-muted` (#f3efe7 light — the raised/secondary fill, warmer) instead of `bg-mf-content2` (#f8f6f2 light — the card surface, nearly white). The spec uses the slightly cooler content2 surface for the table header.  
*Fix:* Change `bg-muted` to `bg-mf-content2` in MarkdownThead.  
<sub>verify: markdown-text.tsx:84 MarkdownThead uses `bg-muted`; prototype spec is `T.content2` (–mf-content2)</sub>  

**🟠 Major — Ordered list: browser list-decimal instead of accent-colored zero-padded MONO numbers**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:244-248 (ol: list-decimal marker:text-muted-foreground)`  
*Artboard:* 08-markdown.jsx MdBlock list ordered: each item renders a MONO-font, ACCENT-color, fontWeight 700, zero-padded 2-digit marker (01, 02, 03...)  
*Drift:* Built ordered lists use standard browser `list-decimal` with muted-foreground markers. The prototype shows prominent accent-blue (primary), bold, monospace, zero-padded two-digit numbers (01, 02...) as a custom glyph in a 22px-wide column. This is a signature dense-chrome visual element that distinguishes the design.  
*Fix:* Add a custom `li` renderer for ordered lists that checks `data-ordered` or uses a counter, rendering a `<span className="font-mono text-primary font-bold text-caption">` with the zero-padded index. Requires tracking the parent ol context or using a CSS counter approach.  
<sub>verify: markdown-text.tsx:246 ol uses `marker:text-muted-foreground list-decimal`; prototype renders custom accent-colored zero-padded MONO numbers (01, 02...)</sub>  

**🟠 Major — Heading size hierarchy collapsed — h2/h3 same size as body text**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:212-223`  
*Artboard:* 08-markdown.jsx MD component headings: h1≈21px (size+7), h2≈18px (size+4), h3≈16px (size+2), h4≈14px (size+0.5), each font-weight 700  
*Drift:* Built headings: h1=text-heading (15px), h2=text-body (13px), h3=text-body (13px), h4=text-body (13px). h2/h3/h4 are all the same size as body paragraphs — no visual hierarchy. The prototype uses a relative system (base 13.5px + level offsets) producing a distinct size ladder. Also uses `font-semibold` (600) vs prototype's 700.  
*Fix:* Map headings to larger tokens: h1→text-title (17px) font-bold, h2→text-heading (15px) font-bold, h3→text-body (13px) font-bold (slightly larger than 13px or use text-[14px]), h4→text-body font-semibold. Or use Tailwind arbitrary sizes: h1 text-[1.25rem], h2 text-[1.05rem], h3 text-[0.9375rem].  
<sub>verify: markdown-text.tsx:215-219 h2/h3 both map to `text-body` (13px body size); prototype uses relative scale h2=18px, h3=16px</sub>  

**🟠 Major — SkillLoadedCard expanded body renders plain preformatted text, not full markdown**  
`packages/app-tauri/src/features/chat/tools/cards/SkillLoadedCard.tsx:61-64`  
*Artboard:* Chat Markers Review.html artboard 'skill-expanded': `<SkillLoadedCard content={'## React store refactor\n\n1. **Co-locate**...'}/>` — the artboard notes 'markdown body (rendered by the real window.MD)'; prototype SkillLoadedCard calls window.MD to render the content  
*Drift:* When the skill card is expanded, the `content` field is rendered via `MarkerPre` (a `<pre>` with mono font). The prototype/artboard renders it via the full markdown renderer (window.MD). The artboard specifically shows a live example with an h2 heading and a numbered list with bold text — all rendered as structured markdown, not raw text.  
*Fix:* Render the expanded body with the app's `MarkdownText` primitive or `markdownComponents` applied to a remark-gfm ReactMarkdown instance. Since this is not inside a thread message part, use `ReactMarkdown` + `remarkGfm` + `markdownComponents` directly in the MarkerBody.  
<sub>verify: SkillLoadedCard.tsx:63 expanded body renders via `<MarkerPre>` (preformatted plain text), not via markdown renderer; prototype shows structured markdown output</sub>  

**🟠 Major — Inline code uses code-syntax colors (bg-mf-code-bg / text-mf-code-fg) instead of warm-chip style**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:56-67`  
*Artboard:* 08-markdown.jsx mdInline `code`: background T.raised (mf-raised), color '#7a4d2a' (warm brown for inline code), fontSize 0.88em (relative to parent), borderRadius 4, border 0.5px  
*Drift:* Built inline code uses `bg-mf-code-bg text-mf-code-fg` — the same surface and foreground as fenced code blocks (code editor colors). The prototype uses a warm-chip style: T.raised (--mf-raised, warm secondary fill) for background and a warm brown color (#7a4d2a) that is visually distinct from both body text and fenced code. The inline code reads as an editor snippet instead of a highlighted term.  
*Fix:* Change inline code to `bg-mf-raised text-mf-code-str` (the closest named token to warm brown, or add a new `--mf-inline-code-fg` token). Keep `rounded-sm border border-border px-1.5 py-0.5 font-mono text-[0.88em]`.  
<sub>verify: markdown-text.tsx:58 inline code uses `bg-mf-code-bg text-mf-code-fg`; prototype spec is `T.raised` (–mf-raised) background with warm-brown (#7a4d2a) text</sub>  

**🟡 minor — Task list items: native browser checkbox instead of styled warm-chrome checkbox**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:272 (remark-gfm renders input[type=checkbox], no override provided)`  
*Artboard:* 08-markdown.jsx MdBlock list task items: 15×15px custom checkbox (borderRadius 4, 1.5px border with T.text4/T.green, accent fill when checked, checkmark icon); checked items have line-through in T.text4  
*Drift:* remark-gfm renders task list checkboxes as `<input type='checkbox' disabled>` native browser elements. No `input` component override is present in markdownComponents. The prototype renders a fully styled custom checkbox with the warm-chrome design language (rounded square, accent fill, custom checkmark icon, line-through on checked items).  
*Fix:* Add an `input` component override in markdownComponents that intercepts `type='checkbox'` and renders the warm-chrome styled checkbox: a span with conditional accent fill, 15×15px, rounded-sm, border-mf-text-4 / border-mf-success, and a CheckIcon when checked.  
<sub>verify: markdown-text.tsx line 262 (pre override) and markdownComponents export (no input override) — remark-gfm renders native `<input type='checkbox'>` with no custom styled replacement</sub>  

**🟡 minor — MarkerPill horizontal padding symmetric (12px) vs prototype asymmetric (9px left, 11px right)**  
`packages/app-tauri/src/features/chat/tools/cards/marker-pill.tsx:62`  
*Artboard:* 10-chatcards.jsx MarkerPill: padding '4px 11px 4px 9px' — 9px left, 11px right (icon sits 2px closer to edge)  
*Drift:* Built MarkerPill uses `px-3 py-1` (12px each side). Prototype uses asymmetric 9px left / 11px right padding. The difference (3px) is minor but makes the pill slightly wider than spec on the left side.  
*Fix:* Change `px-3` to `pl-2.5 pr-3` (10px left, 12px right as the closest Tailwind approximation to 9/11px).  
<sub>verify: marker-pill.tsx:62 MarkerPill uses `px-3 py-1` (symmetric 12px); prototype spec is asymmetric `padding: '4px 11px 4px 9px'` (9px left, 11px right)</sub>  

**🟡 minor — MarkerCapsLabel letter-spacing: tracking-normal resolves to 0 vs prototype 0.6**  
`packages/app-tauri/src/features/chat/tools/cards/marker-pill.tsx:99`  
*Artboard:* 10-chatcards.jsx MarkerCapsLabel: `letterSpacing: 0.6` (px) for ARGUMENTS / RESULT uppercase section labels  
*Drift:* Built `MarkerCapsLabel` uses `tracking-normal` which is defined as `--tracking-normal: 0` in globals.css @theme inline — zero letter-spacing. The prototype's CAPS labels use 0.6px letter-spacing. The uppercase labels appear more compressed than spec.  
*Fix:* Use `tracking-[0.04em]` (arbitrary value ~0.6px at 14px equivalent) or add `--tracking-caps: 0.06em` to @theme inline and use `tracking-caps`.  
<sub>verify: marker-pill.tsx:99 MarkerCapsLabel uses `tracking-normal`; globals.css:741 defines `--tracking-normal: 0`; prototype spec is 0.6px letter-spacing</sub>  

**🟡 minor — Table wrapper border-radius: rounded-lg (11px) vs prototype 8px**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:74`  
*Artboard:* 08-markdown.jsx MdTable outer div: borderRadius: 8  
*Drift:* Built table wrapper uses `rounded-lg` which resolves to 11px (calc(8+3) per the radius scale). The prototype uses 8px (rounded-md). Minor visual difference — 3px extra radius.  
*Fix:* Change `rounded-lg` to `rounded-md` in MarkdownTable.  
<sub>verify: markdown-text.tsx:74 MarkdownTable uses `rounded-lg` (11px); prototype spec is `borderRadius: 8`</sub>  

**🟡 minor — HR margin: my-3 (6px each side = 12px gap) vs prototype 2px each side**  
`packages/app-tauri/src/features/chat/parts/markdown-text.tsx:251`  
*Artboard:* 08-markdown.jsx MdBlock hr: `margin: '2px 0'` — used as a subtle divider between content blocks  
*Drift:* Built `<hr>` uses `my-3` (6px top + 6px bottom = 12px total vertical gap). The prototype uses 2px top and bottom, making the rule a subtle section marker rather than a large vertical spacer.  
*Fix:* Change `my-3` to `my-0.5` in the hr component to approximate the prototype's 2px margin.  
<sub>verify: markdown-text.tsx:251 hr uses `my-3` (6px top + 6px bottom = 12px); prototype spec is `margin: '2px 0'`</sub>  

<details><summary>Deferred (not drift) — 4</summary>

- Reasoning block 'Thought for Ns' label: daemon does not yet emit a thinking-duration field; the label falls back to 'Reasoning' — acknowledged known gap per CLAUDE.md, not a drift.
- WorktreeStatusPill, SchedulePill, MCPToolCard, SlashCommandCard, TaskGroupCard, TaskProgressCard: shown in the Chat Markers Review artboard but not yet built in app-tauri — these appear in the artboard under sections marked with dedicated tool cards (09-toolcards.jsx). Per MIGRATION-TRACKER.md these are part of the unbuilt tool-card family (ToolFallback/ToolGroup restyle is partially done; per-family cards are listed as deferred). Tracker reference: 'Build per-family cards (Edit/Write/Bash/Read/Grep/Todo/Web/MCP/Plan/Skill/Worktree/Schedule) as tools.by_name entries'.
- Unordered list markers: built uses standard list-disc (browser dots) vs prototype custom 5px circle dot. Minor deviation, no tracker entry found; deferred here as a density polish item.
- Inline code color: prototype uses a hardcoded warm-brown (#7a4d2a) that has no named token in the theme contract. A new `--mf-inline-code-fg` token would be needed — out of scope for a pure porter fix.

</details>

---

### Review diff panel  ·  12 findings (1B / 9M / 2m)

**🔴 **BLOCKER** — Duplicate close button from DialogContent primitive**  
`packages/app-tauri/src/components/ui/dialog.tsx:50-60 + packages/app-tauri/src/features/review/ReviewPanelHeader.tsx:21-29`  
*Artboard:* 07-review.jsx line 192-196 — one close button, positioned at the header's left edge  
*Drift:* DialogContent unconditionally renders a DialogPrimitive.Close X-icon button (positioned absolute top-4 right-4). ReviewPanelHeader renders a second X-icon close button in the flex header row. With the ReviewPanel's p-0 / flex-col layout, both buttons are simultaneously visible — the Dialog primitive's floats at the top-right corner overlapping the content, while the header's sits inline at the right of the header bar. The prototype has exactly one close button.  
*Fix:* Either (a) add a DialogClose sub-component that wraps ReviewPanelHeader's button so Radix considers it the canonical close trigger and remove the duplicate from DialogContent, or (b) extract a DialogContentNoClose variant that omits the built-in close element, and use it in ReviewPanel.  
<sub>verify: DialogPrimitive.Close renders at dialog.tsx:50-60 (absolute top-4 right-4) AND ReviewPanelHeader renders a separate XIcon close button at line 21-29; both are visible simultaneously</sub>  

**🟠 Major — Header close-button position inverted; accent icon and branch chip absent**  
`packages/app-tauri/src/features/review/ReviewPanelHeader.tsx:16-31`  
*Artboard:* 07-review.jsx lines 188-214 — header layout is [X close] [diff-icon + 'Review Changes'] [branch chip] [spacer] [file+line totals] [viewed progress]; close is leftmost child  
*Drift:* Built header uses justify-between with the title stack on the LEFT and the close button on the RIGHT, reversing the prototype's order. The prototype's 'diff' icon before the title is absent. The branch chip (mf-chip bg pill with a branch icon and branch name) is replaced by a plain text worktree path label with no chip container styling. The file-count / totals summary (+N −N) and the viewed-progress indicator (N/total viewed, with a checkmark when allViewed) in the header are entirely missing.  
*Fix:* Restructure ReviewPanelHeader to: (1) put close button first (leftmost); (2) add a GitFork or diff icon (lucide GitBranch / FileDiff) sized 16 before the title; (3) wrap the branch/worktree label in a chip pill (bg-mf-chip, rounded-md, px-2 py-0.5, monospace 11px, with a GitBranch icon at 11px); (4) add a spacer then a files/totals summary (requires passing totals from ReviewPanel); (5) add a viewed count display once viewed state is tracked.  
<sub>verify: ReviewPanelHeader uses justify-between with title on LEFT and close button on RIGHT (reversed from prototype); missing diff icon, branch chip, file/del stats, and viewed progress entirely</sub>  

**🟠 Major — File tree 'Changed files' section header missing**  
`packages/app-tauri/src/features/review/ReviewFileTree.tsx:31-54 (no section header rendered)`  
*Artboard:* 07-review.jsx line 220 — uppercase 10px label 'CHANGED FILES' with font-weight 700 and letter-spacing 0.6 above the file list  
*Drift:* The prototype renders a section header 'Changed files' (10px, weight 700, text-mf-text-3, uppercase, tracking-wide) above the scrollable file list. The built ReviewFileTree renders nothing before the file list rows — no label, no divider, no header.  
*Fix:* Add a section header div above the file list: class 'px-3.5 pt-3 pb-1.5 text-micro font-bold text-mf-text-3 uppercase tracking-wide shrink-0'.  
<sub>verify: ReviewFileTree renders file list at line 32 with no header element or text above it; prototype has 'CHANGED FILES' header at line 220</sub>  

**🟠 Major — File-tree left panel background not differentiated from diff pane**  
`packages/app-tauri/src/features/review/ReviewPanel.tsx:83 (div with w-64 — no bg class)`  
*Artboard:* 07-review.jsx line 219 — file list column explicit bg = T.content2 (#f8f6f2 = var(--mf-content2)); diff view explicit bg = T.content (#fff = var(--background))  
*Drift:* The prototype creates a two-tone split: file-list column uses T.content2 (warm slightly-raised surface), diff view uses T.content (white). In the built code the left column div has no background class, so it inherits bg-popover (#ffffff in light) from DialogContent — same as the diff pane. The visual separation is lost.  
*Fix:* Add 'bg-card' (= var(--card) = var(--mf-content2) equivalent) to the left column div at ReviewPanel.tsx:83. If the theme maps bg-card = #f8f6f2 already (it does in globals.css), that is the correct token.  
<sub>verify: ReviewPanel left column at line 83 has no background class; inherits bg-popover white from DialogContent, losing visual separation from the diff pane</sub>  

**🟠 Major — File-tree row layout is single-line; prototype uses a two-line name/directory layout**  
`packages/app-tauri/src/features/review/ReviewFileTree.tsx:43-49`  
*Artboard:* 07-review.jsx lines 232-235 — each row has a flex-col sub-div with filename on top (monospace 12px, weight 500/600) and directory path below (10px, text-mf-text-3); prototype row padding is 7px top/bottom giving ~36px total height  
*Drift:* Built rows are fixed h-[22px] single-line: badge | truncated filename | full path right-aligned (ml-auto). Prototype rows are taller two-line: badge | [filename / directory] | stat bar. The directory context (which subdirectory the file is in) is hidden in the built design's right-aligned tiny path. The selected-file font-weight promotion (weight 600 when active, 500 otherwise) is also absent.  
*Fix:* Replace the fixed h-[22px] row with a py-1.5 px-2.5 rounded-md layout. Inside the name column use a flex-col: top line = filename (font-mono text-label font-medium, text-foreground, group-active font-semibold); bottom line = directory (text-micro text-mf-text-3 truncate). Remove the right-aligned full-path span.  
<sub>verify: ReviewFileTree rows are fixed h-[22px] single-line (line 43); prototype rows are two-line with filename/directory flex-col layout (prototype lines 232-235)</sub>  

**🟠 Major — Selected-file row uses bg-accent (hover tint) instead of bg-mf-selection (primary tint)**  
`packages/app-tauri/src/features/review/ReviewFileTree.tsx:43 (isSelected ? 'bg-accent text-foreground' : '')`  
*Artboard:* 07-review.jsx line 228 — active row bg = ACCENT + '16' (the primary brand color at ~9% opacity), which equals --mf-selection token  
*Drift:* bg-accent resolves to rgba(0,0,0,0.04) in classic-light — essentially invisible. The prototype uses the brand-tinted primary-selection color (--mf-selection = rgba(10,132,255,0.10) in classic-light). The selected row is visually indistinguishable from unselected on light themes.  
*Fix:* Replace 'bg-accent' in the selected conditional with 'bg-mf-selection'. Also replace the hover:bg-accent on non-selected rows with 'hover:bg-accent' which is correct for hover — only the selected state needs the fix.  
<sub>verify: ReviewFileTree selected row uses 'bg-accent' (rgba(0,0,0,0.04)) at line 43; prototype uses ACCENT + '16' (--mf-selection, rgba(10,132,255,0.10)) at line 228</sub>  

**🟠 Major — Status badge lacks tinted-background pill container**  
`packages/app-tauri/src/features/review/ReviewFileTree.tsx:44-46`  
*Artboard:* 07-review.jsx line 231 — status letter rendered in a 16×16 rounded-sm square, background = status-color + '1f' opacity tint (e.g. #28a74530 for Added), colored letter, font-weight 800  
*Drift:* Built renders a bare 'w-3' span with only a text color class. The prototype renders a 16×16 badge container with a tinted colored background (alpha ~12%), colored text at weight 800. The badge reads as a colored letter floating in space rather than the pill-badge visual the prototype intends.  
*Fix:* Wrap the status letter in an inline-flex span: 'w-4 h-4 shrink-0 rounded-sm inline-flex items-center justify-center text-micro font-extrabold' with a tinted bg. For each status, use color-mix or the existing mf-diff tokens: added = 'bg-mf-diff-add-bg text-mf-diff-add-text', deleted = 'bg-mf-diff-del-bg text-mf-diff-del-text', modified/renamed = 'bg-mf-warning-tint text-mf-warning'.  
<sub>verify: ReviewFileTree badge is bare 'w-3 flex-shrink-0' span with only text color (lines 44-46); prototype is 16×16 rounded container with tinted background at ~12% opacity (line 231)</sub>  

**🟠 Major — Per-file 'Viewed' state entirely absent — no checkbox, no tracking, no line-through, no progress**  
`packages/app-tauri/src/features/review/ReviewPanel.tsx (no viewed state), ReviewFileTree.tsx (no isViewed prop), ReviewDiffView.tsx (no Viewed control)`  
*Artboard:* 07-review.jsx lines 161, 178-179, 210-213, 228, 233, 260-269 — 'Viewed' toggle checkbox in file toolbar, viewed files get line-through on filename + 0.55 opacity in file tree, header shows N/total viewed progress with checkmark when allViewed  
*Drift:* The prototype tracks which files have been marked reviewed (local state per modal open). Viewed files get a strikethrough on their filename in the file tree and reduced opacity. The diff toolbar has a 'Viewed' checkbox that toggles viewed state. The header counts viewed/total. None of this exists in the built code.  
*Fix:* Add a 'viewed: Set<string>' state to ReviewPanel (reset on open). Pass toggleViewed and isViewed into ReviewFileTree (strikethrough + opacity-60 when viewed and not selected). Add a Viewed toggle button/label above the CmDiffEditor in ReviewDiffView (or a new file-toolbar row). Thread viewed totals to ReviewPanelHeader for the N/total display.  
<sub>verify: ReviewPanel has no viewed state tracking (line 32 missing); ReviewFileTree has no isViewed prop or strikethrough logic; ReviewDiffView has no Viewed toggle; prototype has full viewed state at lines 161, 178-179, 228, 233, 260-269</sub>  

**🟠 Major — File-specific toolbar above the diff view is entirely absent**  
`packages/app-tauri/src/features/review/ReviewDiffView.tsx:93-145 (no file toolbar rendered above CmDiffEditor)`  
*Artboard:* 07-review.jsx lines 246-270 — a 40px toolbar bar above the diff: filename (monospace 12px bold) + directory path (text-mf-text-4) + +N/-N stats (green/red) + spacer + 'Open in workspace' outlined button (26px, pop icon) + 'Viewed' toggle label (26px, checkbox + text)  
*Drift:* The built ReviewDiffView goes directly from a loading/error state to the CmDiffEditor filling the full height. There is no per-file header bar. The prototype's file toolbar provides filename context, per-file add/del stats, a quick-open shortcut, and the Viewed toggle. Without it the diff view has no file context label and no way to open the file in the editor from the review modal.  
*Fix:* Add a 40px shrink-0 div above the CmDiffEditor (inside the flex-col wrapper in ReviewDiffView): left side = filename (font-mono text-label font-semibold text-foreground) + dir (text-micro text-mf-text-4); spacer; right side = an 'Open in editor' ghost button (emits an open-file intent, using ExternalLink or ArrowUpRight lucide icon at 12px); and the Viewed toggle (once review-panel-8 is fixed). Note the +N/-N stats require add/del counts from the daemon diff response — expose them from WorkingDiff if available.  
<sub>verify: ReviewDiffView renders error/loading/editor directly (lines 93-145); no file toolbar above CmDiffEditor; prototype has 40px toolbar with filename, directory, stats, Open button, Viewed toggle at lines 246-270</sub>  

**🟠 Major — Commit rail (right-side 280px panel) entirely absent**  
`packages/app-tauri/src/features/review/ReviewPanel.tsx:81-103 (three-column layout has only two columns: file tree + diff; no commit rail)`  
*Artboard:* 07-review.jsx lines 279-328 — right-side 280px panel with 'Commit' heading, commit-message textarea, AI-suggested message chips, unreviewed-files amber warning, disabled commit button (enabled only when textarea has text), committed success state  
*Drift:* The prototype has a three-column layout (file tree 264px | diff flex | commit rail 280px). The built code has two columns (file tree 256px | diff flex). The commit rail is entirely missing. This is the primary call-to-action of the Review panel — the user reviews files and then commits from this panel. Its absence makes the review panel read-only with no outcome action.  
*Fix:* Add a third column (w-[280px] shrink-0 bg-card border-l border-border flex flex-col p-4) to ReviewPanel. Render a commit message textarea, AI-suggested message chips sourced from git log / AI generation (or static starters), an amber warning when not all files are viewed (ties to review-panel-8), and a Commit button that calls a git commit API endpoint. The committed-success state (green check + 'Changes committed' + file/line count + Done button) is also needed.  
<sub>verify: ReviewPanel has two-column layout (file tree + diff at lines 81-103); commit rail entirely missing; prototype has three-column layout with 280px commit rail at lines 279-328</sub>  

**🟡 minor — First changed file not auto-selected on open**  
`packages/app-tauri/src/features/review/ReviewPanel.tsx:40 (setSelectedFile(null))`  
*Artboard:* 07-review.jsx line 166 + 181 — useEffect on open sets sel = RV_FILES[0].f (first file auto-selected); scrollRef reset; 'Select a file to review' empty-state never shown  
*Drift:* Prototype auto-selects the first file when the modal opens, immediately showing a diff. The built code initializes selectedFile to null and shows 'Select a file to review' until the user clicks a row. The empty-state is an extra navigation step not in the prototype.  
*Fix:* After setFiles(gitStatusToFiles(statusFiles)) in the useEffect, set the first file as selected: if (files.length > 0 && !selectedFile) setSelectedFile(files[0].path). Or pass the files result to a setter that also sets selectedFile to result[0]?.path ?? null.  
<sub>verify: ReviewPanel sets selectedFile to null on open (line 40); shows 'Select a file to review' empty state; prototype auto-selects RV_FILES[0].f at line 166</sub>  

**🟡 minor — Modal container background warm mismatch (bg-popover vs bg-mf-window)**  
`packages/app-tauri/src/components/ui/dialog.tsx:36 (bg-popover = #ffffff in classic-light)`  
*Artboard:* 07-review.jsx line 186 — outer modal div background = T.windowBg = #e9e7e2 (--mf-window), giving a warm chrome feel at the rounded-corner edges  
*Drift:* The built DialogContent uses bg-popover (#ffffff in classic-light), so the rounded-corner chrome of the modal is white. The prototype uses the warm window background (#e9e7e2) as the modal shell color, creating a warm-chrome outer border visible at the rounded corners. The effect is subtle but visible: prototype modal edges are warm/cream, built modal edges are white.  
*Fix:* Override the DialogContent bg in ReviewPanel: add 'bg-mf-window' or 'bg-card' to the DialogContent className. bg-card (#f8f6f2) is the closest available token and visible at the rounded-xl edge between the file-tree and the modal border.  
<sub>verify: DialogContent uses bg-popover (#ffffff) at dialog.tsx:36; prototype uses T.windowBg (#e9e7e2 warm chrome) at 07-review.jsx:186, visible at rounded-corner modal edges</sub>  

<details><summary>Deferred (not drift) — 3</summary>

- Stat bars (RvStat 5-square +N/−N proportion meter) per file row in the file tree: the daemon's git status API only returns {path, status} — no per-file add/del line counts — so this visual element cannot be built without a daemon API extension (a new numstat endpoint or adding counts to the status response).
- Commit rail AI-suggested message chips (context-aware commit message suggestions): requires either a local heuristic or an AI call — the data source does not exist yet in the daemon.
- FullviewModal: dropped per tracker completion note (2026-06-15), gated on plugins-UI re-platform.

</details>

---

### File viewers & editor chrome  ·  18 findings (0B / 12M / 6m)

**🟠 Major — Checkerboard backdrop uses wrong token family (mf-checker-* instead of mf-viewer-check-*)**  
`packages/app-tauri/src/features/viewers/ImageViewer.tsx:68, SvgViewer.tsx:112`  
*Artboard:* 15-viewers.jsx lines 100-105 — CHECKER object uses T.viewerCheckA (#efece6 warm cream) as bg-color and T.viewerCheckB (#dcd8d0 warm tan) in gradients. The prototype's mf-viewer-check-a/b tokens are warm-cream toned to match the viewer matte.  
*Drift:* Code uses `--mf-checker-dark` (#e5e7eb cool gray) and `--mf-checker-light` (#f9fafb cool white) — these are defined for chat in-message image previews, not the viewer surface. The warm cream checker from --mf-viewer-check-a/b is the spec. Additionally the code uses `repeating-conic-gradient` at 16px tile; the prototype uses 4 `linear-gradient` passes at 18px tile — the two approaches produce visually distinct patterns.  
*Fix:* Replace `var(--mf-checker-dark)` / `var(--mf-checker-light)` with `var(--mf-viewer-check-a)` / `var(--mf-viewer-check-b)` in both ImageViewer and SvgViewer. Change tile size from 16px to 18px. Use the 4-gradient linear-gradient technique: `background-color: var(--mf-viewer-check-a); background-image: linear-gradient(45deg, var(--mf-viewer-check-b) 25%, transparent 25%), linear-gradient(-45deg, ...) background-size: 18px 18px; background-position: 0 0, 0 9px, 9px -9px, -9px 0`.  
<sub>verify: ImageViewer.tsx:68 and SvgViewer.tsx:112 both use `--mf-checker-dark` and `--mf-checker-light` with 16px tile size; globals.css lines 84-85 define the correct warm-toned `--mf-viewer-check-a` and `--mf-viewer-check-b` tokens and 18px is the spec.</sub>  

**🟠 Major — ImageViewer missing Fit/100% header toggle and zoom in/out buttons**  
`packages/app-tauri/src/features/viewers/ImageViewer.tsx:62-83`  
*Artboard:* 15-viewers.jsx lines 232-238 — ImageViewer passes a `right` slot to ViewerShell containing VBtn zoom-out, VBtn zoom-in, and a VSeg Fit/100% toggle with state (setFit/setZoom). The artboard shows these controls inline in the 24px breadcrumb header.  
*Drift:* The built ImageViewer passes no `actions` prop to ViewerShell. The header right slot is empty. There is no Fit/100% mode, no zoom in/out buttons, and no zoom level display. Only a click-to-dialog affordance via ZoomableImage exists.  
*Fix:* Add zoom state (`fit / actual`) and zoom level (0.25–4×) to ImageViewer. Pass to ViewerShell's `actions` prop: a zoom-out button (disabled when fit='fit'), a zoom-in button (disabled when fit='fit'), and a VSeg `Fit | 100%` segmented control. The image container should switch between `min(86%, {w}px)` width (fit mode) and `w * zoom` fixed width (actual mode). Pass zoom-state info to statusRight.  
<sub>verify: ImageViewer.tsx:62-83 passes only `path` and `status` to ViewerShell with no `actions` prop; no zoom state, no zoom buttons, no Fit/100% toggle rendered.</sub>  

**🟠 Major — ImageViewer missing white shadow-card behind the image on the checkerboard**  
`packages/app-tauri/src/features/viewers/ImageViewer.tsx:64-80`  
*Artboard:* 15-viewers.jsx lines 244-261 — ImageViewer wraps the image in a white card div: `background: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.12)'` with `position: relative; overflow: hidden`.  
*Drift:* Code renders the `<img>` directly on the checkerboard background with only `max-h-[80vh] max-w-full rounded object-contain`. There is no white backing card and no drop shadow. The image appears to float directly on the checkerboard with no visual separation.  
*Fix:* Wrap the `<img>` in a div with `bg-white shadow-[0_8px_30px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.12)] relative overflow-hidden` and size it dynamically based on fit/zoom state.  
<sub>verify: ImageViewer.tsx:74-80 renders `<ZoomableImage>` directly with only `max-h-[80vh] max-w-full` classes; no white card wrapper, no shadow, image floats directly on checkerboard.</sub>  

**🟠 Major — SvgViewer Preview/Source toggle placed in a separate sub-bar instead of the ViewerShell header right slot**  
`packages/app-tauri/src/features/viewers/SvgViewer.tsx:74-95, 101`  
*Artboard:* 15-viewers.jsx line 275 — SvgViewer passes `right={<VSeg ...>}` to ViewerShell. The VSeg renders inside the 24px breadcrumb header row, right-aligned before the separator and reveal button.  
*Drift:* The `toggleBar` is rendered as a separate 30px div child inside the ViewerShell body (with its own border-bottom), not passed as `actions` to ViewerShell. This adds an extra visual bar below the breadcrumb header, making the chrome taller than the spec and duplicating the separator line.  
*Fix:* Remove the standalone `toggleBar` div. Instead, pass the two toggle buttons (or a VSeg-equivalent segmented control) via the `actions` prop of ViewerShell. The buttons should sit inline in the 24px header between the flex-1 spacer and the reveal separator.  
<sub>verify: SvgViewer.tsx:74-95 renders `toggleBar` as separate 30px flex div with `[border-bottom:0.5px_solid_var(--border)]` inside the body (line 101), not passed as `actions` to ViewerShell header.</sub>  

**🟠 Major — SvgViewer source mode <pre> has no mf-code-bg background; body bg does not switch per mode**  
`packages/app-tauri/src/features/viewers/SvgViewer.tsx:118-123`  
*Artboard:* 15-viewers.jsx lines 274, 287-289 — SvgViewer sets `bodyBg={mode === 'preview' ? T.viewerMatte : T.codeBg}` on ViewerShell (the outer wrapper changes bg). In source mode the background is T.codeBg (mf-code-bg) with T.codeFg text.  
*Drift:* The `<pre>` in source mode has only `text-foreground` with no explicit background — it inherits the parent's transparent background, showing whatever the surface pane bg is (white). The text color is `text-foreground` (primary dark text) rather than `text-mf-code-fg` (the editor-specific code fg token). The warm code-editor look of the source view is absent.  
*Fix:* Add `bg-mf-code-bg text-mf-code-fg` to the `<pre>` className in source mode. Optionally, pass a `bg-mf-code-bg` class on the ViewerShell's body wrapper div when in source mode (requires adding a `bodyClassName` prop to ViewerShell or handling it in the children container).  
<sub>verify: SvgViewer.tsx:118-123 renders `<pre>` with `text-foreground` only, no `bg-mf-code-bg` or `text-mf-code-fg`; ViewerShell body container (ViewerShell.tsx:77) has no background styling.</sub>  

**🟠 Major — SvgViewer preview mode missing white rounded card with shadow behind the SVG**  
`packages/app-tauri/src/features/viewers/SvgViewer.tsx:107-116`  
*Artboard:* 15-viewers.jsx lines 280-284 — SvgViewer preview renders SVG inside a `260×260 white div` with `borderRadius:11, boxShadow: '0 8px 30px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.1)', padding:36`.  
*Drift:* Code renders `<img src={objectUrl} ...>` directly on the checkerboard with `max-h-full max-w-full object-contain`. There is no white card container, no shadow, and no 36px internal padding. The SVG sits directly against the checkerboard.  
*Fix:* Wrap the `<img>` in a div with `w-64 h-64 bg-white rounded-[11px] shadow-[0_8px_30px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.1)] flex items-center justify-center p-9` (36px = 9 * 4px Tailwind scale = p-9). The img inside should be `w-full h-full object-contain`.  
<sub>verify: SvgViewer.tsx:115 renders `<img>` directly inside checkerboard div with `max-h-full max-w-full`; no white rounded card container, no shadow, no padding.</sub>  

**🟠 Major — CsvViewer filter input placed in a separate sub-bar instead of the ViewerShell header right slot**  
`packages/app-tauri/src/features/viewers/CsvViewer.tsx:91-105`  
*Artboard:* 15-viewers.jsx lines 163-170 — CsvViewer passes a `right` slot to ViewerShell containing a 20px chipBg chip with a magnifying-glass icon and a 96px fixed-width filter input, all inline in the 24px breadcrumb header.  
*Drift:* The filter is rendered in a separate `div` with `flex shrink-0 items-center gap-2 [border-bottom:...] px-3 py-1.5` — a full-width bar below the header. The input is `h-6 flex-1 rounded border` style. This adds an extra bar to the chrome, increasing height and diverging from the compact chip-in-header design.  
*Fix:* Remove the separate filter bar. Pass a compact filter chip as the `actions` prop to ViewerShell: an inline-flex div with `h-5 px-2 rounded-md bg-mf-chip gap-1 items-center` containing a magnifier icon (10px) and an unstyled `<input>` (96px fixed, no border, transparent bg, text-label). The rows count should move to the `statusRight` slot of ViewerShell.  
<sub>verify: CsvViewer.tsx:91-105 renders filter bar as separate 30px div with `[border-bottom:0.5px_solid_var(--border)]`, not passed as `actions` to ViewerShell header; adds extra chrome bar.</sub>  

**🟠 Major — All viewers collapse status into a single left-aligned string; the statusRight slot is unused**  
`packages/app-tauri/src/features/viewers/viewer-status.ts:37,47,68 and callers in CsvViewer.tsx:85, ImageViewer.tsx:52, SvgViewer.tsx:70`  
*Artboard:* 15-viewers.jsx lines 117-118, 173, 241, 277, 314 — prototype uses two slots: `status` (left, file-type + encoding) and `statusRight` (right-aligned, dynamic values like word count, row count, file size, zoom %). E.g. CSV: `status='CSV · UTF-8'` / `statusRight='N rows · M cols'`.  
*Drift:* All formatters pack everything into a single string passed to the `status` prop; `statusRight` is never passed by any viewer. This means all metadata is left-aligned in a single block instead of split left/right across the footer. Additionally: `formatCsvStatus` omits the UTF-8 encoding label; `formatImageStatus` omits the fit/zoom state; `formatMarkdownStatus` omits the UTF-8 label.  
*Fix:* Split the formatters into two parts and have each viewer pass the file-type/encoding to `status` and the dynamic metadata (word count, row count, file size, zoom %) to `statusRight` on ViewerShell.  
<sub>verify: CsvViewer.tsx:85 passes only `status` prop to ViewerShell with no `statusRight`; formatCsvStatus (viewer-status.ts:36-37) includes 'UTF-8' but caller never splits or uses statusRight; ImageViewer.tsx:52 and SvgViewer.tsx:70 also omit statusRight.</sub>  

**🟠 Major — MarkdownPreview missing max-width centering column (720px, mx-auto) and prototype padding**  
`packages/app-tauri/src/features/editor/MarkdownPreview.tsx:104-107`  
*Artboard:* 15-viewers.jsx line 121 — MarkdownViewer preview renders its content in `{ maxWidth: 720, margin: '0 auto', padding: '36px 40px 64px', color: T.text }` — a centered 720px prose column with generous top/side/bottom breathing room.  
*Drift:* MarkdownPreview renders `<div className="mf-editor-selectable h-full overflow-auto px-6 py-4">` — no `max-w-[720px]`, no `mx-auto`. Content spans full surface width regardless of pane size. Padding is 24px H / 16px V vs the spec's 40px H / 36px top / 64px bottom.  
*Fix:* Add `max-w-[720px] mx-auto` to the inner content wrapper and adjust padding to `px-10 pt-9 pb-12` (closest Tailwind equivalents to 40px / 36px / 64px — adjust if custom spacing is available).  
<sub>verify: MarkdownPreview.tsx:105 has `px-6 py-4` (24px H / 16px V); spec requires `px-10 pt-9 pb-12` (40px H / 36px top / 64px bottom) and `max-w-[720px] mx-auto` centering wrapper missing.</sub>  

**🟠 Major — MarkdownEditorTab in preview mode renders a full duplicate ViewerShell chrome bar (breadcrumb + footer)**  
`packages/app-tauri/src/features/editor/MarkdownEditorTab.tsx:39-61, 79-81`  
*Artboard:* 15-viewers.jsx lines 115-130 — MarkdownViewer uses a SINGLE ViewerShell with the Preview/Source toggle in the header `right` slot. One 24px header bar + one 20px footer bar total.  
*Drift:* In preview mode the component stacks: (1) a 30px toggle sub-bar (bg-mf-tab-bar, 0.5px border-bottom) PLUS (2) a full ViewerShell (24px breadcrumb header + content + 20px footer). This gives 74px of chrome bars instead of 44px, and shows a second breadcrumb header the user did not expect. In edit mode there is NO ViewerShell at all (no breadcrumb, no status footer), which also diverges from the spec.  
*Fix:* Restructure so the toggle is passed as `actions` into a single persistent ViewerShell wrapping both modes. In edit mode the CmEditor fills the ViewerShell body; in preview mode the MarkdownPreview does. The ViewerShell breadcrumb and status footer are always visible.  
<sub>verify: MarkdownEditorTab.tsx:35 defaults to `useState<Mode>('edit')` not 'preview'; lines 39-62 render separate 30px toggle bar, then lines 79-81 in preview mode render full ViewerShell with breadcrumb and status footer creating duplicate chrome bars.</sub>  

**🟠 Major — UnsupportedViewer card uses bg-mf-tab-bar instead of bg-background (T.content)**  
`packages/app-tauri/src/features/viewers/UnsupportedViewer.tsx:56`  
*Artboard:* 15-viewers.jsx line 345-347 — UnsupportedViewer card: `background: T.content` (= `--background`, white/content surface). The artboard shows a clean white card on a slightly raised muted body area (bodyBg = T.content2).  
*Drift:* `className="... bg-mf-tab-bar ..."` — `--mf-tab-bar` is the warm chrome strip color (#f3f0ea in classic-light), not a content surface. The card reads as a warm bar band rather than a clean white floating card.  
*Fix:* Change `bg-mf-tab-bar` to `bg-card` (or `bg-background`) on the card div to match T.content from the prototype.  
<sub>verify: UnsupportedViewer.tsx:56 has `bg-mf-tab-bar` on the card; prototype line 345 shows card should have `background: T.content` (white), not warm chrome tab bar.</sub>  

**🟠 Major — UnsupportedViewer 'Open externally' button uses outline/secondary style instead of primary accent fill**  
`packages/app-tauri/src/features/viewers/UnsupportedViewer.tsx:65-72`  
*Artboard:* 15-viewers.jsx line 356 — 'Open externally' button: `background: ACCENT, color: '#fff', border: 'none', fontWeight: 600` — a filled primary CTA button using the accent color.  
*Drift:* `className="rounded-md border border-border bg-transparent ..."` — the button is rendered as an outline/ghost style matching the 'Reveal in tree' secondary button. The prototype differentiates the two with a clear primary/secondary hierarchy.  
*Fix:* Change 'Open externally' button to `className="rounded-md bg-primary px-3 py-1.5 text-label font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"`. Keep 'Reveal in tree' as the outline style.  
<sub>verify: UnsupportedViewer.tsx:71 has outline button style `border border-border bg-transparent`; prototype line 356 shows 'Open externally' should be `background: ACCENT, color: '#fff'` filled primary CTA style.</sub>  

**🟡 minor — CsvViewer sticky thead uses bg-background instead of bg-mf-content2**  
`packages/app-tauri/src/features/viewers/CsvViewer.tsx:115`  
*Artboard:* 15-viewers.jsx line 178 — CSV `<th>` elements use `background: T.content2` (= `--mf-content2` = warm raised card, #f8f6f2) for the sticky header row.  
*Drift:* `className="sticky top-0 bg-background"` on `<thead>`. `bg-background` is pure white (#ffffff in classic-light). The prototype's T.content2 / mf-content2 (#f8f6f2) gives the sticky header a subtle warm lift over the content rows.  
*Fix:* Change `bg-background` to `bg-mf-content2` on the `<thead>` element.  
<sub>verify: CsvViewer.tsx:115 has `<thead className="sticky top-0 bg-background">` using `bg-background` (white); should be `bg-mf-content2` per prototype line 178.</sub>  

**🟡 minor — CsvViewer sort arrows are plain text ↑/↓ instead of accent-colored ▲/▼ spans**  
`packages/app-tauri/src/features/viewers/CsvViewer.tsx:137-139`  
*Artboard:* 15-viewers.jsx lines 190-191 — sort active state renders `<span style={{ color: ACCENT, fontSize: 10 }}>▲</span>` or `▼`, accent-colored (`--primary`).  
*Drift:* Code appends `' ↑'` or `' ↓'` as plain strings to the header text with no accent color. The up/down arrows are the same muted/foreground color as the header text itself, losing the visual distinction that marks the active sort column.  
*Fix:* Render a `<span className="text-primary ml-1">▲</span>` (or ▼) as a sibling of the header text when the column is the active sort column, instead of appending a string character.  
<sub>verify: CsvViewer.tsx:137-138 appends `' ↑'` and `' ↓'` as plain string literals with no color; no `<span>` wrapper with accent color or Unicode ▲/▼ glyphs.</sub>  

**🟡 minor — MarkdownEditorTab toggle labels are 'Edit / Preview' instead of 'Preview / Source'**  
`packages/app-tauri/src/features/editor/MarkdownEditorTab.tsx:43-59`  
*Artboard:* 15-viewers.jsx line 116 — MarkdownViewer VSeg options: `[{ id: 'preview', label: 'Preview' }, { id: 'source', label: 'Source' }]`. The default mode is 'preview' (rendered markdown).  
*Drift:* Toggle labels are 'Edit' (CM6 editor) and 'Preview' (rendered markdown), with 'edit' as the default mode. The artboard labels are 'Preview' (default) and 'Source' (raw text). The production component adds editing capability so 'Edit' is intentional, but the default-open mode (Edit vs Preview) and the label for raw text ('Source' vs 'Edit') diverge from the artboard's viewer-first intent.  
*Fix:* Default to 'preview' mode (rendered markdown) and rename the source/edit label to 'Source' to match the artboard. For edit mode (CM6), 'Edit' is acceptable as an extension label if the team prefers it; the default-open state is the more important fix.  
<sub>verify: MarkdownEditorTab.tsx:49 and 58 render 'Edit' and 'Preview' buttons with 'edit' as default (line 35); prototype lines 116 show 'Preview' and 'Source' labels with 'preview' as default.</sub>  

**🟡 minor — UnsupportedViewer icon missing 46×46 chip container; uses wrong icon and oversized icon**  
`packages/app-tauri/src/features/viewers/UnsupportedViewer.tsx:57`  
*Artboard:* 15-viewers.jsx lines 348-350 — UnsupportedViewer shows a 46×46 rounded (borderRadius:11) chip container (`background: T.chipBg`) containing `Icon name='doc' size={22}`. The chip is a distinct framed icon holder.  
*Drift:* Code uses `<FileX size={32} className="text-mf-text-3" />` directly — no chip container. `FileX` is the wrong lucide icon (shows a broken-file-with-X, not the neutral doc icon), and 32px > the spec's 22px. Without the chip container the icon has no visual bounding.  
*Fix:* Wrap with `<div className="w-[46px] h-[46px] rounded-[11px] bg-mf-chip grid place-items-center mx-auto mb-3.5">` and use `<File size={22} className="text-mf-text-3" />` (`File` from lucide is the closest to prototype's 'doc' icon).  
<sub>verify: UnsupportedViewer.tsx:57 renders `<FileX size={32}>` directly with no chip container; should use `<File size={22}>` inside a `w-[46px] h-[46px] rounded-[11px] bg-mf-chip` chip per prototype lines 348-349.</sub>  

**🟡 minor — Segmented toggle active state is flat (bg-mf-tab-active only) — missing the 0.5px border shadow (raised card look)**  
`packages/app-tauri/src/features/viewers/SvgViewer.tsx:81, packages/app-tauri/src/features/editor/MarkdownEditorTab.tsx:47`  
*Artboard:* 15-viewers.jsx line 72 — VSeg active button: `background: T.content, boxShadow: '0 0 0 0.5px ${T.border}, 0 1px 1.5px rgba(0,0,0,0.06)'` — a subtle lifted card look.  
*Drift:* Active segment uses only `bg-mf-tab-active` with no shadow. The toggle looks flat; there is no hairline ring + micro-elevation that distinguishes the selected segment from the container.  
*Fix:* Add `shadow-[0_0_0_0.5px_var(--border),_0_1px_1.5px_rgba(0,0,0,0.06)]` to the active button class in both SvgViewer and MarkdownEditorTab.  
<sub>verify: SvgViewer.tsx:81 and MarkdownEditorTab.tsx:47 active button states only have `bg-mf-tab-active`, missing the `shadow-[0_0_0_0.5px_var(--border),_0_1px_1.5px_rgba(0,0,0,0.06)]` lifted card shadow per prototype line 72.</sub>  

**🟡 minor — cm-setup warmTheme sets dark:true unconditionally, incorrectly flags the theme as dark for CM6 internals**  
`packages/app-tauri/src/features/editor/cm-setup.ts:120`  
*Artboard:* 15-viewers.jsx / component-map.md §3 — 'Code editor: Monaco → defineTheme from --mf-code-*' — the tokens are CSS vars that adapt per mode. The prototype's code surface respects light vs dark automatically via the cascading vars.  
*Drift:* `EditorView.theme({ ... }, { dark: true })` hardcodes dark mode for CM6. In light mode this causes CM6 to apply its dark-mode baseline (dark bg assumptions for unfocused selection color, cursor visibility, etc.) on top of the CSS-var overrides. Some CM6-internal states that are not explicitly overridden (e.g. unfocused selection tint) will use dark-mode defaults regardless of the current app theme.  
*Fix:* Remove the `{ dark: true }` second argument. CM6 will default to light mode. Since the warmTheme already overrides every relevant color via CSS vars, removing `dark: true` will not regress dark-mode appearance but will fix light-mode subtleties.  
<sub>verify: cm-setup.ts:120 passes `{ dark: true }` as second argument to `EditorView.theme()`, hardcoding dark mode for CM6 internals regardless of current app theme setting.</sub>  

<details><summary>Deferred (not drift) — 3</summary>

- PDF viewer paged nav (prev/next, Fit/Width toggle, page indicator): The artboard shows a prototype-only paged mock renderer. Production correctly uses <embed> (native browser PDF renderer which provides its own pagination UI); no custom page-nav controls needed.
- reveal-file tree-scroll/highlight: tracker notes 'reveal-file tree-scroll TODO' as an open follow-up (logged in editor-leftovers 2026-06-13), not a visual drift in the viewer chrome itself.
- Shiki syntax highlighting in MarkdownPreview code blocks: tracker records this as done (lib/shiki-tokens.tsx), but 'yaml/toml/go/shell fall back to plaintext' — grammar coverage gap, not a visual drift in the viewer chrome.

</details>

---

### Window chrome & sessions sidebar  ·  13 findings (0B / 9M / 4m)

**🟠 Major — MainToolbar height is 38px but artboard specifies 40px**  
`packages/app-tauri/src/layout/MainToolbar.tsx:73`  
*Artboard:* 02-chrome.jsx MainToolbar line 124: `height: 40, flexShrink: 0`  
*Drift:* Built toolbar is `h-[38px]`; the artboard prototype MainToolbar renders at `height: 40`. The SidebarHeader is correctly 38px (artboard line 668), so only MainToolbar has the discrepancy — the two bands end up at different heights, breaking visual parity.  
*Fix:* Change `h-[38px]` to `h-[40px]` on the MainToolbar root div at line 73.  
<sub>verify: MainToolbar.tsx line 73 shows h-[38px]; artboard 02-chrome.jsx line 124 specifies height: 40</sub>  

**🟠 Major — SidebarFooter height is 28px (h-7) but artboard specifies 25px**  
`packages/app-tauri/src/layout/SidebarFooter.tsx:21`  
*Artboard:* 02-chrome.jsx Sidebar footer line 1065: `height: 25`  
*Drift:* Built footer uses `h-7` (28px); the artboard uses `height: 25`. The 3px surplus compresses session list area.  
*Fix:* Change `h-7` to `h-[25px]` on the SidebarFooterView root div.  
<sub>verify: SidebarFooter.tsx line 21 uses h-7 (28px Tailwind = 7*4px); artboard line 1065 specifies height: 25</sub>  

**🟠 Major — AnswerPill 'Answer ready' uses a tint background instead of solid amber fill with white text**  
`packages/app-tauri/src/features/sessions/sidebar/SessionRow.tsx:63`  
*Artboard:* 02-chrome.jsx SessionRowDense waiting pill lines 508-509: `background: s.unread ? T.amber : 'transparent'`, `color: s.unread ? '#fff' : T.amber`  
*Drift:* Artboard 'Answer ready' (unread waiting) pill has a SOLID amber background with white text. Built code uses `bg-mf-warning/15` (15% tint) with `text-mf-warning` amber text — looks similar to 'Your turn' and loses the assertive filled-chip visual that pulls the eye.  
*Fix:* Change the unread AnswerPill classname to `bg-mf-warning text-white` (solid fill, white text).  
<sub>verify: SessionRow.tsx lines 63 shows bg-mf-warning/15 with text-mf-warning; artboard lines 508–509 specifies solid amber background with white text</sub>  

**🟠 Major — AnswerPill 'Your turn' border is generic --border instead of 45%-opacity amber inset ring**  
`packages/app-tauri/src/features/sessions/sidebar/SessionRow.tsx:70`  
*Artboard:* 02-chrome.jsx SessionRowDense waiting pill line 510: `boxShadow: inset 0 0 0 1px rgba(T.amber, 0.45)`  
*Drift:* Artboard 'Your turn' uses a 45%-opacity amber inset box-shadow to give it an amber outline. Built code uses `[border:0.5px_solid_var(--border)]` — a generic hairline neutral border that loses amber identity.  
*Fix:* Remove the border utility and apply `shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--mf-warning)_45%,transparent)]` instead.  
<sub>verify: SessionRow.tsx line 70 uses [border:0.5px_solid_var(--border)] on 'Your turn' pill; artboard line 510 specifies inset 0 0 0 1px rgba(T.amber, 0.45)</sub>  

**🟠 Major — AnswerPill uses rounded-full (9999px) but artboard uses borderRadius 5px**  
`packages/app-tauri/src/features/sessions/sidebar/SessionRow.tsx:63 and 70`  
*Artboard:* 02-chrome.jsx SessionRowDense waiting pill line 506: `borderRadius: 5`  
*Drift:* Both AnswerPill variants use `rounded-full`. The artboard specifies `borderRadius: 5` — a small square-ish label chip, matching the design language of status chips in the rest of the chrome.  
*Fix:* Replace `rounded-full` with `rounded-[5px]` on both AnswerPill span elements.  
<sub>verify: SessionRow.tsx lines 63 and 70 both use rounded-full; artboard line 506 specifies borderRadius: 5</sub>  

**🟠 Major — Waiting-unread StatusDot uses animate-pulse instead of an expanding ping-halo ring**  
`packages/app-tauri/src/features/sessions/sidebar/SessionRow.tsx:41`  
*Artboard:* 02-chrome.jsx StatusDot lines 379-390: absolute halo span with `animation: 'tw-ping 1.9s cubic-bezier(0,0,0.2,1) infinite'`, scaling 0.6x to 2.3x while fading out — a beacon ring around the inner dot  
*Drift:* Built code uses a static shadow ring plus `animate-pulse` on the dot itself (opacity oscillation). The artboard renders a SEPARATE absolute element that expands outward and fades — a beacon/halo, not a breathing dot.  
*Fix:* Wrap the waiting-unread dot in a `relative` span; add a sibling `span` with `absolute inset-0 rounded-full bg-mf-warning animate-ping` (Tailwind's animate-ping matches the artboard's scale+fade). The inner dot stays non-animated and solid.  
<sub>verify: SessionRow.tsx line 41 uses animate-pulse shadow ring; artboard lines 379–390 shows separate absolute halo span with tw-ping animation scaling 0.6x to 2.3x</sub>  

**🟠 Major — Default sidebar width is 300px but artboard is 280px**  
`packages/app-tauri/src/layout/SidebarShell.tsx:7`  
*Artboard:* 02-chrome.jsx Sidebar root line 647: `width: 280`  
*Drift:* `SIDEBAR_EXPANDED_WIDTH = 300` — 20px wider than the artboard’s 280px. The extra width compresses the main surface pane and distorts the proportional layout.  
*Fix:* Change `SIDEBAR_EXPANDED_WIDTH` from 300 to 280.  
<sub>verify: SidebarShell.tsx line 7 sets SIDEBAR_EXPANDED_WIDTH = 300; artboard 02-chrome.jsx line 647 specifies width: 280</sub>  

**🟠 Major — SurfaceRail floor invariant always pins 'chat' instead of dynamically protecting the last lit toggle**  
`packages/app-tauri/src/layout/SurfaceRail.tsx:27`  
*Artboard:* 02-chrome.jsx SurfaceRail lines 549-553: `const litCount = order.filter(k => surfaces[k]).length; const isFloor = on && litCount === 1` — whichever surface is the only one lit is protected  
*Drift:* Built code hardcodes `const isFloor = id === 'chat'`. If a user has only Files or Run visible, that surface should become the non-dismissable floor; instead chat remains the hardcoded floor and the other remaining surface is togglable, allowing a zero-surface state.  
*Fix:* Compute `const litCount = SURFACES.filter(s => layout.top.includes(s.id) || layout.bottom === s.id).length; const isFloor = on && litCount === 1;` and use that for `disabled`.  
<sub>verify: SurfaceRail.tsx line 27 hardcodes const isFloor = id === 'chat'; artboard lines 549–553 compute based on litCount === 1 per whichever surface is last lit</sub>  

**🟠 Major — SidebarFooter 'working' count dot is static but artboard shows a pulse animation**  
`packages/app-tauri/src/layout/SidebarFooter.tsx:12`  
*Artboard:* 02-chrome.jsx Sidebar footer line 1081: `<span className='tw-pulse' ...>` — keyframe `0%,100% { opacity:1 } 50% { opacity:0.45 }`  
*Drift:* Working-count pip renders as a plain static dot (`bg-primary`). Artboard pulses it to signal live activity. The lack of animation makes it indistinguishable from the idle dot at a glance.  
*Fix:* Change the working COUNT_META dot to `'bg-primary animate-pulse'` so it oscillates opacity matching the artboard’s tw-pulse keyframe.  
<sub>verify: SidebarFooter.tsx line 12 shows working COUNT_META dot without animate-pulse; artboard line 1081 shows span with tw-pulse keyframe</sub>  

**🟡 minor — MainToolbar search button omits inline CMD+O keyboard hint chip**  
`packages/app-tauri/src/layout/MainToolbar.tsx:143-151`  
*Artboard:* 02-chrome.jsx MainToolbar lines 186-197: search button renders magnifying glass AND a styled `⌘O` kbd chip (17px tall, 0.5px border, subtle shadow)  
*Drift:* Built search button renders only `<Search size={14}/>`. The artboard shows a visible `⌘O` shortcut chip inline inside the button, providing discoverability and visual weight in the right cluster.  
*Fix:* Add `<span className='ml-1 inline-flex h-[17px] items-center rounded px-1.5 text-[11px] font-semibold leading-none text-muted-foreground [border:0.5px_solid_var(--border)] shadow-[0_1px_0_rgba(0,0,0,0.03)]'>⌘O</span>` inside the search button.  
<sub>verify: MainToolbar.tsx lines 143–151 show search button with only <Search> icon; artboard lines 186–197 show kbd chip with ⌘O inline</sub>  

**🟡 minor — Uppercase section labels have 0px letter-spacing; artboard uses 0.6-0.7px tracking**  
`packages/app-tauri/src/styles/globals.css:741 (`--tracking-normal: 0`); SessionSidebar.tsx:67; SessionGroup.tsx:33; TagFilterBar.tsx:110`  
*Artboard:* 02-chrome.jsx: 'Sessions' group header `letterSpacing: 0.6` (line 717), time-group sticky headers `letterSpacing: 0.7` (line 864), Tags label `letterSpacing: 0.6` (line 914)  
*Drift:* `tracking-normal` maps to 0 in the theme. All uppercase chrome labels (SESSIONS, TODAY/YESTERDAY/EARLIER, TAGS) use `tracking-normal` and render at 0px letter-spacing. Artboard specifies 0.6-0.7px positive tracking for legibility at 10px micro type.  
*Fix:* Define a `--tracking-caps` CSS var at `0.05em` in `:root` and map it as `--tracking-caps: var(--tracking-caps)` in @theme inline; then use `tracking-[0.05em]` (or a named utility) on the uppercase labels in SessionSidebar, SessionGroup, and TagFilterBar.  
<sub>verify: SessionGroup.tsx line 33 and SessionSidebar.tsx line 67 use tracking-normal on uppercase headers; globals.css line 741 maps --tracking-normal: 0; artboard specifies 0.6–0.7px</sub>  

**🟡 minor — TasksButton hover uses bg-mf-chip but sibling Settings and HideSidebar use bg-accent — inconsistent within the header cluster**  
`packages/app-tauri/src/layout/SidebarHeader.tsx:22 (TasksBtn: hover:bg-mf-chip) vs lines 36 and 52 (Settings+HideSidebar: hover:bg-accent)`  
*Artboard:* 02-chrome.jsx Sidebar header lines 688-705: all three icon buttons (Tasks, Settings, Hide) use the same hover `e.currentTarget.style.background = T.rowHover`  
*Drift:* TasksButton uses `hover:bg-mf-chip` (rgba 0,0,0,0.05) while the two sibling buttons use `hover:bg-accent` (rgba 0,0,0,0.04). The values are close but differ; more importantly, the artboard uses one unified hover surface for all three. Diverges noticeably in dark schemes where chip and accent differ more.  
*Fix:* Change TasksBtn to `hover:bg-accent` to match its siblings.  
<sub>verify: SidebarHeader.tsx line 22 TasksBtn uses hover:bg-mf-chip; lines 36 and 52 Settings and HideSidebar use hover:bg-accent; artboard line 688–705 uses unified T.rowHover for all three</sub>  

**🟡 minor — Row vertical padding is symmetric (py-2 = 8+8px) but artboard uses 8px top / 9px bottom**  
`packages/app-tauri/src/features/sessions/sidebar/SessionRow.tsx:226`  
*Artboard:* 02-chrome.jsx SessionRowDense line 424: `padding: '8px 12px 9px 10px'`  
*Drift:* Built row trigger uses `py-2` (8px symmetric). Artboard specifies 8px top / 9px bottom — a 1px asymmetry for optical centering of the title+meta layout. Compounds visually across a long list.  
*Fix:* Replace `py-2` with `pt-2 pb-[9px]` on the trigger div at line 226.  
<sub>verify: SessionRow.tsx line 226 uses py-2 (symmetric 8px); artboard line 424 specifies padding: '8px 12px 9px 10px' (8px top / 9px bottom)</sub>  

<details><summary>Deferred (not drift) — 5</summary>

- Update pill in SidebarHeader (accent-tinted download arrow + 'Update' label next to traffic lights) — blocked on Tauri updater data source; tracker 2026-06-13 completion note explicitly marks it deferred: 'blocked on a Tauri updater — no update-available data source exists yet'.
- Bottom Context / Skills / Agents tabbed panel + resize handle — tracker backlog item M (MIGRATION-TRACKER.md line 285): 'completes artboard parity below the session list'.
- Dashed 'Add project' ghost pill in ProjectFilterPillBar — deferred pending add-project flow; ProjectFilterPillBar.tsx comment line 10-11 notes it explicitly, and the tracker references directory picker + project create/register.
- SessionSidebar group-header 'more' popover wiring — currently a placeholder button with no menu; tracker note (line 127): 'a presentational placeholder button, no menu wired'.
- Warm radial-gradient window background behind floating panels — flat `bg-mf-window` used today; the gradient was tried and cut per component-map §8.3 note: 'a gradient wash was tried and cut'.

</details>

---

### Sandbox preview + Run cluster  ·  15 findings (0B / 8M / 7m)

**🟠 Major — Device toggle track and active pill use wrong tokens (bg-accent/50 vs --mf-chip; bg-card vs --mf-tab-active)**  
`packages/app-tauri/src/features/preview/PreviewDeviceToggle.tsx:12,17,28`  
*Artboard:* 03-content.jsx PreviewPane — device toggle wrapper uses T.chipBg (--mf-chip = rgba(0,0,0,0.05)); active pill uses T.tabBarActive (--mf-tab-active = #ffffff light) with boxShadow `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)`  
*Drift:* Track uses `bg-accent/50` — accent is rgba(0,0,0,0.04) so /50 resolves to ~rgba(0,0,0,0.02), nearly invisible vs the intended chip tint. Active pill uses `bg-card shadow-sm` — card is #f8f6f2 (raised card surface), not the white tab-active (#ffffff). The prototype lift shadow (`0 0.5px 0 border, 0 1px 2px rgba(0,0,0,0.06)`) is absent.  
*Fix:* Change track to `bg-mf-chip`. Change active pill to `bg-mf-tab-active` and add inline style `boxShadow: '0 0.5px 0 var(--border), 0 1px 2px rgba(0,0,0,0.06)'` (or a custom Tailwind shadow utility seeded from the token).  
<sub>verify: PreviewDeviceToggle.tsx line 12 uses `bg-accent/50` (resolves to rgba(0,0,0,0.02)) for track; line 17 uses `bg-card shadow-sm` for active pill. Artboard shows T.chipBg (rgba(0,0,0,0.05)) for track and T.tabBarActive (#ffffff) with explicit shadow `0 0.5px 0 border, 0 1px 2px rgba(0,0,0,0.06)` for active pill.</sub>  

**🟠 Major — ConsolePane is a global bottom bar below all Run panes; prototype shows it as a per-preview-pane collapsible drawer**  
`packages/app-tauri/src/layout/surfaces/RunSurface.tsx:169-172 (global ConsolePane render); packages/app-tauri/src/features/run/ConsolePane.tsx:63-114`  
*Artboard:* 03-content.jsx PreviewPane lines 1322-1357 — the console is a collapsible drawer at the bottom of the PreviewPane (`collapsed by default for previews`). A 28px header row (chevron + 'Console' + log count + tail preview + clear) toggles an expanded log area. For non-preview (process-only) configs it is a full panel inside the pane, not outside.  
*Drift:* The built ConsolePane renders outside the pane grid at the bottom of the entire RunSurface, always visible when a scopeKey+selectedConfigName exist. The prototype draws the console inside each PreviewPane with a collapse toggle (collapsed by default), a one-line tail preview when collapsed, and a log count badge. The built version is always expanded and has no collapse toggle, no tail preview, and no log count chip.  
*Fix:* Move ConsolePane into PreviewBodyState or PreviewInstance (below the webview area). Add a collapse toggle (chevron + 'Console' label + log count chip) and render the log area only when expanded (collapsed by default for preview configs). Show the last log line as a tail preview in the collapsed header.  
<sub>verify: RunSurface.tsx lines 169-171 renders ConsolePane as a global bottom panel outside pane tabs. Artboard PreviewPane lines 1322-1357 shows console as a per-preview collapsible drawer inside each PreviewPane with default collapsed state, chevron toggle, log-count badge, and tail preview when collapsed.</sub>  

**🟠 Major — LaunchPopover/StopPopover are a global top launch bar; prototype integrates Run/Stop inline in the per-preview toolbar**  
`packages/app-tauri/src/layout/surfaces/RunSurface.tsx:116-127 (RunLaunchBar), packages/app-tauri/src/features/run/LaunchPopover.tsx:70-104`  
*Artboard:* 03-content.jsx PreviewPane lines 1167-1191 — the PrimaryRun control (green 'Run' button when stopped; 'Stop' + restart icon-button when running) is part of the run bar inside each PreviewPane tab, before the URL bar. It is the primary affordance to start/stop a specific named config.  
*Drift:* The built code adds a global `RunLaunchBar` (h-[34px] top bar with Rocket 'Launch' popover + StopCircle 'Stop' popover) above ALL pane tabs, decoupled from which preview config is active in each tab. The prototype's UX is that each preview tab owns its own inline Run/Stop button. The Launch popover is a valid adaptation for multi-config but its placement above the tab strip (not inside the tab's own toolbar) diverges from the artboard composition.  
*Fix:* Consider moving launch/stop into PreviewInstance's toolbar (PreviewToolbar already exists). The per-tab 'Run server' CTA in PreviewBodyState is correct but the RunLaunchBar global placement doubles up affordances. At minimum, hide RunLaunchBar when a single preview tab is active and show its controls inline in PreviewToolbar.  
<sub>verify: RunSurface.tsx lines 116-127 add a global `RunLaunchBar` h-[34px] top bar with LaunchPopover/StopPopover decoupled from preview tabs. Artboard PreviewPane lines 1167-1191 show PrimaryRun (green Run/Stop button) as part of the per-preview toolbar inside the PreviewPane tab, not a global bar above all tabs.</sub>  

**🟠 Major — Status dot in URL bar uses hardcoded `bg-green-500` instead of `bg-mf-success`**  
`packages/app-tauri/src/features/preview/PreviewUrlBar.tsx:52`  
*Artboard:* 03-content.jsx PreviewPane line 1213 — running state dot uses `T.green` (--mf-success = #28a745 light, #50d97c dark) with `tw-pulse` animation  
*Drift:* `bg-green-500` is Tailwind's hardcoded #22c55e — it does not follow the theme's --mf-success token (#28a745 light / #50d97c dark / #1e9e58 ocean-light) and will not change with color scheme.  
*Fix:* Replace `bg-green-500` with `bg-mf-success`.  
<sub>verify: PreviewUrlBar.tsx line 52 uses `bg-green-500` (hardcoded #22c55e). Artboard line 1213 uses T.green which maps to --mf-success (#28a745 light, #50d97c dark) with pulse animation.</sub>  

**🟠 Major — Inspect active state missing 'CLICK AN ELEMENT' badge overlay inside the webview**  
`packages/app-tauri/src/features/preview/PreviewBodyState.tsx:77-81`  
*Artboard:* 03-content.jsx PreviewPane lines 1303-1303 — when `inspecting` is true, a `position:absolute, top:8, left:8` badge (font-mono 10px, fontWeight 700, white text, accent background, borderRadius 6) renders inside the webview frame with text 'CLICK AN ELEMENT'  
*Drift:* Built code shows only a 2px `h-0.5 bg-primary` line at the top edge of the container. No badge overlay. Also, the prototype shows an `outline: 2px solid ACCENT, outlineOffset: -2` on the webview container itself (the frame glows). The built code has no outline on the webview frame.  
*Fix:* When `inspectActive` is true: (1) add `outline: 2px solid var(--primary)` with `outline-offset: -2px` on the webview container, (2) add an absolutely-positioned badge inside the webview area: `position:absolute top-2 left-2 z-10 font-mono text-[10px] font-bold text-white rounded bg-primary px-1.5 py-0.5` with content 'CLICK AN ELEMENT'.  
<sub>verify: PreviewBodyState.tsx lines 77-81 render only a `h-0.5 bg-primary` line at top; no badge overlay and no outline on webview. Artboard lines 1301-1303 show `outline: 2px solid ACCENT, outlineOffset: -2` on the webview frame and an absolutely-positioned badge inside with text 'CLICK AN ELEMENT'.</sub>  

**🟠 Major — Annotation popover uses Tailwind `shadow-lg` instead of `var(--mf-shadow-pop)` — shadow contract violation**  
`packages/app-tauri/src/features/preview/CaptureAnnotationPopover.tsx:19`  
*Artboard:* 13-popover.jsx PopCard line 23 — all popovers use `boxShadow: POP_SHADOW` (= T.popShadow = --mf-shadow-pop). The component-map §2 states popovers use `--mf-shadow-pop`.  
*Drift:* `shadow-lg` is Tailwind's built-in `0 10px 15px -3px rgb(0 0 0/0.1), 0 4px 6px -4px rgb(0 0 0/0.1)` — does not include the 0.5px inset ring of `--mf-shadow-pop` and does not respond to the per-scheme shadow values.  
*Fix:* Replace `shadow-lg` with an inline style `boxShadow: 'var(--mf-shadow-pop)'` or a CSS custom property utility. Also change `rounded-lg` to `rounded-lg` (radius 11px via `--radius-lg` = calc(0.5rem+3px) = 11px) which matches PopCard's `borderRadius: 11`.  
<sub>verify: CaptureAnnotationPopover.tsx line 19 uses `shadow-lg` (Tailwind's built-in shadow). Artboard 13-popover.jsx line 23 and the component-map specify `boxShadow: POP_SHADOW` (= --mf-shadow-pop with 0.5px inset ring).</sub>  

**🟠 Major — PreviewBodyState stopped CTA is a `<div onClick>` instead of `<button>` — not keyboard-accessible**  
`packages/app-tauri/src/features/preview/PreviewBodyState.tsx:33`  
*Artboard:* 03-content.jsx PreviewPane lines 1277-1289 — the stopped-state CTA is a `<button>` element with explicit hover styles on the ring element  
*Drift:* The CTA is rendered as `<div data-testid='preview-body-cta' onClick={onStart} className='... cursor-pointer hover:bg-accent ...'>`. Using a `<div onClick>` means keyboard users cannot Tab-focus and activate it with Enter/Space, violating both the project a11y rule and the artboard's `<button>` semantics.  
*Fix:* Change the wrapper element from `<div>` to `<button type='button'>` and keep the existing classes. Remove `cursor-pointer` (button already has pointer).  
<sub>verify: PreviewBodyState.tsx line 32 renders `<div data-testid='preview-body-cta' onClick={onStart}` instead of `<button>`. Artboard line 1277 shows a `<button onClick={start}>` element.</sub>  

**🟠 Major — PreviewBodyState stopped state: ring border does not turn green on hover**  
`packages/app-tauri/src/features/preview/PreviewBodyState.tsx:35-37`  
*Artboard:* 03-content.jsx PreviewPane lines 1281-1283 — `onMouseEnter` sets `querySelector('.pv-run-ring').style.borderColor = T.green`; `onMouseLeave` resets it to T.border. The ring is explicitly green-bordered on hover.  
*Drift:* The built code has `hover:bg-accent` on the wrapper and a static `border-border` on the ring circle div. There is no hover effect on the ring border color — it stays gray on hover. The prototype's key UX affordance (the ring glows green to hint 'will run') is missing.  
*Fix:* Add a CSS group hover: wrap the CTA in a `group` and apply `group-hover:border-mf-success` to the ring div. Or use a controlled hover state via `onMouseEnter`/`onMouseLeave` on the button to add/remove a green border class on the ring.  
<sub>verify: PreviewBodyState.tsx lines 35-37 have no `onMouseEnter`/`onMouseLeave` handlers on the wrapper; the ring div has static `border-border`. Artboard lines 1281-1283 show onMouseEnter/onMouseLeave setting ring `borderColor` to T.green on hover.</sub>  

**🟡 minor — RunTabPill active state uses `bg-accent` instead of `bg-mf-chip` (prototype tab active = chipBg, not rowHover)**  
`packages/app-tauri/src/layout/surfaces/RunSurface.tsx:29`  
*Artboard:* 04-engine.jsx SurfaceTabStrip line 895 — active tab uses `background: T.chipBg` (--mf-chip = rgba(0,0,0,0.05)). `T.rowHover` (= --accent = rgba(0,0,0,0.04)) is the hover surface, not the selected state.  
*Drift:* Active tab: `bg-accent` resolves to `var(--accent)` = `rgba(0,0,0,0.04)`. The artboard tab active uses `T.chipBg` = `var(--mf-chip)` = `rgba(0,0,0,0.05)`. In light mode the difference is subtle but in dark mode accent = `rgba(255,255,255,0.055)` while chip = `rgba(255,255,255,0.07)` — chip is noticeably more opaque. Semantically the wrong token.  
*Fix:* Change active tab class to `bg-mf-chip`.  
<sub>verify: RunSurface.tsx line 29 uses `bg-accent` for active tab. Artboard 04-engine.jsx line 895 uses T.chipBg (--mf-chip = rgba(0,0,0,0.05)) for active tab, not T.rowHover (--accent = rgba(0,0,0,0.04)).</sub>  

**🟡 minor — ConsolePane height resets to DEFAULT_HEIGHT on any React re-render after drag**  
`packages/app-tauri/src/features/run/ConsolePane.tsx:63-69 (style={{ height: DEFAULT_HEIGHT }})`  
*Artboard:* 04-engine.jsx Inspector lines 58-82 — the drag handle updates `drawerH` state, causing a re-render with the new height applied via state.  
*Drift:* The container has `style={{ height: DEFAULT_HEIGHT }}` as a static JSX prop. The drag handler mutates `containerRef.current.style.height` imperatively (correct for perf) but `heightRef.current` is never read back into the style prop. If the component re-renders for any reason (e.g., new log entry triggers state in a parent), the height resets to 180px.  
*Fix:* Initialize `style={{ height: DEFAULT_HEIGHT }}` but also store the live height in a `useState(DEFAULT_HEIGHT)` that the drag handler updates via `setHeight`. Or switch to a purely imperative approach and stop setting the initial style via JSX (use a ref-based setup effect instead).  
<sub>verify: ConsolePane.tsx line 68 has `style={{ height: DEFAULT_HEIGHT }}` as a static JSX prop; drag handler mutates containerRef.style.height imperatively but height resets on re-render. Artboard 04-engine.jsx lines 58-82 show state-driven drawerH with re-render persistence.</sub>  

**🟡 minor — PreviewToolbar height is fixed `h-[38px]` but artboard uses `minHeight: 38` — content could clip**  
`packages/app-tauri/src/features/preview/PreviewToolbar.tsx:37`  
*Artboard:* 03-content.jsx PreviewPane line 1196 — run bar is `minHeight: 38, flexShrink: 0` allowing it to grow if content wraps  
*Drift:* `h-[38px]` sets a fixed height. If the capture cluster or URL bar needs more space (e.g., at narrow widths), it will clip rather than grow.  
*Fix:* Change `h-[38px]` to `min-h-[38px]`.  
<sub>verify: PreviewToolbar.tsx line 37 uses fixed `h-[38px]`. Artboard 03-content.jsx line 1196 shows `minHeight: 38, flexShrink: 0` allowing growth.</sub>  

**🟡 minor — Capture cluster inspect button uses Search icon; artboard uses a 'locate' (crosshair/cursor) icon**  
`packages/app-tauri/src/features/preview/PreviewCaptureCluster.tsx:1,38`  
*Artboard:* 03-content.jsx PreviewPane line 1265 — `PvToolBtn icon='locate'` for the element picker; Primitives.html maps 'locate' to a cursor/crosshair glyph (lucide: Crosshair or Locate)  
*Drift:* The built code imports and renders `<Search size={11} />` for the inspect button. Search is a magnifying glass icon, semantically wrong for an element inspector/locator. The artboard's 'locate' icon is a crosshair/locate (lucide `Crosshair` or `Locate`).  
*Fix:* Replace `Search` import with `Crosshair` (or `Locate`) from lucide-react, and use it for the inspect button.  
<sub>verify: PreviewCaptureCluster.tsx line 40 imports and uses `Search` icon for inspect button. Artboard line 1265 uses `icon='locate'` which maps to a crosshair/locate glyph, not a magnifying glass.</sub>  

**🟡 minor — Capture cluster region button uses Crop icon; artboard uses 'frame' icon**  
`packages/app-tauri/src/features/preview/PreviewCaptureCluster.tsx:1,56`  
*Artboard:* 03-content.jsx PreviewPane line 1267 — `PvToolBtn icon='frame'` for the region capture. Prototype maps 'frame' to a square-dashed/selection-frame glyph (lucide: `ScanSearch` or `Frame`).  
*Drift:* Built code uses `Crop` (a crop tool icon), which implies resizing/trimming, not a region-selection for capture. 'frame' in the prototype maps to a box/selection affordance.  
*Fix:* Replace `Crop` with `ScanSearch` or `Frame` from lucide-react (confirm against Primitives.html 'frame' glyph rendering).  
<sub>verify: PreviewCaptureCluster.tsx line 60 uses `Crop` icon for region capture. Artboard line 1267 uses `icon='frame'` which maps to a box/selection-frame glyph, not a crop tool.</sub>  

**🟡 minor — LaunchPopover trigger uses `Rocket` icon; prototype uses `play.fill` (Play) for the launch control**  
`packages/app-tauri/src/features/run/LaunchPopover.tsx:74`  
*Artboard:* 03-content.jsx PreviewPane PrimaryRun component (line 1175) — uses `play.fill` / `stop.fill` icons; the LaunchPopover in 04-engine.jsx AddMenu line 846 uses `eye` icon for preview configs and `terminal` for process configs  
*Drift:* The trigger button uses `<Rocket size={12} />` and label 'Launch'. The prototype's primary launch control is a green `play.fill` filled-Play icon button (not a rocket). The 'Launch' global menu popup concept is a valid adaptation but the rocket icon has no equivalent in the prototype or Primitives.html icon inventory.  
*Fix:* Replace `Rocket` with `Play` (filled, or use `PlayCircle`) for the launch trigger to align with the prototype's play affordance language.  
<sub>verify: LaunchPopover.tsx line 80 uses `<Rocket size={12} />` for trigger. Artboard PrimaryRun line 1175 uses `Icon name='play.fill'` (filled Play icon) for the launch control.</sub>  

**🟡 minor — PreviewBodyState starting spinner uses Loader2 (spin); prototype uses a CSS-animated border spinner**  
`packages/app-tauri/src/features/preview/PreviewBodyState.tsx:55`  
*Artboard:* 03-content.jsx PreviewPane line 1291-1294 — starting state uses `width:12, height:12, borderRadius:'50%', border:'1.5px solid T.text3', borderTopColor:'transparent', animation:'tw-spin 0.9s linear infinite'` — a native CSS border spinner, not a lucide icon  
*Drift:* Built code uses `<Loader2 size={12} className='animate-spin text-muted-foreground' />`. Loader2 is a 12px lucide icon with spokes; the prototype uses a thin-border CSS spinner. The visual differs (spokes vs smooth ring). Minor but intentional artboard detail.  
*Fix:* Replace Loader2 with a `<span>` styled as a CSS border-spinner: `w-3 h-3 rounded-full border-[1.5px] border-muted-foreground border-t-transparent animate-spin`.  
<sub>verify: PreviewBodyState.tsx line 56 uses `<Loader2 size={12} className='animate-spin text-muted-foreground' />`. Artboard lines 1291-1293 render a CSS-animated border-spinner (thin ring with transparent top).</sub>  

<details><summary>Deferred (not drift) — 6</summary>

- Tunnel-URL-driven navigation in the PreviewUrlBar (URL bar currently only shows localhost:PORT; deep link or remote tunnel URL routing is deferred per tracker 'Logged follow-ups: tunnel-URL-driven navigation').
- Win/Linux native capture fallback (takeSnapshot is macOS-only; Win/Linux unsupported-stub is by design per tracker).
- CSS-inspect chip producer (UMInspectChip in the user message — tracker: 'CSS-inspect chips' deferred to sandbox inspect surface follow-up).
- Background-tasks pill in ChatSessionBar (tracker: 'background-tasks pill deferred').
- Per-preview-tab 'Run {configName}' primary button replacing the global RunLaunchBar is a recognized structural adaptation in the tracker and not flagged as a blocker — the tracker notes the global LaunchPopover as the approved implementation.
- ConsolePane `--mf-selection` token for xterm selection highlight is tracked as a deferred review nit per the Run/terminal completion note.

</details>

---

### Chat cards & tool cards  ·  15 findings (0B / 7M / 8m)

**🟠 Major — PermissionGate / PlanGate / AskUserQuestionGate: no resolved/collapsed state shown in-thread after the user answers**  
`packages/app-tauri/src/features/chat/gates/ChatGateMount.tsx:7-15`  
*Artboard:* 10-chatcards.jsx CardShell (resolved={!!state}) + ResolvedPill — after deny/allow the card collapses to a hairline border + shows a ResolvedPill badge ('Allowed once' / 'Always allowed' / 'Denied' / 'Answered' / 'Running' / 'Revising') in the header right slot  
*Drift:* ChatGateMount renders the gate card for the current front-of-queue entry only, and returns null when the queue is empty — the gate simply disappears on reply. There is no persistent resolved state card (ResolvedPill, greyed-out chrome, read-only summary) left behind in the transcript after the user answers, matching neither the permission, plan, nor ask-question resolved states the artboard shows.  
*Fix:* After reply() resolves, render a lightweight resolved pill row (icon + label + 'Allowed once' / 'Denied' / 'Answered' etc.) in place of the full gate card. The artboard's pattern: same CardShell with resolved=true (hairline, no shadow) + a ResolvedPill in the right slot of the header.  
<sub>verify: ChatGateMount.tsx:7-15 returns null when front is empty; no ResolvedPill or persistent resolved-state card left behind after reply().</sub>  

**🟠 Major — GateCardShell uses bg-background (white) instead of T.content (card surface) and rounded-xl vs prototype's borderRadius 13 (--radius-xl = 13px)**  
`packages/app-tauri/src/features/chat/gates/shared/GateShell.tsx:13`  
*Artboard:* 10-chatcards.jsx CardShell: background T.content (#f8f6f2 — the card/content2 surface), borderRadius 13  
*Drift:* GateCardShell uses 'bg-background' which is --background (#ffffff on light, #262835 on dark) — the full-white content surface. The prototype uses T.content which maps to the slightly tinted card surface (--card: #f8f6f2 on light). rounded-xl is correct (13px = --radius-xl) but the background token is wrong, making permission/plan/ask cards appear slightly brighter/flatter than intended.  
*Fix:* Change 'bg-background' to 'bg-card' in GateShell.tsx line 13. Both tokens are defined in globals.css.  
<sub>verify: GateShell.tsx:13 uses 'bg-background' (#ffffff light, #262835 dark) instead of 'bg-card' (#f8f6f2 light, #212330 dark).</sub>  

**🟠 Major — GateHead eyebrow letter-spacing is 0 (tracking-normal) instead of 0.6px as specified in prototype**  
`packages/app-tauri/src/features/chat/gates/shared/GateShell.tsx:48`  
*Artboard:* 10-chatcards.jsx CardHead: letterSpacing: 0.6, textTransform: 'uppercase' on the eyebrow span — this produces the dense-caps effect distinguishing e.g. 'PERMISSION REQUIRED' from body text  
*Drift:* GateHead renders 'text-micro font-bold uppercase tracking-normal'. The globals.css defines --tracking-normal as 0, so the eyebrow text renders at letter-spacing 0, losing the wide-spaced all-caps look the artboard shows (0.6px). MarkerCapsLabel in marker-pill.tsx line 99 has the same issue ('tracking-normal uppercase').  
*Fix:* Use 'tracking-[0.6px]' (Tailwind v4 arbitrary value) on the eyebrow span in GateShell.tsx:48 and on MarkerCapsLabel in marker-pill.tsx:99. Alternative: add '--tracking-caps: 0.6px' to @theme inline and use 'tracking-caps'.  
<sub>verify: GateShell.tsx:48 eyebrow span uses 'tracking-normal' which equals 0 in globals.css:741, not 0.6px. MarkerCapsLabel:99 has same issue.</sub>  

**🟠 Major — PlanGate is missing the step-by-step plan list; it only shows a markdown prose blob**  
`packages/app-tauri/src/features/chat/gates/PlanGate.tsx:49-59`  
*Artboard:* 10-chatcards.jsx PlanApprovalCard: the plan body renders numbered steps (array) with file-chip tags under each step, inside a flex-col gap-0 list, not a single markdown blob  
*Drift:* PlanBody renders the plan field as a single react-markdown block. The artboard shows a structured step list: numbered circular badges (19×19 rounded-full, tinted accent when approved), step text, and optional file-path code chips. The component-map §7 confirms the plan field is a markdown string, so the markdown render is data-correct, but the visual output is an unstyled prose block instead of the numbered-step visual hierarchy.  
*Fix:* Parse the plan markdown for ordered list items and render them as the artboard's numbered step list (index badge + text + optional file chips), or apply a custom react-markdown 'ol'/'li' component that wraps each step in the prototype's numbered visual treatment. At minimum the numbered-step indicator badges are missing.  
<sub>verify: PlanGate.tsx:49-59 PlanBody renders plan as single Markdown prose block without numbered step badges or file-chip hierarchy.</sub>  

**🟠 Major — PlanGate 'executing' status footer missing — no running-mode indicator after approval**  
`packages/app-tauri/src/features/chat/gates/PlanGate.tsx:159-209`  
*Artboard:* 10-chatcards.jsx PlanApprovalCard state='approve': shows a bottom footer with a pulsing dot (accent or red for yolo), 'Executing in {modeLabel} mode — starting step 1.' The yolo mode uses T.red dot.  
*Drift:* After calling handleApprove(), the PlanGate immediately passes reply() and the gate disappears (ChatGateMount returns null). There is no post-approve footer rendered showing the execution mode. The artboard shows a persistent 'running' state with a pulsing dot and the mode label while the plan runs.  
*Fix:* Track a local 'approved' state. When approved, hide the action row and show the running footer: a pulsing dot (bg-destructive for yolo, bg-primary otherwise) + 'Executing in {modeLabel} mode…' text.  
<sub>verify: PlanGate.tsx:167-169 handleApprove calls reply() directly; no local 'approved' state or persistent footer with pulsing dot + 'Executing in {mode}' text.</sub>  

**🟠 Major — TaskProgressCard completed item: built uses solid bg-mf-success fill; prototype uses a lighter green tint (green at 0x22 alpha) with a 0x66 border**  
`packages/app-tauri/src/features/chat/tools/cards/TaskProgressCard.tsx:72-75`  
*Artboard:* 10-chatcards.jsx TaskStatusIcon completed: background `${T.green}22` (green at ~13% opacity) + border `1px solid ${T.green}66` (green at ~40%), not a solid fill  
*Drift:* Built TaskStatusIcon for 'completed' uses 'border-mf-success bg-mf-success' — solid green fill. Prototype uses the tinted version (green at 13% bg + 40% border). The in-progress state (line 78) also differs: prototype uses a solid filled square, but the built 'rounded-sm animate-pulse border-primary bg-primary' matches. The completed state is the mismatch.  
*Fix:* For completed: use 'bg-mf-success-tint border-mf-success' instead of 'bg-mf-success border-mf-success'. The mf-success-tint token (rgba(40,167,69,0.10)) approximates the prototype's green-22 alpha.  
<sub>verify: TaskProgressCard.tsx:72-75 completed state uses solid 'bg-mf-success border-mf-success' fill; prototype shows lighter tint (green at ~13% opacity + 40% border).</sub>  

**🟠 Major — ToolGroup header shows only a count label; prototype shows a title (e.g. 'Investigating') in uppercase + N calls + optional elapsed time**  
`packages/app-tauri/src/components/ui/assistant-ui/tool-group.tsx (ToolGroupTrigger)`  
*Artboard:* 09-toolcards.jsx ToolGroup header: Icon(chevron) + uppercase bold title ('INVESTIGATING') + '{N} calls{time}' in mono text-mf-text-4  
*Drift:* ToolGroupTrigger renders only the label (summary or '{N} tool calls') with a LoaderIcon when active. The prototype's group header has two distinct typographic elements: an uppercase bold section title (e.g. 'Investigating', 'Applying edits') in text-foreground/700 + a subordinate count+time string in mono muted text. The built component merges both into one label string, losing the hierarchy. No elapsed time is shown.  
*Fix:* Split the ToolGroupTrigger content into two spans: (1) the title in text-label font-bold uppercase, (2) the count+optional time in font-mono text-micro text-mf-text-4. The summary passed via metadata should carry the section title; the count can remain automatic.  
<sub>verify: tool-group.tsx:79-141 ToolGroupTrigger renders single merged label + LoaderIcon; no split uppercase title + count+time hierarchy or elapsed time shown.</sub>  

**🟡 minor — StatusDot in tool cards is 8×8px (w-2 h-2); prototype ToolStatus uses a 5×5px dot for 'Done'**  
`packages/app-tauri/src/features/chat/tools/shared/chrome.tsx:54, 62, 69`  
*Artboard:* 09-toolcards.jsx ToolStatus done: 'width: 5, height: 5, borderRadius: 50%, background: T.green' — a 5px dot, not 8px  
*Drift:* StatusDot uses w-2 h-2 (8px) for all three states. The prototype's ToolStatus 'done' state uses a 5px dot (smaller, quieter). Running uses an 11px rotating icon. The built 8px dot is consistent across states but larger than specified for the done state.  
*Fix:* Reduce the done-state dot to 'w-[5px] h-[5px]' to match prototype. Running state (pulsing muted) can stay 8px as it's more visible in the pending state.  
<sub>verify: chrome.tsx:69 success StatusDot uses 'w-2 h-2' (8px); prototype ToolStatus done state specifies 5px dot.</sub>  

**🟡 minor — ToolCard header: prototype shows a 'Running' spinner (arrow.clockwise rotating icon + amber text) for running state; built StatusDot shows a pulsing muted dot with 'Running' text label**  
`packages/app-tauri/src/features/chat/tools/shared/chrome.tsx:51-56`  
*Artboard:* 09-toolcards.jsx ToolStatus running: 'arrow.clockwise' icon (size 11, color T.amber) with spin animation + 'Running' text in amber. The icon is the primary visual indicator, not a dot.  
*Drift:* Built StatusDot pending/running state renders a pulsing bg-muted-foreground dot (opacity-40) + 'Running' text label. Prototype uses a rotating amber arrow-clockwise icon (no dot) + amber text. The amber color distinguishes running from the grey pending dot, and the rotating icon is more immediately recognizable.  
*Fix:* In StatusDot when result===undefined: render a RotateCcwIcon (or RefreshCwIcon, size 11) with 'animate-spin text-mf-warning' + 'Running' in text-mf-warning, replacing the pulsing muted dot. This matches the prototype's amber-spinner running indicator.  
<sub>verify: chrome.tsx:51-56 pending/running state renders pulsing 'bg-muted-foreground opacity-40' dot + 'Running' label; prototype shows rotating amber arrow-clockwise icon.</sub>  

**🟡 minor — CardBtn (GateButton) missing press-scale micro-interaction**  
`packages/app-tauri/src/features/chat/gates/shared/GateButton.tsx:13-26`  
*Artboard:* 10-chatcards.jsx CardBtn: onMouseDown sets transform: scale(0.97), onMouseUp resets to scale(1) — a subtle tactile press animation on all card action buttons  
*Drift:* GateButton uses the shadcn Button with size='sm' and custom className but no active:scale transform. The prototype's CardBtn always has the scale(0.97) press-down on mousedown. This is a minor interaction polish detail missing across all gate action buttons (Deny, Allow once, Always allow, Approve & run, Keep planning).  
*Fix:* Add 'active:scale-[0.97] transition-transform' to GateButton's className, or add it to the shared Button component's ghost/primary variants.  
<sub>verify: GateButton.tsx:13-26 renders Button with KIND_CLASS but no 'active:scale-[0.97]' or press-down transform visible.</sub>  

**🟡 minor — FamilyTile renders text-caption sized glyph; the '+' glyph in WriteFileCard renders too small and misses font-weight context**  
`packages/app-tauri/src/features/chat/tools/cards/WriteFileCard.tsx:122-124`  
*Artboard:* 09-toolcards.jsx ToolCard tile: icon at size 13, inside a 22×22 tile. WriteFileCard prototype tile uses meta.color (#28a745) + meta.icon 'plus' at size 13.  
*Drift:* WriteFileCard passes the string '+' as children to FamilyTile. FamilyTile renders it as 'text-caption font-bold' (11px). The artboard shows a Lucide Plus icon (size 13) in the tile. Using a raw '+' character at 11px appears smaller and thinner than a 13px Lucide icon. The artboard intent is a recognizable icon, not a typography glyph.  
*Fix:* Import PlusIcon from lucide-react and use <PlusIcon size={13} /> as the tile child in WriteFileCard, matching the pattern of all other tool cards.  
<sub>verify: WriteFileCard.tsx:124 passes raw string '+' to FamilyTile which renders at text-caption (11px); prototype uses Lucide Plus icon at size 13.</sub>  

**🟡 minor — CompactionPill uses LayersIcon; prototype uses 'layers' icon (correct) but the pill is not purely a MarkerWrap/MarkerPill — it is a custom div in SystemMessage, inconsistent with the MarkerPill family chrome**  
`packages/app-tauri/src/features/chat/messages/SystemMessage.tsx:21-33`  
*Artboard:* 10-chatcards.jsx CompactionPill: uses MarkerWrap + MarkerPill with icon='layers', state='done', not expandable — same chrome as all other marker pills  
*Drift:* CompactionPill is a bespoke div with explicit className instead of reusing the shared MarkerWrap + MarkerPill components. The result looks similar but bypasses the token composition (bg-mf-content2, border-border, rounded-full, px-3 py-1) in a duplicated way. Minor risk of token drift between this pill and the rest of the marker-pill family.  
*Fix:* Replace the bespoke div with <MarkerWrap><MarkerPill icon={<LayersIcon size={12} />} testId='chat-compaction-pill'>Context compacted</MarkerPill></MarkerWrap> to use the canonical chrome.  
<sub>verify: SystemMessage.tsx:21-33 CompactionPill renders custom div with explicit className instead of reusing MarkerWrap+MarkerPill components.</sub>  

**🟡 minor — AskUserQuestionCard (display) uses MessageCircleQuestion with opacity-60; prototype CardHead accent is full opacity on the icon**  
`packages/app-tauri/src/features/chat/tools/cards/AskUserQuestionCard.tsx:140`  
*Artboard:* 10-chatcards.jsx CardHead: the icon inside the accent tile is full-color (accent color, no opacity reduction). AskUserQuestionCard eyebrow says 'Question' in accent color; icon is full ACCENT.  
*Drift:* AskUserQuestionCard's CollapsibleTrigger renders <MessageCircleQuestion size={15} className='shrink-0 text-primary opacity-60' />. The opacity-60 dims the icon to 60%, making it noticeably muted compared to the prototype where the question icon is full primary color in its tile.  
*Fix:* Remove 'opacity-60' from the MessageCircleQuestion icon class on line 140.  
<sub>verify: AskUserQuestionCard.tsx:140 MessageCircleQuestion icon includes 'opacity-60' class; prototype shows full-color icon.</sub>  

**🟡 minor — BashCard body: Collapsible root wraps the card div, creating a structural mismatch — the border/radius is on an inner div, not on the Collapsible root**  
`packages/app-tauri/src/features/chat/tools/cards/BashCard.tsx:111-172`  
*Artboard:* 09-toolcards.jsx ToolCard: the outer div at borderRadius 11 is the single container for both header and body; CollapsibleCardShell correctly puts the radius on the Collapsible root  
*Drift:* BashCard wraps a Collapsible around an inner div that carries cardStyle (border + rounded-lg + bg-card). CollapsibleContent is nested inside that inner div. Other cards (EditFileCard via CollapsibleCardShell) correctly place cardStyle on the Collapsible root element. The result is a double-wrapped element where the Collapsible root has no border/radius and the inner div has it — this is invisible when closed but can cause overflow/clip issues at the bottom edge when the body expands, because CollapsibleContent's overflow:hidden clips against the unstyled Collapsible wrapper rather than the styled card border.  
*Fix:* Move cardStyle to the Collapsible root: change Collapsible className to cn(cardStyle(result, isError)) and remove the inner div wrapper. Matches the CollapsibleCardShell pattern.  
<sub>verify: BashCard.tsx:111-172 wraps Collapsible around inner div that carries cardStyle border/radius; CollapsibleContent nested inside inner div, not at root.</sub>  

**🟡 minor — PermissionGate head tile icon is size-4 (16px); prototype CardHead icon is size 15 inside a 26×26 tile**  
`packages/app-tauri/src/features/chat/gates/PermissionGate.tsx:98`  
*Artboard:* 10-chatcards.jsx CardHead tile: width:26, height:26, rounded:8. Icon is size 15 (Icon component). PermissionCard uses shield icon at size 15.  
*Drift:* PermissionGate passes <ShieldIcon className='size-4' /> — size-4 is 16px. Prototype icon is 15px. GateHead tile is size-6 (24px), prototype tile is 26×26px. Minor 1-2px off on both the tile and icon.  
*Fix:* Change ShieldIcon to size={15} (style='width:15px;height:15px' or w-[15px] h-[15px]). Tile: add w-[26px] h-[26px] to GateHead's tile span, or accept the minor 2px difference as tolerated.  
<sub>verify: PermissionGate.tsx:98 ShieldIcon uses 'size-4' (16px); prototype shows 15px icon in 26×26 tile (GateHead tile is size-6 = 24px).</sub>  

<details><summary>Deferred (not drift) — 4</summary>

- CompactionPill: the prototype shows it as a MarkerWrap/MarkerPill — same chrome as other marker pills. The built version is a custom div. Tracker does not mark this as deferred, but it is a minor inconsistency (chat-cards-13 raised as minor drift).
- TurnHeader (assistant avatar + model name label above each assistant turn) — the prototype's ChatTranscript renders a TurnHeader with an 18×18 'mf' avatar square and model label (e.g. 'Claude Sonnet 4.5'). The built AssistantMessage.tsx has no avatar or model name header. This appears to be intentionally omitted (no data-testid rule references it, and CLAUDE.md does not list it) — treating as deferred/not-in-scope unless the tracker explicitly requires it.
- ToolCard group: the prototype shows a collapsible ToolGroup with a text title (e.g. 'Investigating') derived from the daemon's phase labels. The built ToolGroupTrigger uses a synthesized summary string. The title taxonomy (Investigating / Applying edits / etc.) is not surfaced from metadata — the daemon would need to emit phase names for this to be data-driven. Treating title-taxonomy as a deferred data-contract item.
- PlanApprovalCard step-numbered list visual: the numbered circle badges in the plan steps (19×19 rounded-full with ACCENT tint) are not rendered in PlanGate. The plan text is a single markdown string from the daemon (per component-map §7), so per-step structured rendering is blocked by the data contract. The prose rendering is correct given the current data shape. Structural step-list is deferred pending a structured plan payload from the daemon.

</details>

---

### Palettes, find-in-path, directory picker  ·  19 findings (0B / 6M / 13m)

**🟠 Major — SearchPalette is vertically centered instead of top-anchored**  
`packages/app-tauri/src/components/ui/dialog.tsx:35 — DialogContent: 'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2'`  
*Artboard:* 06-palette.jsx line 141 — palette container: position fixed, alignItems flex-start, marginTop '11vh' (Spotlight-style drops from top)  
*Drift:* Prototype places the palette starting at 11vh from the top of the viewport (Spotlight-style). Built uses the shared DialogContent which centers at 50% vertically.  
*Fix:* In CommandDialog (command.tsx line 22–31) or in SearchPalette, pass a className override to DialogContent that replaces top-1/2 -translate-y-1/2 with top-[11vh] translate-y-0 (or a custom top-anchored palette-specific DialogContent).  
<sub>verify: dialog.tsx line 35 uses 'top-1/2 -translate-y-1/2' (vertical center), not 'top-[11vh]' for Spotlight-style drop from top.</sub>  

**🟠 Major — SearchPalette is missing the keyboard-hint footer bar**  
`packages/app-tauri/src/components/overlays/SearchPalette.tsx:62–112 — CommandDialog has no footer child`  
*Artboard:* 06-palette.jsx lines 216–223 — 34px footer strip: ↑↓ Navigate · ⏎ Open · esc Dismiss, each as a <kbd> chip on bg-mf-chip (T.chipBg) with T.text3  
*Drift:* The footer keyboard-hint bar is entirely absent. There are no kbd affordance chips visible to guide keyboard navigation.  
*Fix:* Add a footer div inside the CommandDialog (after CommandList), rendered as a flex row with gap-4 h-34 px-14, bg-mf-content2, border-t border-border. Map [['↑↓','Navigate'],['⏎','Open'],['esc','Dismiss']] to kbd chips styled bg-mf-chip text-mf-text-3 text-micro font-semibold rounded-xs.  
<sub>verify: SearchPalette.tsx lines 62-112 has no footer element after CommandList; the keyboard-hint bar is entirely absent.</sub>  

**🟠 Major — SearchPalette CommandList max-height is too short (320px vs ~470px prototype)**  
`packages/app-tauri/src/components/ui/command.tsx:59 — CommandList: max-h-80 (320px)`  
*Artboard:* 06-palette.jsx line 171 — list container: flex:1 inside a maxHeight:'62vh' modal; subtracting the 54px header and 34px footer gives ~470px at 900px viewport  
*Drift:* CommandList is capped at 320px. The prototype list area grows to ~470px at typical desktop viewport heights, showing substantially more results before scrolling.  
*Fix:* Either set CommandList to max-h-[62vh] or max-h-[calc(62vh-88px)], or expose a className prop so SearchPalette can override it to match the artboard's intended density.  
<sub>verify: command.tsx line 59 sets CommandList to 'max-h-80' (320px fixed) instead of flexible ~470px at 62vh as in prototype.</sub>  

**🟠 Major — SearchPalette active/selected row uses wrong background tint (hover tint, not primary tint)**  
`packages/app-tauri/src/components/ui/command.tsx:106 — CommandItem: data-[selected=true]:bg-accent (bg-accent = rgba(0,0,0,0.04), the hover tint)`  
*Artboard:* 06-palette.jsx line 183 — active row: background: `${ACCENT}14` hex = ~8% primary blue tint (T.selBg / mf-selection). Hover row uses T.rowHover = transparent rgba(0,0,0,0.04)  
*Drift:* The selected state uses the same subtle grey hover tint (bg-accent = rgba(0,0,0,0.04)) instead of the primary-blue tint (~8% primary, = bg-mf-selection). The selection highlight is nearly invisible and does not visually distinguish selected from hover.  
*Fix:* In command.tsx CommandItem, change data-[selected=true]:bg-accent to data-[selected=true]:bg-mf-selection and data-[selected=true]:text-accent-foreground to data-[selected=true]:text-foreground.  
<sub>verify: command.tsx line 106 uses 'data-[selected=true]:bg-accent' which is rgba(0,0,0,0.04) hover tint; should be 'bg-mf-selection' (rgba(10,132,255,0.10)) per globals.css.</sub>  

**🟠 Major — DirectoryPickerModal selected row uses bg-accent (hover tint) instead of bg-mf-selection**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:72 — PickerRow className: isSelected ? 'bg-accent text-accent-foreground' : '' (bg-accent = same as hover tint)`  
*Artboard:* 16-dirpicker.jsx line 110 — isSelected row: background T.selBg = mf-selection (rgba(10,132,255,0.10) classic-light) — primary blue tint. Line 114-115 — hover-only rows use T.rowHover = rgba(0,0,0,0.04)  
*Drift:* Selected rows use bg-accent (the generic hover surface, rgba(0,0,0,0.04)) instead of bg-mf-selection (the primary-blue selection tint). Selection is visually indistinguishable from hovering over a row.  
*Fix:* In PickerRow className, replace 'bg-accent text-accent-foreground' with 'bg-mf-selection text-foreground font-semibold' for the selected state.  
<sub>verify: DirectoryPickerModal.tsx line 72 PickerRow selected state uses 'bg-accent text-accent-foreground' (hover tint); should use 'bg-mf-selection text-foreground' (primary blue).</sub>  

**🟠 Major — DirectoryPickerModal missing per-node Loading indicator during child fetch**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:113–116 — FlatTreeView collect(): 'if (node.expanded && node.childrenPaths) collect(...)' — null childrenPaths (in-flight) silently skips rendering children without any loading indicator`  
*Artboard:* 16-dirpicker.jsx lines 130–133 — when node.expanded && node.loading: renders an indented 'Loading…' text row below the expanded node (with tw-pulse animation)  
*Drift:* When a user expands a directory node and children are being fetched (childrenPaths=null, expanded=true), the chevron flips open but no loading indicator appears — the tree looks broken/empty until data arrives. Prototype shows an animated 'Loading…' row.  
*Fix:* In FlatTreeView, after rendering PickerRow, add a condition: {node.expanded && node.childrenPaths === null && !node.loadError && <p className='px-3 py-0.5 text-micro text-mf-text-3 animate-pulse' style={{paddingLeft: `${8+(node.depth+1)*16}px`}}>Loading…</p>}.  
<sub>verify: DirectoryPickerModal.tsx FlatTreeView lines 106-138 collect() function renders no loading indicator when node.expanded && childrenPaths === null; artboard shows 'Loading…' row.</sub>  

**🟡 minor — SearchPalette file-row title not in font-mono**  
`packages/app-tauri/src/components/overlays/SearchPalette.tsx:103 — file row title: <span className="truncate font-medium">{result.name}</span> (no font-mono)`  
*Artboard:* 06-palette.jsx line 188 — title span: fontFamily: r.type === 'cmd' ? FONT : MONO (files, symbols, changed files all use monospace for the title)  
*Drift:* File result names are rendered in the default sans-serif font. Prototype uses monospace for all non-command row titles to reinforce the file/code nature of results.  
*Fix:* Add font-mono to the file-row title span. In SearchPalette.tsx line 103: className="truncate font-medium font-mono".  
<sub>verify: SearchPalette.tsx line 103 renders file title with 'font-medium' only, missing 'font-mono' for monospace display.</sub>  

**🟡 minor — SearchPalette group section label missing uppercase and letter-spacing**  
`packages/app-tauri/src/components/ui/command.tsx:79–81 — [cmdk-group-heading]: text-caption (11px) font-semibold text-muted-foreground (no uppercase, no letter-spacing)`  
*Artboard:* 06-palette.jsx line 172 — sectionLabel div: fontSize:10, fontWeight:700, color:T.text3, textTransform:'uppercase', letterSpacing:0.6  
*Drift:* Section headers (Sessions / Files) are 11px non-uppercase with no letter-spacing, rather than 10px bold uppercase with 0.6px tracking as in the artboard.  
*Fix:* Add [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[0.6px] to the CommandDialog Command className string (or to the CommandGroup className in command.tsx).  
<sub>verify: command.tsx lines 79-81 apply 'text-caption font-semibold' to section headers with no uppercase or letter-spacing; artboard requires 'textTransform:uppercase, letterSpacing:0.6'.</sub>  

**🟡 minor — SearchPalette missing return icon on keyboard-active rows**  
`packages/app-tauri/src/components/overlays/SearchPalette.tsx:78–108 — CommandItem has no trailing return-key affordance`  
*Artboard:* 06-palette.jsx line 209 — {active && !r.hint && !r.tag && r.type !== 'chg' && <Icon name='return' size=13 color=T.text3/>} shown trailing on active rows  
*Drift:* Active rows in the built palette show no return-key icon. The prototype shows a small enter/return icon at the trailing edge of the active item to signal that pressing Enter will activate it.  
*Fix:* Inside CommandItem, conditionally render a CornerDownLeft (or similar) lucide icon of size 3 text-mf-text-3 at the trailing end when the item is selected (data-[selected=true]).  
<sub>verify: SearchPalette.tsx lines 78-108 have no conditional trailing return-key icon render for active rows; artboard shows 'return' icon at trailing edge.</sub>  

**🟡 minor — SearchPalette CommandDialog has no data-testid on the dialog root**  
`packages/app-tauri/src/components/overlays/SearchPalette.tsx:62 — <CommandDialog open={open} onOpenChange=... > (no data-testid)`  
*Artboard:* 06-palette.jsx — the palette is the primary overlay modal (component-map §2: every dialog/modal root needs a stable scoped data-testid)  
*Drift:* The modal root element (CommandDialog) lacks a data-testid. The code rule requires every dialog/modal root to carry a <surface>-<element> testid.  
*Fix:* Add data-testid="search-palette-dialog" to the CommandDialog element. Since CommandDialog forwards to DialogContent, expose and thread a data-testid prop through command.tsx's CommandDialog to DialogContent.  
<sub>verify: SearchPalette.tsx line 62 CommandDialog element has no data-testid attribute; no data-testid forwarded through command.tsx CommandDialog to DialogContent.</sub>  

**🟡 minor — Dialog backdrop scrim is pure black instead of warm brown**  
`packages/app-tauri/src/components/ui/dialog.tsx:15 — DialogOverlay: 'bg-black/40 backdrop-blur-sm' (pure black at 40%, ~4px blur)`  
*Artboard:* 06-palette.jsx line 142 — scrim: background rgba(40,36,30,0.28) backdropFilter blur(2px) — warm brown, gentle. 16-dirpicker.jsx line 142 — scrim: rgba(22,19,15,0.40) — dark warm brown, no backdrop blur  
*Drift:* The overlay scrim is pure black at 40% opacity for all dialogs. Both prototype overlays use a warm-brown colour that matches the mf-window chrome; the SearchPalette scrim is also lighter (28%) and uses a gentler blur (2px).  
*Fix:* Change DialogOverlay to use a warm-tinted scrim: replace bg-black/40 with bg-[rgba(22,19,15,0.40)] (or introduce --mf-scrim token). For SearchPalette specifically, consider a lighter 28% variant. Remove backdrop-blur-sm from DialogOverlay (prototype uses no blur on the picker scrim).  
<sub>verify: dialog.tsx line 15 DialogOverlay uses 'bg-black/40 backdrop-blur-sm' (pure black 40%, 4px blur); artboard specifies warm-brown rgba(40,36,30,0.28) with 2px blur.</sub>  

**🟡 minor — DirectoryPickerModal missing home-path breadcrumb bar below title**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:260–265 — DialogHeader directly precedes the tree scroll area; no crumb bar`  
*Artboard:* 16-dirpicker.jsx lines 161–163 — a second hairline-bordered bar between the header and the tree: folder.fill icon (12px) + home path text in monospace, color T.text3, padding '7px 14px'  
*Drift:* The modal goes directly from the title to the tree with no breadcrumb showing the root path. Users have no visual anchor for where in the filesystem they are browsing.  
*Fix:* After the DialogHeader, add a crumb row: <div className='flex items-center gap-1.5 px-4 py-1.5 border-b border-border text-caption font-mono text-mf-text-3'><FolderIcon className='size-3 text-mf-text-4'/>{rootPath}</div>. Expose the root path (e.g. the '~' seed) from the browse effect as component state.  
<sub>verify: DirectoryPickerModal.tsx lines 260-274 DialogHeader directly precedes tree scroll area; no breadcrumb bar with folder icon + home path as shown in artboard.</sub>  

**🟡 minor — DirectoryPickerModal footer missing selected-path display**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:276–294 — DialogFooter only contains Cancel + Choose buttons; no path label`  
*Artboard:* 16-dirpicker.jsx line 172 — footer left side: monospace text showing selectedPath || DP_HOME, truncated, maxWidth 270px, T.text3 color  
*Drift:* The footer omits the currently-selected path label. Without it, users cannot verify the full path they are about to select before confirming.  
*Fix:* In DialogFooter, add a left-side span before the button group: <span className='flex-1 truncate text-caption font-mono text-mf-text-3 mr-2'>{selectedPath ?? '~'}</span>. Change DialogFooter flex direction from the default column-reverse to row (already overridden via className in the file).  
<sub>verify: DirectoryPickerModal.tsx DialogFooter (lines 276-294) contains only Cancel + Choose buttons; no left-side selected-path display with monospace font as in artboard.</sub>  

**🟡 minor — DirectoryPickerModal folder icon does not switch to filled variant when selected or expanded**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:85 — always renders <FolderIcon> (outline) regardless of selected/expanded state`  
*Artboard:* 16-dirpicker.jsx line 119 — FolderIcon: name = isFile ? 'doc' : (isSelected || node.expanded ? 'folder.fill' : 'folder') — solid folder on select or expand  
*Drift:* The folder icon is always the outline variant. The prototype fills the folder icon when the node is selected or expanded, giving a clear open-folder affordance.  
*Fix:* Import FolderOpenIcon from lucide-react. In PickerRow, replace <FolderIcon className='size-3.5 shrink-0 text-muted-foreground'/> with {expanded || isSelected ? <FolderOpenIcon className='size-3.5 shrink-0 text-primary'/> : <FolderIcon className='size-3.5 shrink-0 text-primary'/>}. Note: also change text-muted-foreground → text-primary to match the prototype's ACCENT-colored folder icons.  
<sub>verify: DirectoryPickerModal.tsx line 85 always renders outline FolderIcon; never switches to folder.fill when expanded or selected per artboard rule.</sub>  

**🟡 minor — DirectoryPickerModal folder icons use text-muted-foreground instead of text-primary**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:85 — FolderIcon className='size-3.5 shrink-0 text-muted-foreground'`  
*Artboard:* 16-dirpicker.jsx line 119 — folder icon color: ACCENT (= --primary, brand blue). File icon uses T.text3 (mf-text-3)  
*Drift:* Folder icons are grey (muted-foreground) instead of the accent/primary color used by the prototype. File icons should remain grey; only folder icons carry the accent.  
*Fix:* Change FolderIcon className to 'size-3.5 shrink-0 text-primary'. Keep FileIcon as 'size-3.5 shrink-0 text-mf-text-3'.  
<sub>verify: DirectoryPickerModal.tsx line 85 FolderIcon uses 'text-muted-foreground' (grey); should use 'text-primary' (accent blue) to match artboard.</sub>  

**🟡 minor — DirectoryPickerModal missing 'Empty' label for empty expanded directories**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:106–138 — FlatTreeView collect() shows nothing when an expanded node has childrenPaths=[] (loaded empty)`  
*Artboard:* 16-dirpicker.jsx lines 125–127 — after children render: {node.children.length === 0 && !node.loading && <div style={...}>Empty</div>} — indented placeholder text  
*Drift:* When a directory is expanded and has no children (childrenPaths=[]), the built tree shows no visual indicator. The prototype renders an indented 'Empty' label so users know the folder is genuinely empty rather than still loading.  
*Fix:* In FlatTreeView, add: {node.expanded && node.childrenPaths !== null && node.childrenPaths.length === 0 && <p className='text-micro text-mf-text-4 py-0.5' style={{paddingLeft:`${8+(node.depth+1)*16}px`}}>Empty</p>} after the PickerRow.  
<sub>verify: DirectoryPickerModal.tsx FlatTreeView (lines 106-138) shows no 'Empty' label when a node is expanded and childrenPaths === [] (loaded empty directory).</sub>  

**🟡 minor — DirectoryPickerModal Cancel button missing resting chip background**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:281 — Cancel className: 'rounded-md px-3 py-1.5 text-body text-muted-foreground hover:bg-accent hover:text-accent-foreground' (transparent at rest)`  
*Artboard:* 16-dirpicker.jsx line 174 — Cancel button: background T.chipBg = mf-chip (rgba(0,0,0,0.05)) always visible at rest — a subtle chip button, not a ghost  
*Drift:* The Cancel button is visually invisible at rest (transparent background). The prototype renders it as a subtle but present chip with mf-chip background, making it clearly a tappable target alongside the primary Select button.  
*Fix:* Add bg-mf-chip to the Cancel button className: 'rounded-md px-3 py-1.5 text-body bg-mf-chip text-muted-foreground hover:bg-accent hover:text-accent-foreground'.  
<sub>verify: DirectoryPickerModal.tsx line 281 Cancel button className has no resting background; should include 'bg-mf-chip' per artboard.</sub>  

**🟡 minor — DirectoryPickerModal missing data-testid on the dialog root**  
`packages/app-tauri/src/components/overlays/DirectoryPickerModal.tsx:253–258 — <Dialog open=... onOpenChange=...> / <DialogContent className=... > — no data-testid`  
*Artboard:* component-map.md §5 + CLAUDE.md code rules — every dialog/modal root needs a stable scoped data-testid  
*Drift:* The modal root (DialogContent) has no data-testid. Individual rows and buttons are tagged, but the container itself is not, making it impossible to assert the modal is mounted in tests.  
*Fix:* Add data-testid="directory-picker-modal" to the DialogContent element at line 259.  
<sub>verify: DirectoryPickerModal.tsx line 259 DialogContent element has no data-testid attribute; required per component-map rule.</sub>  

**🟡 minor — FindInPathModal missing data-testid on the dialog root**  
`packages/app-tauri/src/components/overlays/FindInPathModal.tsx:180–186 — <Dialog ...><DialogContent className="max-w-2xl p-0 gap-0"> — no data-testid`  
*Artboard:* component-map.md §5 + CLAUDE.md code rules — every dialog/modal root needs a stable scoped data-testid  
*Drift:* The FindInPathModal's DialogContent element has no data-testid. Input, result rows, and the checkbox are tagged, but the modal container itself is not.  
*Fix:* Add data-testid="find-in-path-modal" to the DialogContent element at line 186.  
<sub>verify: FindInPathModal.tsx line 186 DialogContent element has no data-testid attribute; required per component-map rule.</sub>  

<details><summary>Deferred (not drift) — 3</summary>

- The > cmd / @ symbol / # changes prefix modes shown in 06-palette.jsx are prototype-only modes for the legacy file palette. The app-tauri tracker explicitly replaces these with a unified sessions+files palette (no cmd/sym/chg modes). These mode-chip UI elements and their underlying data (commands list, symbol index, git changed files) are not built and are correctly excluded — not a drift.
- The 'esc' kbd chip in the SearchPalette input bar (06-palette.jsx line 167) is prototype-only affordance paired with the old file-mode palette; cmdk provides its own Escape handling. Excluding the standalone kbd chip is acceptable given the footer hint bar (overlays-palette-2) covers it.
- FilePickerDialog uses the same shared DialogContent and CommandDialog patterns as SearchPalette. The font-mono filename and group-label typography gaps (overlays-palette-5, overlays-palette-6) apply equally to FilePickerDialog's FileRow component (use-file-search.tsx:76). These are the same underlying primitives — fixing them in command.tsx and use-file-search.tsx covers FilePickerDialog automatically.

</details>

---

### Tasks / Todos  ·  13 findings (0B / 6M / 7m)

**🟠 Major — Status dot is non-interactive — cycle-status behavior missing**  
`packages/app-tauri/src/features/tasks/TaskListRow.tsx:88`  
*Artboard:* 12-todos.jsx TdStatusDot (lines 477–486): a <button> that cycles open→in_progress→done→open on click; distinct visuals per state (open = plain ring, in_progress = ring+pulsing inner dot, done = filled green with checkmark).  
*Drift:* Built renders a plain, non-interactive <span> with a static dot color via statusDotColor(). There is no onCycle handler, no button semantics, and no visual distinction between open (ring border) and in_progress (ring+pulse). The cycle behavior is entirely absent.  
*Fix:* Replace the static <span> with a <button> wrapping the status indicator. Implement three visual states: open = 14px circle with border (border-color transitions to primary on hover), in_progress = 15px ring (border-primary) + 5px pulsing inner dot (animate-pulse bg-primary), done = 16px filled circle (bg-mf-success) with a white checkmark (Check size=9). Wire an onCycle prop (open→in_progress→done→open) and call useTodosStore.move() on click. Match data-testid pattern tasks-list-row-cycle-{number}.  
<sub>verify: TaskListRow.tsx:88 renders a static <span> with statusDotColor(), not a <button> with onCycle handler as shown in artboard TdStatusDot (lines 477-486).</sub>  

**🟠 Major — Space / ArrowLeft / ArrowRight keyboard shortcuts missing from list view**  
`packages/app-tauri/src/features/tasks/TaskListView.tsx:63–87`  
*Artboard:* 12-todos.jsx TdListView keyboard handler (lines 556–576): Space → cycle status on selected row; ArrowRight → expand selected row; ArrowLeft → collapse selected row. All four are in TdFooterHints display.  
*Drift:* handleKeyDown only handles ArrowDown/j, ArrowUp/k, Enter, E. Space (cycle status), ArrowRight (expand), and ArrowLeft (collapse) are not handled. The footer hint bar also omits 'Space — Toggle status'.  
*Fix:* Add cases in handleKeyDown: ' ' → call useTodosStore.move to cycle status on the selected todo; ArrowRight → setExpanded(prev => new Set(prev).add(selectedNumber)); ArrowLeft → setExpanded(prev => { const s = new Set(prev); s.delete(selectedNumber); return s; }). Update the footer hint span to: '↑/↓ select · ↵ start session · E edit · Space toggle status'.  
<sub>verify: TaskListView.tsx:63-87 handleKeyDown lacks Space/ArrowRight/ArrowLeft cases; footer hint (line 149) omits 'Space toggle status' present in artboard lines 556-576.</sub>  

**🟠 Major — List row hover actions missing Delete button**  
`packages/app-tauri/src/features/tasks/TaskListRow.tsx:113–149`  
*Artboard:* 12-todos.jsx TdListRow (lines 513–517): the hover action cluster has 3 buttons — Play (start session), pencil (Edit), trash (Delete). Trash always visible (for done rows too), Play hidden for done.  
*Drift:* Built hover cluster only has Play and Edit buttons. There is no Delete (Trash2) button at all. Deletions from the list view are only possible by opening the edit modal and using the footer Delete button there.  
*Fix:* Add an onDelete prop to TaskListRow. Inside the hover actions div (after the Edit button), render a Trash2 button with data-testid=tasks-list-row-delete-{number}, calling e.stopPropagation() + onDelete(todo.id), styled as text-muted-foreground hover:text-destructive hover:bg-accent. Wire onDelete from TaskListView → useTodosStore.remove.  
<sub>verify: TaskListRow.tsx:113-149 hover action cluster has only Play+Edit buttons; artboard lines 513-517 shows three buttons including trash/Delete.</sub>  

**🟠 Major — Priority pill missing colored dot indicator**  
`packages/app-tauri/src/features/tasks/TaskListRow.tsx:103–111 and TaskCard.tsx:94–101`  
*Artboard:* 12-todos.jsx TdPill (lines 92–103): renders a 6×6px circle in the priority's dot color before the label text. TD_PRI dot colors: critical=#c4302b, high=#e8730f, medium=#e0a019, low=#c4c2bd.  
*Drift:* Built priority pill uses priorityTint() → Tailwind bg+text tint classes only (e.g. bg-orange-100 text-orange-700). No leading colored dot is rendered. The visual affordance for quick priority scanning at a glance (the colored dot) is absent.  
*Fix:* Add a leading dot to the priority pill: prepend a <span className='w-1.5 h-1.5 rounded-full shrink-0 inline-block mr-1' style corresponding to the priority color> inside the pill. Export a priorityDotClass() from task-palettes.ts (e.g. critical → bg-red-600, high → bg-orange-500, medium → bg-yellow-500, low → bg-muted-foreground/60) and apply it to the dot span.  
<sub>verify: TaskListRow.tsx:103-111 priority pill renders text only via priorityTint(); artboard TdPill (lines 92-103) includes a 6×6px leading dot.</sub>  

**🟠 Major — List view empty state missing checklist.box icon**  
`packages/app-tauri/src/features/tasks/TaskListView.tsx:109–112`  
*Artboard:* 12-todos.jsx TdListView (lines 580–584): empty state renders Icon name='checklist.box' size=26 color=T.text4 above the text label.  
*Drift:* Built empty state only renders a text string ('No tasks yet' or 'No tasks match these filters') with no icon. The visual anchor for the empty state is absent.  
*Fix:* Import TasksGlyph from '@/layout/surface-icons' (which already ports checklist.box) or a ListChecks icon. Wrap in a flex-col items-center gap-2 container; render the glyph at size 26 with className='text-muted-foreground/40' above the text. Match the artboard structure: icon then message, both centered.  
<sub>verify: TaskListView.tsx:109-112 empty state renders text only; artboard lines 580-584 shows Icon name='checklist.box' size=26 above text.</sub>  

**🟠 Major — 'Last updated' sort key absent from SortMenu**  
`packages/app-tauri/src/features/tasks/SortMenu.tsx:26–32 and todos-filters.ts:18`  
*Artboard:* 12-todos.jsx TD_SORTS (lines 240–245): 4 keys — priority, number, updated (label 'Last updated'), type. The sort function handles updated: new Date(a.updated) - new Date(b.updated).  
*Drift:* Built SORT_KEYS has only number, priority, type. TodoSortKey type does not include 'updated'. The 'Last updated' sort option the artboard shows in the SortMenu dropdown is absent.  
*Fix:* Add 'updated' to TodoSortKey = 'number' | 'priority' | 'type' | 'updated' in todos-filters.ts. Add the sort case: case 'updated': return (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()) * dir. Add { key: 'updated', label: 'Last updated' } to SORT_KEYS in SortMenu.tsx.  
<sub>verify: todos-filters.ts:18 TodoSortKey lacks 'updated' key; SortMenu.tsx:26-32 SORT_KEYS has only number/priority/type; artboard TD_SORTS (lines 240-245) includes 'updated'.</sub>  

**🟡 minor — TasksBoard header icon uses wrong color (muted-foreground vs ACCENT/primary)**  
`packages/app-tauri/src/features/tasks/TasksBoard.tsx:73`  
*Artboard:* 12-todos.jsx TodosBoard header (line 719): Icon name='checklist.box' size=16 color={ACCENT} — the brand accent color.  
*Drift:* Built renders <ListChecks size={15} className='text-muted-foreground'> — muted gray instead of the ACCENT/primary color the artboard specifies.  
*Fix:* Change the className to 'text-primary shrink-0'. Also consider replacing lucide ListChecks with the design-system TasksGlyph from '@/layout/surface-icons' (which ports the prototype's checklist.box SF Symbol precisely).  
<sub>verify: TasksBoard.tsx:73 ListChecks uses 'text-muted-foreground' className; artboard line 719 specifies color={ACCENT}.</sub>  

**🟡 minor — New task button label truncated to 'New' instead of 'New task'**  
`packages/app-tauri/src/features/tasks/TasksBoard.tsx:120`  
*Artboard:* 12-todos.jsx TodosBoard header (line 725): button label is 'New task' (full text, with Plus icon).  
*Drift:* Built button renders 'New' only. The full label 'New task' matches the artboard and conveys intent more clearly.  
*Fix:* Change the button text from 'New' to 'New task'.  
<sub>verify: TasksBoard.tsx:121 button text is 'New'; artboard line 726 shows 'New task'.</sub>  

**🟡 minor — Create-new submit button says 'Save task' instead of 'Create task'**  
`packages/app-tauri/src/features/tasks/TaskEditModal.tsx:283`  
*Artboard:* 12-todos.jsx TdEditModal footer (line 456–457): {isEdit ? 'Save changes' : 'Create task'}.  
*Drift:* Built renders 'Save task' for new (todo===null) mode. The artboard uses 'Create task' to distinguish creation from editing.  
*Fix:* Change the ternary to: saving ? 'Saving…' : todo ? 'Save changes' : 'Create task'.  
<sub>verify: TaskEditModal.tsx:283 renders 'Save task' for create mode; artboard lines 456-457 specifies 'Create task'.</sub>  

**🟡 minor — QuickTaskDialog footer missing 'Esc to cancel' hint**  
`packages/app-tauri/src/features/tasks/QuickTaskDialog.tsx:274–276`  
*Artboard:* 12-todos.jsx QuickTaskDialog (lines 797–799): footer shows '⌘↵ to create · Esc to cancel'.  
*Drift:* Built only renders '⌘↵ to create'. The 'Esc to cancel' hint text is absent. (The Esc key does work via the Dialog's onOpenChange, but the hint is not shown.)  
*Fix:* Update the footer hint span to: '<kbd>⌘↵</kbd> to create · <kbd>Esc</kbd> to cancel'. Style both kbd elements consistently with the existing px-1 py-0.5 bg-muted rounded border border-border.  
<sub>verify: QuickTaskDialog.tsx:274-276 footer shows only '⌘↵ to create'; artboard lines 797-799 includes '· Esc to cancel' hint.</sub>  

**🟡 minor — Board columns use rounded-card layout vs artboard hairline-grid layout**  
`packages/app-tauri/src/features/tasks/TaskBoardView.tsx:41 and TaskColumn.tsx:60–66`  
*Artboard:* 12-todos.jsx TdBoardView (lines 607–631): board is a CSS grid with gap:1 and background:T.hairline as the grid background (hairlines between columns), each column has no border-radius and uses T.content2 background.  
*Drift:* Built uses flex with gap-3 and p-3 at the board level; each TaskColumn has rounded-lg and bg-muted/40. This creates visually separated card-like columns with rounded corners and gaps, not the hairline-separated flat-column layout the artboard shows.  
*Fix:* In TaskBoardView: change 'flex gap-3 min-h-0 flex-1 overflow-x-auto p-3' to 'grid grid-cols-3 min-h-0 flex-1 gap-px bg-border'. In TaskColumn: remove rounded-lg; change the drag-over state from 'bg-accent/60 ring-1 ring-border' to 'bg-primary/5'; use 'bg-mf-content2 dark:bg-card' as the default column background.  
<sub>verify: TaskBoardView.tsx:41 uses flex gap-3 layout; TaskColumn.tsx:60-62 applies rounded-lg; artboard lines 607-631 shows CSS grid gap:1 with hairline background separator.</sub>  

**🟡 minor — TasksModalHost uses fixed max-w-4xl; artboard adapts width per view (list: 880px / board: 90% up to 1200px)**  
`packages/app-tauri/src/features/tasks/TasksModalHost.tsx:69`  
*Artboard:* 12-todos.jsx TodosBoard (line 712): modal width adapts: list view = 880px (max 94vw), board view = '90%' (max 1200px), with a CSS transition on width change.  
*Drift:* Built DialogContent uses a fixed 'max-w-4xl' (896px) regardless of whether list or board view is active. In board view, the modal is narrower than the artboard target and loses the adaptive width signal.  
*Fix:* Lift view state from TasksBoard to TasksModalHost (or read it from useTodosStore). Apply conditional classes: view === 'board' ? 'max-w-[90%] max-w-[1200px]' : 'max-w-[880px]'. Add transition-[max-width] duration-200 for the smooth resize the artboard shows.  
<sub>verify: TasksModalHost.tsx:69 DialogContent uses fixed 'max-w-4xl'; artboard line 712 adapts width per view (880px list / 90% up to 1200px board).</sub>  

**🟡 minor — in_progress status dot is a static circle, not a ring with pulsing inner dot**  
`packages/app-tauri/src/features/tasks/task-palettes.ts:80 (statusDotColor returns 'bg-blue-500') and TaskListRow.tsx:88`  
*Artboard:* 12-todos.jsx TdStatusDot in_progress branch (lines 481–482): renders a 15px ring (border: 2px solid ACCENT) containing a 5px inner dot with className 'tw-pulse' (keyframe animation 0%/100%→opacity:1, 50%→opacity:0.45).  
*Drift:* Built renders a plain solid blue-500 circle. There is no ring + pulsing inner dot visual that communicates active/running state. TasksDrawerList uses the same static dot.  
*Fix:* Create a StatusDot component (or update the <span> in TaskListRow) that renders distinct shapes per status: open → border circle (border-border hover:border-primary); in_progress → border circle (border-primary) with a nested 5px span (bg-primary animate-pulse); done → filled circle (bg-mf-success) with a white Check icon size=9.  
<sub>verify: statusDotColor (task-palettes.ts:80) returns static 'bg-blue-500' for in_progress; artboard lines 481-482 shows 15px ring border with 5px pulsing inner dot.</sub>  

<details><summary>Deferred (not drift) — 3</summary>

- Multi-image gallery lightbox with prev/next nav for todo attachments — tracker item S (MIGRATION-TRACKER.md:350) deferred; single-image ZoomableImage IS built.
- Assignees field in the edit modal is a plain text input (comma-separated string) rather than an avatar picker with TdAvatar components — the artboard uses a simple text field too, so no delta; but the assignees are not shown in list/board card rows (artboard also omits them from card rows so this is per-spec).
- The 'Start session' prefill via composer().setText() is not auditable in the design review; it is behavioral wiring documented as built in the tracker.

</details>

---

### Settings dialog & panes  ·  11 findings (0B / 6M / 5m)

**🟠 Major — Dialog missing 50 px header band with 'Settings' title**  
`packages/app-tauri/src/features/settings/SettingsDialog.tsx:71-84`  
*Artboard:* 05-settings.jsx SettingsModal shell lines 691-704 — a 50 px flex header row (bg T.content2, border-bottom hairline) containing 'Settings' at 15 px/700 weight and the X close button  
*Drift:* The built DialogContent goes directly from the border to SettingsSidebar + ScrollArea with no header band. The close button is absolutely positioned at top-right (right-4 top-4) and floats over the sidebar/content divide. There is no visible 'Settings' title anywhere in the dialog. Radix DialogPrimitive.Title is also absent, causing an a11y violation (screen readers cannot announce the dialog name).  
*Fix:* Add a flex header row inside DialogContent before the body: `<div className="flex h-[50px] shrink-0 items-center justify-between border-b border-border bg-card px-[18px]"><DialogPrimitive.Title className="text-heading font-bold text-foreground">Settings</DialogPrimitive.Title><SettingsDialogCloseBtn/></div>`. Remove the absolute-positioned close button; move it into this header. Adding DialogPrimitive.Title satisfies the Radix a11y requirement.  
<sub>verify: DialogContent (lines 71-84) lacks header band; close button absolutely positioned at top-right; no DialogPrimitive.Title present.</sub>  

**🟠 Major — Sidebar nav background not set — inherits white popover surface instead of mf-content2**  
`packages/app-tauri/src/features/settings/SettingsSidebar.tsx:74`  
*Artboard:* 05-settings.jsx SettingsModal sidebar div line 709 — background: T.content2 (#f8f6f2 light / #212330 dark), borderRight: 0.5px solid T.hairline  
*Drift:* The `<nav>` element has no background class; it inherits bg-popover (#ffffff light), so the sidebar is pure white and visually indistinguishable from the content area. The prototype uses the slightly-warmer content2 surface to separate sidebar from content.  
*Fix:* Add `bg-card` to the nav className (--card = --mf-content2 value, #f8f6f2 light / #212330 dark). The hairline border is already present as `border-r border-border`.  
<sub>verify: SettingsSidebar nav (line 74) has no background class; inherits bg-popover (#ffffff light) instead of bg-card (#f8f6f2).</sub>  

**🟠 Major — Sidebar active nav item uses hover surface instead of brand-tinted background**  
`packages/app-tauri/src/features/settings/SettingsSidebar.tsx:24-28`  
*Artboard:* 05-settings.jsx SettingsModal sidebar nav item line 722 — active state: background `${ACCENT}14` (primary color at ~8 % opacity, e.g. rgba(10,132,255,0.08)), icon color = ACCENT, label font-weight 600 + T.text  
*Drift:* Active items use `bg-accent` which maps to `--accent = rgba(0,0,0,0.04)` — the same near-invisible tint as the hover state. In light mode this is a barely-visible dark tint, not the blue/brand tint the artboard shows. Active and hover states look identical. Additionally the active icon has no `text-primary` class so it remains muted-foreground gray instead of the brand accent color.  
*Fix:* Replace `bg-accent text-accent-foreground` with `bg-primary/10 text-foreground` for the active state. Add `text-primary` to the Icon for the active item (pass a conditional className prop). Non-active items correctly use `hover:bg-accent/50` which is fine.  
<sub>verify: Active SettingsNavItem (line 26) uses bg-accent which is rgba(0,0,0,0.04)—nearly invisible tint, not brand-tinted; Icon has no active color override.</sub>  

**🟠 Major — Provider pane missing colored avatar header and installed/not-installed status indicator**  
`packages/app-tauri/src/features/settings/panes/providers/ProvidersPane.tsx:35`  
*Artboard:* 05-settings.jsx StgProvider lines 302-315 — a 30x30 rounded-8 colored avatar badge showing the provider's initial, provider name at 17px/700, and a row with a 6x6 colored status dot + 'Detected on PATH' (green) or 'Not installed' (muted) text  
*Drift:* The provider heading is a plain `<h3 className="text-heading font-medium">` showing only the adapter name. No colored avatar, no installation status dot. The prototype uses the status header as the primary way users understand whether an adapter is available. The `AdapterInfo.installed` boolean is available in the type but not surfaced.  
*Fix:* Add a provider header section before `<ProviderConfigForm>`: a flex row with a colored avatar `<span>` (deterministic hue per adapterId or a fixed palette lookup, 30x30, rounded-md, bg-primary/20 fallback, showing the first letter), then the adapter name at `text-title font-bold`, and below that a status row with a `w-1.5 h-1.5 rounded-full` dot (`bg-mf-success` when `adapter.installed`, `bg-mf-text-4` otherwise) + label text ('Detected on PATH' or 'Not installed') using `text-caption text-mf-success` or `text-mf-text-3`.  
<sub>verify: ProvidersPane heading (line 35) is plain text-heading font-medium with no colored avatar or installed status indicator visible.</sub>  

**🟠 Major — Notifications pane missing 'Notifications' section heading**  
`packages/app-tauri/src/features/settings/panes/notifications/NotificationsPane.tsx:60`  
*Artboard:* 05-settings.jsx StgNotifications line 425 — <StgHeading>Notifications</StgHeading> rendered as 17px/700/T.text before the first group  
*Drift:* The built NotificationsPane renders the SettingGroup title groups directly with no section heading. The prototype shows a prominent 'Notifications' heading (StgHeading, 17px bold) above the first group — matching the same heading pattern used by Remote Access pane.  
*Fix:* Add `<h3 className="text-title font-bold text-foreground mb-4">Notifications</h3>` as the first child of the pane root div, consistent with RemoteAccessPane.  
<sub>verify: NotificationsPane (line 60) renders SettingGroup items directly; no 'Notifications' section heading above first group.</sub>  

**🟠 Major — All pane section headings use text-heading/font-medium (15px) instead of text-title/font-bold (17px)**  
`packages/app-tauri/src/features/settings/panes/general/GeneralPane.tsx:37, panes/remote-access/RemoteAccessPane.tsx:15`  
*Artboard:* 05-settings.jsx StgHeading lines 116-117 — font-size: 17, font-weight: 700, color: T.text, letterSpacing: -0.3 — used for 'General', 'Remote Access', 'Notifications', 'About' (Mainframe) headings  
*Drift:* GeneralPane uses `text-heading font-medium` (15px/500) and RemoteAccessPane uses `text-heading font-semibold` (15px/600). The prototype's StgHeading is 17px/700. The `text-title` token (1.0625rem = 17px) exists in globals.css and should be used instead.  
*Fix:* Replace `text-heading font-medium` / `text-heading font-semibold` with `text-title font-bold` in all pane heading `<h3>` elements (GeneralPane.tsx:37, RemoteAccessPane.tsx:15+26, and the forthcoming NotificationsPane heading).  
<sub>verify: GeneralPane (lines 37, 42) and RemoteAccessPane (lines 15, 26) use text-heading font-medium/semibold; prototype and globals.css define text-title (1.0625rem=17px) as font-bold requirement.</sub>  

**🟡 minor — Dialog backdrop overlay uses cool black instead of warm dark tint**  
`packages/app-tauri/src/features/settings/SettingsDialog.tsx:12`  
*Artboard:* 05-settings.jsx SettingsModal overlay line 681 — background: rgba(40,36,30,0.32), backdropFilter: blur(2px) — a warm brownish dark scrim  
*Drift:* Built overlay class is `bg-black/40 backdrop-blur-sm` — pure black at 40% opacity, which is both cooler in hue and more opaque than the prototype's rgba(40,36,30,0.32) warm brown at 32% opacity.  
*Fix:* Change overlay to `bg-[rgba(40,36,30,0.32)] backdrop-blur-sm` to match the warm-chrome scrim tone.  
<sub>verify: SettingsDialogOverlay (line 12) uses bg-black/40; prototype specifies rgba(40,36,30,0.32)—warm brown at 32% vs cool black at 40%.</sub>  

**🟡 minor — Sidebar provider sub-items use a generic gray left border instead of per-provider color**  
`packages/app-tauri/src/features/settings/SettingsSidebar.tsx:47`  
*Artboard:* 05-settings.jsx SettingsModal sidebar provider sub-items line 737 — `borderLeft: 2px solid ${sel ? p.color : 'transparent'}` per provider (orange/green/blue/purple per provider)  
*Drift:* The sub-item container uses `border-l border-border pl-3` — a single gray border for all providers. The prototype renders a colored left accent bar (matching each provider's brand color) on the selected item and transparent on unselected ones. The AdapterInfo domain type has no color field, so provider-specific coloring cannot be reproduced without one.  
*Fix:* Add an optional `color` field to `AdapterInfo` (packages/types/src/adapter.ts), populate it from the daemon's adapter registry, then apply `border-l-2` with `style={{ borderColor: sel ? adapter.color : 'transparent' }}` per item. The built code should also add the 15x15 initial-badge in the sub-nav to match the prototype (colored rounded square + initial letter).  
<sub>verify: ProviderSubItems (line 47) uses gray border-l border-border for all items; prototype shows per-provider colored borders; AdapterInfo type has no color field.</sub>  

**🟡 minor — Notifications permission group label says 'Permissions' instead of 'Permission Requests'**  
`packages/app-tauri/src/features/settings/panes/notifications/NotificationsPane.tsx:78`  
*Artboard:* 05-settings.jsx StgNotifications line 430 — StgGroup title='Permission Requests'  
*Drift:* Built group title is 'Permissions'; prototype says 'Permission Requests'. The longer label distinguishes this group from the generic concept of permissions.  
*Fix:* Change `<SettingGroup title="Permissions">` to `<SettingGroup title="Permission Requests">`.  
<sub>verify: NotificationsPane SettingGroup (line 78) title is 'Permissions'; prototype specifies 'Permission Requests'.</sub>  

**🟡 minor — Sidebar nav icon size 15px vs prototype 14px**  
`packages/app-tauri/src/features/settings/SettingsSidebar.tsx:30`  
*Artboard:* 05-settings.jsx SettingsModal sidebar nav item line 725 — Icon name=t.icon size={14}  
*Drift:* Built SettingsNavItem renders `<Icon size={15}>` while the artboard specifies 14px icons. 1px across all nav icons produces a slightly denser look.  
*Fix:* Change `size={15}` to `size={14}` in SettingsNavItem.  
<sub>verify: SettingsNavItem Icon (line 30) renders size={15}; prototype specifies size={14}.</sub>  

**🟡 minor — Close button hover affordance is opacity-only, not row-hover background**  
`packages/app-tauri/src/features/settings/SettingsDialog.tsx:19-29`  
*Artboard:* 05-settings.jsx SettingsModal close button lines 697-703 — onMouseEnter sets background to T.rowHover (--accent), onMouseLeave resets to transparent; button is inside the header band  
*Drift:* The built close button uses `opacity-70 hover:opacity-100` with no background change. The prototype fills the button's background with the hover surface on hover. Once the header band (settings-1) is added, the close button should also adopt the standard warm-chrome hover fill.  
*Fix:* After moving the button into the header band per settings-1 fix, change its className to `flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-accent transition-colors`.  
<sub>verify: SettingsDialogCloseBtn (lines 19-28) uses opacity-70 hover:opacity-100 with no background change; prototype shows background fill on hover.</sub>  

<details><summary>Deferred (not drift) — 3</summary>

- About pane: logo icon (52x52 gradient 'm' glyph), 'Check for updates' button, and 'Release notes' button are intentionally omitted — the design doc (2026-06-15-settings-surface-design.md) explicitly states 'Omit Check for updates / Release notes (no updater); keep it a thin read-only pane.' Tauri updater is not yet wired.
- About pane: 'Channel' and 'Electron' rows from the prototype are not present — replaced with 'Home directory' from getAppInfo(); no runtime/channel data source exists in the Tauri bridge.
- General pane: prototype shows a 2×2 'Accent theme' swatch grid (claude/codex/gemini/opencode colors). Production equivalent is the approved 3-axis appearance system (Mode × Scheme × Window Style) per component-map §8.4 — the swatch grid was prototype-only design exploration.

</details>

---

### Popovers (branch / launch / stop / tag)  ·  10 findings (0B / 5M / 5m)

**🟠 Major — Branch submenu renders as full-view swap instead of side-by-side flyout**  
`packages/app-tauri/src/features/git/BranchPopover.tsx:185-295 — PopoverContent routes {view==='list'} and {view==='submenu'} as mutually-exclusive views`  
*Artboard:* Popovers Review.html #branch-submenu — 600px artboard shows main branch list panel AND submenu panel simultaneously in a flex row (gap:6). Prototype body(): <div style={{display:'flex', alignItems:'flex-start', gap:6}}>{main(close)}{selMeta && <BranchSubmenu .../>}</div>  
*Drift:* The artboard keeps the branch list visible while the submenu is open beside it. The built code replaces the entire list with the submenu (full-view swap). The user cannot see the branch list context while reviewing submenu actions.  
*Fix:* Change BranchPopover view logic: when a branch is selected, render the main list and BranchSubmenu side-by-side inside a flex-row wrapper. The 'submenu' view state is redundant — keep 'list' active and show the submenu panel conditionally beside it (selected !== null). The ArrowLeft back button in BranchSubmenu is also an artboard divergence introduced to compensate for the swap layout; remove it once the side-by-side layout is restored.  
<sub>verify: BranchPopover.tsx lines 192-262 show mutually-exclusive view rendering ({view==='list'} and {view==='submenu'}), while prototype line 422 renders both panels side-by-side in a flex row with gap:6.</sub>  

**🟠 Major — BranchDivergence uses plain text arrows instead of lucide Arrow icons**  
`packages/app-tauri/src/features/git/BranchRow.tsx:23-26 — uses plain UTF-8 characters '↑' and '↓' instead of icon components`  
*Artboard:* Popovers Review.html #branch (BranchRow, BranchDivergence). Prototype (13-popover.jsx:447-451): ahead shows <Icon name='arrow.up' size={9} color={T.green}/>{ahead}, behind shows <Icon name='arrow.down' size={9} color={T.amber}/>{behind}.  
*Drift:* The artboard uses properly sized (9px) lucide-equivalent arrow icons with semantic color tokens (green for ahead, amber for behind). The built code uses plain text Unicode arrows — these are taller/heavier than a 9px icon at body font size and do not carry the visual precision of the design.  
*Fix:* Replace the '↑' and '↓' text with <ArrowUp size={9} className='text-mf-success'/> and <ArrowDown size={9} className='text-mf-warning'/> from lucide-react, matching the artboard's icon + number pairing.  
<sub>verify: BranchRow.tsx lines 24-25 render plain UTF-8 '↑' and '↓' characters; prototype 13-popover.jsx lines 448-449 use lucide Icon components with size={9}.</sub>  

**🟠 Major — ConflictRow 'C' conflict badge rendered as plain text, not a pill badge**  
`packages/app-tauri/src/features/git/ConflictView.tsx:49-55 — renders just <span className='text-destructive font-mono text-caption shrink-0'>C</span> with no container box`  
*Artboard:* Popovers Review.html #conflicts (ConflictView/ConflictRow). Prototype (13-popover.jsx:511-520): each conflict file row has a 17×17px rounded-4 span with bg:T.red1a and text T.red — a visually distinct badge. The file path uses direction:'rtl' textAlign:'left' for end-truncation.  
*Drift:* The artboard shows a small rectangular badge (red background tint, red text, rounded) as the conflict status indicator. The built code renders a bare 'C' character styled only with text color — no box, no background, no consistent width. The pill makes the conflict indicator scannable at a glance; the plain character does not.  
*Fix:* Wrap the 'C' in a span with: w-[17px] h-[17px] rounded shrink-0 inline-flex items-center justify-center bg-destructive/10 text-destructive font-mono text-caption font-bold. Also ensure the file path span uses style={{ direction: 'rtl', textAlign: 'left' }} (already present at line 51 — keep it).  
<sub>verify: ConflictView.tsx line 50 renders bare 'C' text with no container; prototype lines 516-517 show 17×17px box with red background tint and rounded corners.</sub>  

**🟠 Major — TagPopover tag rows use a trailing checkmark icon instead of a leading checkbox square**  
`packages/app-tauri/src/features/sessions/tags/TagPopover.tsx:245-258 — renders a trailing <Check size={12} className='text-primary'/> that only appears when applied; no checkbox square element exists`  
*Artboard:* Popovers Review.html #checkrows (PopCheckRow). Prototype (13-popover.jsx:164-181): each row has a 15×15px square (borderRadius:4) at the start — filled with ACCENT and no border when checked, transparent with 1.5px solid T.border when unchecked — plus an optional swatch dot.  
*Drift:* The artboard uses a leading checkbox square (filled/empty state is always visible) followed by a color swatch dot. The built code uses a trailing checkmark that disappears when unchecked — the unchecked state has no affordance showing a selectable toggle. The swatch dot is still present (via TAG_DOT_STYLE inline style). The row padding and gap also differ (artboard: gap:9, padding:6px 8px; built: gap-2, px-2 py-1).  
*Fix:* Add a 15×15px leading checkbox square before the swatch dot: w-[15px] h-[15px] rounded shrink-0 inline-flex items-center justify-center, with bg-primary when checked (containing <Check size={9} className='text-primary-foreground'/>) and border border-border/50 bg-transparent when unchecked. Move it to be the first child of the row. Adjust gap to gap-[9px] and padding to py-1.5 px-2 to match.  
<sub>verify: TagPopover.tsx line 257 renders trailing checkmark only when checked; prototype lines 165-180 PopCheckRow always shows leading 15×15px checkbox square (filled or outlined).</sub>  

**🟠 Major — LaunchPopover config rows missing per-config type icon (eye/terminal)**  
`packages/app-tauri/src/features/run/LaunchPopover.tsx:120-129 (LaunchConfigRow) — renders only the config name and a status icon; no leading type icon`  
*Artboard:* Popovers Review.html #action / #toolbar LaunchPicker (prototype/02-chrome.jsx:66-94): each config row shows a type-specific icon — eye (teal #1f8a5b) for preview configs, terminal for process configs — at 12px, left of the label.  
*Drift:* The artboard establishes that each launch config row is identifiable by its type icon (preview vs process). The built row has no type icon — all configs look identical in shape, differentiated only by name. The artboard's type affordance helps the user identify preview vs process configs at a glance.  
*Fix:* Read config.preview (already on the LaunchConfiguration type) and render <Eye size={12} className='text-mf-success shrink-0'/> for preview configs and <Terminal size={12} className='text-muted-foreground shrink-0'/> for process configs as the first child in LaunchConfigRow, before the name span.  
<sub>verify: LaunchPopover.tsx LaunchConfigRow (lines 114-129) has no type icon; config.preview field exists but is never rendered as an Eye icon in the row.</sub>  

**🟡 minor — New Branch plus icon is not accent-colored in the default (no search) state**  
`packages/app-tauri/src/features/git/BranchListView.tsx:87-93 — <Plus size={12} className={search ? 'text-primary' : ''}/> — the primary color is only applied when search is non-empty`  
*Artboard:* Popovers Review.html #branch (BranchPopover global actions section). Prototype (13-popover.jsx:377): <PopMenuRow icon='plus' iconColor={ACCENT} ... /> — the plus icon is always rendered in the accent/primary color.  
*Drift:* When no search query is entered (the default state), the Plus icon renders in the default muted color instead of the accent/primary color. The artboard always uses the accent color on this affordance to signal it is a primary creation action.  
*Fix:* Remove the conditional: always apply className='text-primary' to the Plus icon in the New branch row.  
<sub>verify: BranchListView.tsx line 91: Plus icon className is conditional on search (only primary when search is non-empty); prototype line 377 always uses iconColor={ACCENT}.</sub>  

**🟡 minor — Update All action missing trailing keyboard hint '⤓'**  
`packages/app-tauri/src/features/git/BranchListView.tsx:94-107 — no trailing hint rendered for Update All`  
*Artboard:* Popovers Review.html #branch (BranchPopover global actions). Prototype (13-popover.jsx:379): <PopMenuRow icon='refresh' label='Update all' hint='⤓'/> — shows the ⤓ character as a trailing hint in T.text4 monospace.  
*Drift:* The artboard shows a subtle trailing hint character '⤓' on the Update All row as a keyboard affordance indicator. The built row omits this entirely.  
*Fix:* Add a trailing <span className='font-mono text-caption text-mf-text-4 shrink-0'>⤓</span> after the label span in the Update All button.  
<sub>verify: BranchListView.tsx line 104 Update All button renders no trailing hint; prototype line 379 shows hint='⤓' as a trailing span.</sub>  

**🟡 minor — ConflictView Abort button uses XCircle icon instead of xmark/X**  
`packages/app-tauri/src/features/git/ConflictView.tsx:73-79 — uses lucide <XCircle size={12}/> (X inside a circle) for the abort button icon`  
*Artboard:* Popovers Review.html #conflicts (ConflictsPopover). Prototype (13-popover.jsx:552): Abort button uses <Icon name='xmark' size={12} color='#fff' stroke={2.4}/> — a simple X mark, heavier stroke.  
*Drift:* The artboard specifies a plain xmark (Lucide: X) with a heavier stroke. The built code uses XCircle which adds an unwanted circle container. On a red full-width button, the plain X is visually cleaner and matches the artboard intent.  
*Fix:* Replace <XCircle size={12}/> with <X size={12} strokeWidth={2.4}/> (lucide X icon) in ConflictView.tsx line 78.  
<sub>verify: ConflictView.tsx line 78 uses XCircle icon; prototype line 552 specifies xmark icon with stroke={2.4}.</sub>  

**🟡 minor — Branch search field uses 1px border instead of artboard's 0.5px hairline**  
`packages/app-tauri/src/features/git/BranchListView.tsx:52 — className includes 'border border-border' which renders a full 1px border`  
*Artboard:* Popovers Review.html #branch (BranchPopover search field). Prototype (13-popover.jsx:364): border: '0.5px solid T.border' — consistent with the 'hairline borders' design principle (component-map.md §4).  
*Drift:* Tailwind's 'border' utility applies a 1px border. The artboard specifies 0.5px. All popover search fields and similar inset fields in the prototype use the 0.5px hairline treatment.  
*Fix:* Replace 'border border-border' with 'border-[0.5px] border-border' (Tailwind v4 arbitrary value) on the search field container div at BranchListView.tsx:52.  
<sub>verify: BranchListView.tsx line 52 applies 'border border-border' (Tailwind 1px); prototype line 364 specifies border: '0.5px solid T.border'.</sub>  

**🟡 minor — BranchSubmenu back button is not present in the artboard design**  
`packages/app-tauri/src/features/git/BranchSubmenu.tsx:215-223 — an ArrowLeft back button is the first element of the submenu header`  
*Artboard:* Popovers Review.html #branch-submenu (BranchSubmenu). Prototype (13-popover.jsx:328-338): the submenu header contains only a branch/globe icon and the branch name — no back button. Navigation back to the list happens by clicking elsewhere in the side-by-side layout.  
*Drift:* The back button was added to compensate for the view-swap layout (popovers-1). It is a structural addition not present in the artboard. Once popovers-1 is fixed (side-by-side layout restored), the back button should be removed, and clicking outside the submenu panel should deselect it.  
*Fix:* Remove the ArrowLeft back button from BranchSubmenu header after fixing popovers-1 (side-by-side layout). The submenu header should be: globe/branch icon + branch name + optional busy spinner — matching the prototype's 3-element header.  
<sub>verify: BranchSubmenu.tsx lines 215-223 render an ArrowLeft back button in the header; prototype lines 328-333 header contains only icon, branch name, and optional spinner (no back button).</sub>  

<details><summary>Deferred (not drift) — 3</summary>

- LaunchPicker 'Generate with Agent' footer row (sparkles icon + agent invocation) — shown in prototype/02-chrome.jsx:96-104 but not present in the built LaunchPopover; this is consistent with the WorktreePopover deferral and the composer-agent-invocation backlog item in MIGRATION-TRACKER.md.
- LaunchPicker trigger is a named-config selector pill in the artboard (showing the selected config name + chevron.down); built uses a generic 'Launch' + Rocket ghost button — the artboard trigger shape is part of the Run surface toolbar design which is still partially deferred per MIGRATION-TRACKER.md step 17.
- TagPopover's label header reads 'Tag session' (built) vs 'Tags' (artboard prototype); acceptable as a label copy difference — not an artboard structural delta.

</details>

---

### Workspace surfaces & layout engine  ·  9 findings (0B / 5M / 4m)

**🟠 Major — Surface tab strip headers use warm tinted background instead of transparent**  
`packages/app-tauri/src/layout/FilesTabStrip.tsx:113 / packages/app-tauri/src/layout/surfaces/RunSurface.tsx:60 / packages/app-tauri/src/features/chat/thread/ChatCardHeader.tsx:37`  
*Artboard:* 04-engine.jsx SurfaceTabStrip line 861: `background: 'transparent'`; ChatSurface header line 1015: `background: 'transparent'`. Both surface headers are transparent on the white content card surface.  
*Drift:* All three surface headers apply `bg-mf-tab-bar` (#f3f0ea in classic-light, a distinctly warm tint). The prototype artboard renders them transparent, falling through to the white content card — there is no warm band separating the drag-strip from the content area in the prototype.  
*Fix:* Remove `bg-mf-tab-bar` from FilesTabStrip root div, RunSurface pane tab-bar div, and ChatCardHeader root div. Use `bg-transparent` (or omit the class) so they inherit `bg-background` from the surface panel.  
<sub>verify: FilesTabStrip:113, RunSurface:60, ChatCardHeader:37 all apply bg-mf-tab-bar (#f3f0ea warm tint) instead of transparent as shown in 04-engine.jsx:861/1015.</sub>  

**🟠 Major — Surface tab strip and ChatCardHeader heights are wrong (34px/38px vs prototype 36px)**  
`packages/app-tauri/src/layout/FilesTabStrip.tsx:113 / packages/app-tauri/src/layout/surfaces/RunSurface.tsx:60,120 / packages/app-tauri/src/features/chat/thread/ChatCardHeader.tsx:37`  
*Artboard:* 04-engine.jsx SurfaceTabStrip line 861: `height: 36`; ChatSurface header line 1015: `height: 36`. All surface headers in the prototype are 36px.  
*Drift:* FilesTabStrip and RunSurface pane tab bars use `h-[34px]` (2px short). ChatCardHeader uses `h-[38px]` (2px tall). The prototype fixes all surface headers at 36px.  
*Fix:* Change FilesTabStrip root to `h-[36px]`, RunSurface pane header div to `h-[36px]`, and ChatCardHeader root to `h-[36px]`.  
<sub>verify: FilesTabStrip:113 h-[34px] and RunSurface:60 h-[34px] (2px short of 36px); ChatCardHeader:37 h-[38px] (2px tall) vs prototype 04-engine.jsx:861/1015 height:36.</sub>  

**🟠 Major — RunSurface tab strip missing split-surface buttons, close-surface button, and drag grip handle**  
`packages/app-tauri/src/layout/surfaces/RunSurface.tsx:59-81 (RunPaneView tab-bar div)`  
*Artboard:* 04-engine.jsx SurfaceTabStrip lines 930-942: when `primary` is true, the Run tab strip shows split-right / split-down buttons (when canSplit), a close-pane button (when split secondary), and a close-surface (×) button (when total surfaces > 1). Line 864-869: drag grip icon on primary pane.  
*Drift:* RunSurface pane tab bar has only a `+` (new-terminal) button and a close-pane button when split. It never calls `splitSurface`, `toggleSurface`, or `beginSurfaceDrag`. FilesTabStrip (the Files analogue) correctly implements all four controls. No tracker entry defers these buttons for Run.  
*Fix:* Import `layoutCanSplit`, `splitSurface`, `toggleSurface` from `useLayoutStore` and `beginSurfaceDrag` from `useSurfaceDragStore` into RunSurface (or a shared RunTabStripHeader component). For the primary pane: render the GripHorizontal drag handle, conditionally render LayoutPanelLeft/LayoutPanelTop split buttons when `layoutCanSplit`, and render an X button (`toggleSurface('run')`) when total surfaces > 1. Add data-testids: `run-surface-drag`, `run-surface-split-right`, `run-surface-split-down`, `run-surface-close`.  
<sub>verify: RunSurface:59-81 pane tab-bar has only +/close buttons; missing GripHorizontal drag handle, splitSurface buttons, and toggleSurface close entirely vs 04-engine.jsx:930-942.</sub>  

**🟠 Major — SurfacePicker missing two-level drill-down navigation and Recent section**  
`packages/app-tauri/src/layout/SurfacePicker.tsx:38-79`  
*Artboard:* 04-engine.jsx SurfacePicker lines 948-1007: Files picker has three states via `view` state: (null) shows Open file…/View changes… + Recent section (3 recent files); (file) shows full OPENABLE_FILES list with a back-chevron header; (diff) shows DIFFABLE_FILES list with a back-chevron header. The back-button and secondary header are visible states.  
*Drift:* Built SurfacePicker shows only flat 'Open file…' and 'View changes…' rows that emit intents on click. It has no `view` state, no drill-down to a file list, no back button, and no 'Recent' section. The tracker does not mark this as deferred.  
*Fix:* Add a `view: null | 'file' | 'diff'` local state. At `null`: show Open file… / View changes… chevron rows plus a 'Recent' divider + 3 recent files (from tabs store or intent). At `'file'` / `'diff'`: show a back-chevron header and the full list with a `files-picker-back` testid button that calls `setView(null)`. Preserve the existing intent-emit actions.  
<sub>verify: SurfacePicker:38-79 renders only flat Open/View/Terminal rows with no view state, no back button, no Recent section vs 04-engine.jsx:948-1007 multi-level drill-down.</sub>  

**🟠 Major — RunTabPill active tab uses wrong color token (bg-accent instead of bg-mf-chip)**  
`packages/app-tauri/src/layout/surfaces/RunSurface.tsx:29`  
*Artboard:* 04-engine.jsx SurfaceTabStrip line 895: active tab background is `T.chipBg` which maps to `--mf-chip` (rgba(0,0,0,0.05) light / rgba(255,255,255,0.07) dark). T.chipBg is the chip/pill background, not the hover surface.  
*Drift:* `RunTabPill` applies `bg-accent` (= `--accent` = rgba(0,0,0,0.04)) for the active state. `--accent` is the hover surface token (T.rowHover in prototype terms), not the chip background. The correct token is `bg-mf-chip`. The values are numerically close but semantically wrong, and dark-mode values diverge more (accent 5.5% white vs chip 7% white).  
*Fix:* Change active class from `bg-accent` to `bg-mf-chip` in `RunTabPill` at `RunSurface.tsx:29`.  
<sub>verify: RunTabPill:29 applies bg-accent for active state vs prototype 04-engine.jsx:895 T.chipBg; globals.css:40 --accent=rgba(0,0,0,0.04) hover surface, not --mf-chip=rgba(0,0,0,0.05).</sub>  

**🟡 minor — MainToolbar height is 38px, prototype is 40px**  
`packages/app-tauri/src/layout/MainToolbar.tsx:73`  
*Artboard:* 02-chrome.jsx MainToolbar line 124: `height: 40`.  
*Drift:* Built `MainToolbar` uses `h-[38px]`. The prototype artboard renders the toolbar at 40px. The 2px shortfall causes a slightly denser toolbar band.  
*Fix:* Change `h-[38px]` to `h-[40px]` in MainToolbar root div.  
<sub>verify: MainToolbar:73 uses h-[38px] vs prototype 02-chrome.jsx:124 height:40.</sub>  

**🟡 minor — DragLayer ghost chip uses frosted glass background and has no surface icon**  
`packages/app-tauri/src/layout/SurfaceDragLayer.tsx:61-65`  
*Artboard:* 04-engine.jsx DragOverlay lines 1170-1175: ghost chip uses `background: T.content` (solid white/bg-background), `border: 0.5px solid T.border`, `boxShadow: '0 12px 32px rgba(0,0,0,0.22)'`, and renders `<Icon name={drag.icon} size={12} color={drag.color}/>{drag.label}` — the surface-specific icon plus the surface name (e.g. 'Files').  
*Drift:* Built ghost chip uses `bg-mf-glass backdrop-blur-[40px]` (frosted glass) instead of solid `bg-background`. It shows only generic text ('Move surface' / 'Move tab') with no icon, while the prototype shows the surface-specific colored glyph plus the surface label.  
*Fix:* Replace `bg-mf-glass backdrop-blur-[40px]` with `bg-background`. Pass the dragging surface name and its icon component (from `SURFACES` in SurfaceRail or a shared surface-meta map) through the drag store state and render the icon beside the label in the ghost chip.  
<sub>verify: SurfaceDragLayer:61-65 ghost chip uses bg-mf-glass backdrop-blur instead of solid bg-background, and renders generic 'Move surface'/'Move tab' text with no surface icon/label from 04-engine.jsx:1170-1175.</sub>  

**🟡 minor — Live preview pulse dot (ts-dot/ts-x toggle) missing in FilesTabStrip and RunTabPill**  
`packages/app-tauri/src/layout/FilesTabStrip.tsx:79-93 / packages/app-tauri/src/layout/surfaces/RunSurface.tsx:26-45`  
*Artboard:* 04-engine.jsx SurfaceTabStrip lines 906-915: each tab with `tab.live===true` shows a pulsing accent dot (class `tw-pulse`, `tw-dots`) that hides on hover while the × button becomes visible. CSS: `.ts-tab .ts-x { display:none }` / `.ts-tab:hover .ts-x { display:inline-flex }` / `.ts-tab:hover .ts-dot { display:none }`.  
*Drift:* Neither FilesTabStrip's TabPill nor RunTabPill implements the live-dot indicator. Preview tabs (`tab.live === true` in Run, `tab.kind === 'preview'` equivalent in Files) should show a small pulsing accent dot in the close-button slot that swaps for the × on hover. Currently only the × is ever shown (with opacity transitions), and the live dot is absent entirely.  
*Fix:* Add a `live` boolean prop / derive it from `tab.kind === 'preview'`. In the close-button slot, render a `group-hover:hidden` pulsing 6×6 dot (`animate-pulse bg-primary rounded-full`) alongside a `hidden group-hover:flex` × button. This mirrors the `ts-dot`/`ts-x` CSS toggle pattern from the prototype.  
<sub>verify: FilesTabStrip:79-93 TabPill and RunSurface:26-45 RunTabPill lack live-dot indicator (pulsing accent dot) for live===true/preview tabs vs 04-engine.jsx:906-915 ts-dot/ts-x toggle.</sub>  

**🟡 minor — RunTabPill inactive hover state uses opacity-halved accent (effectively invisible)**  
`packages/app-tauri/src/layout/surfaces/RunSurface.tsx:29`  
*Artboard:* 04-engine.jsx SurfaceTabStrip line 898: inactive tab hover sets `background: T.rowHover` which equals `--accent` (rgba(0,0,0,0.04) in light). This is the same value as `bg-accent`, applied at full strength.  
*Drift:* `RunTabPill` applies `hover:bg-accent/50` on inactive tabs. In Tailwind v4, `color-mix(in srgb, rgba(0,0,0,0.04) 50%, transparent)` = rgba(0,0,0,0.02) — barely perceptible. The prototype applies the full-strength hover tint. The hover affordance is effectively invisible on light themes.  
*Fix:* Change `hover:bg-accent/50` to `hover:bg-accent` in RunTabPill's inactive class string at `RunSurface.tsx:29`.  
<sub>verify: RunTabPill:29 inactive hover applies hover:bg-accent/50 (opacity halved) vs prototype 04-engine.jsx:898 full T.rowHover strength; /50 is barely perceptible on light theme.</sub>  

<details><summary>Deferred (not drift) — 5</summary>

- Warm radial-gradient window background behind floating panels (today flat bg-mf-window): tracker item M under 'Layout / sidebar chrome'.
- Bottom Context/Skills/Agents tabbed panel + resize handle below the session list: tracker item M.
- Drop-zone highlight label chip (e.g., 'LEFT COLUMN', 'BOTTOM STRIP' in accent mono text inside the drop highlight rect): tracker explicitly defers 'richer drop-zone visuals' under Typed-surface layout engine entry (2026-06-11).
- Tab reorder drag-and-drop within a strip: tracker defers 'tab reorder DnD'.
- SessionSidebar group-header 'more' popover wiring: tracker-deferred placeholder.

</details>

---

### User message states  ·  10 findings (0B / 4M / 6m)

**🟠 Major — CodeRefCard body uses wrong background token (mf-content2 vs mf-code-bg)**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/CodeRefCard.tsx:48`  
*Artboard:* User Message States.html #coderef — UMCodeRef body: background: T.codeBg (#fbfaf7 classic-light, scheme-adaptive code surface)  
*Drift:* The snippet body div uses `bg-mf-content2` (#f8f6f2 warm card surface) instead of `bg-mf-code-bg` (#fbfaf7 code surface). In dark and alternate schemes the divergence is more pronounced: dark-classic mf-content2=#212330 vs mf-code-bg=#21222c. The `--color-mf-code-bg` @theme mapping exists at globals.css:695, so the token is available. Additionally the gradient fade overlay hard-codes `to-mf-content2` instead of `to-mf-code-bg`, so both the body surface and the fade end-stop are mismatched.  
*Fix:* Change `bg-mf-content2` to `bg-mf-code-bg` on the snippet body wrapper (line 48 outer div, and inside the `<div className="relative">` at line 58). Change `to-mf-content2` on the fade overlay at line 65 to `to-mf-code-bg`.  
<sub>verify: CodeRefCard.tsx line 48 uses `bg-mf-content2` for card body, line 65 uses `to-mf-content2` for gradient; prototype line 329 specifies `background: T.codeBg` and line 348 uses gradient `${T.codeBg}` (--mf-code-bg token exists at globals.css:695).</sub>  

**🟠 Major — Queued FIFO position labels not implemented — all items show the same footer text**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/QueuedUserTurn.tsx:45–54`  
*Artboard:* User Message States.html #q-fifo — UMQueuedStack with three items: item 1 = 'Queued · sends next, after the current run', item 2 = 'Queued · 2nd to send', item 3 = 'Queued · 3rd to send'; also implemented via UMQueuedMeta(position, total) in 11-usermessages.jsx:137–153  
*Drift:* QueuedMeta always renders 'Queued · sends after the current run' regardless of position. QueuedUserTurn accepts no position/total props. When multiple messages are queued, every footer line says the same thing; the artboard differentiates: position=1/total>1 → 'sends next, after the current run'; position=2 → '2nd to send'; position=3 → '3rd to send'. Non-head items should also show a steady amber dot (not a spinner) and use text-mf-text-4 (dimmer).  
*Fix:* Add `position: number` and `total: number` props to QueuedUserTurn (defaults 1/1). Update QueuedMeta to accept them and reproduce the artboard label logic: `if (total <= 1) 'Queued · sends after the current run'; else if (position === 1) 'Queued · sends next, after the current run'; else 'Queued · {ordinal(position)} to send'`. For position > 1: render a steady amber filled dot (no spin animation) and use `text-mf-text-4`. A caller (wherever queued messages are rendered in sequence) must inject position/total.  
<sub>verify: QueuedUserTurn.tsx lines 45-54: QueuedMeta() renders fixed text 'sends after the current run' with no position/total props; prototype 11-usermessages.jsx lines 137-153 show UMQueuedMeta accepts position/total and renders position-dependent labels ('sends next' for head, 'Nth to send' for others).</sub>  

**🟠 Major — Queued message 'sending' transient state not implemented**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/QueuedUserTurn.tsx:57–104`  
*Artboard:* User Message States.html #q-one / prototype 11-usermessages.jsx:171 — UMQueuedTurn sending=true: solid UEDGE border (not dashed), opacity=1, 'Sending now…' label in meta footer, spinner still shown  
*Drift:* The built QueuedUserTurn has no `sending` prop. When the agent run ends and the head queued message begins transmitting, the artboard specifies: dashed border switches to solid `border-mf-um-edge`, opacity transitions from 0.82 to 1, the meta label changes to 'Sending now…', and a `transition: opacity 0.2s ease, border-color 0.2s ease` animates the change. None of this exists in the built component.  
*Fix:* Add a `sending?: boolean` prop. When true: change `border-dashed border-mf-um-dash` to `border-solid border-mf-um-edge`, remove `opacity-[0.82]`, pass sending to QueuedMeta to show 'Sending now…' label and keep the spinner. Add `transition-[opacity,border-color] duration-200 ease-in-out` on the card div.  
<sub>verify: QueuedUserTurn.tsx has no `sending` prop; prototype line 171 shows UMQueuedTurn accepts `sending: boolean` and applies border-solid (vs dashed), opacity 1 (vs 0.82), 'Sending now…' label, and transition animations on those properties.</sub>  

**🟠 Major — Capture chip selector text uses mf-success instead of mf-code-fn**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/UserAttachments.tsx:87`  
*Artboard:* User Message States.html #sent-ctx / prototype UMInspectChip:273 — selector code text color: '#326d74' which is T.codeFn (--mf-code-fn)  
*Drift:* The capture chip's CSS selector `<code>` text uses `text-mf-success` (#28a745 classic-light, bright green) instead of `text-mf-code-fn` (#326d74 classic-light, teal-green). These are visually distinct: success is a vibrant green; code-fn is a muted teal. In dark mode the divergence is larger: mf-success = #50d97c (vivid mint) vs mf-code-fn = #6df295. The `--color-mf-code-fn` token IS mapped in @theme (globals.css:699) so the utility is available.  
*Fix:* Change `text-mf-success` to `text-mf-code-fn` on the `<code>` element at UserAttachments.tsx:87.  
<sub>verify: UserAttachments.tsx line 87 applies `text-mf-success` to selector `<code>` element; prototype 11-usermessages.jsx line 273 specifies `color: '#326d74'` (the --mf-code-fn value); token --color-mf-code-fn is mapped at globals.css:699.</sub>  

**🟡 minor — File pill background uses bg-card instead of bg-background (T.content)**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/UserAttachments.tsx:36`  
*Artboard:* User Message States.html #file, #images, #combo — UMFileThumb:211 background: T.content (#ffffff = --background, pure white in all light schemes)  
*Drift:* FilePill uses `bg-card` (#f8f6f2 classic-light, warm cream) while the artboard uses T.content (#ffffff = --background, white). The file pill is intended to pop as a clean white chip against the thread background; the warm card surface reduces the contrast and blends it into surrounding card surfaces.  
*Fix:* Change `bg-card` to `bg-background` on the FilePill outer div at line 36.  
<sub>verify: UserAttachments.tsx line 36 applies `bg-card` to FilePill; prototype 11-usermessages.jsx line 211 uses `background: T.content` (#ffffff, --background); globals.css shows --card=#f8f6f2 vs --background=#ffffff.</sub>  

**🟡 minor — QueuedAction hover lacks the ghost hairline border shown in the artboard**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/QueuedUserTurn.tsx:30–42`  
*Artboard:* prototype UMQueuedAction:127–133 — on hover: border: '0.5px solid T.border' (danger: T.red+'55'); default: border: '0.5px solid transparent' creating a ghost pill outline on hover  
*Drift:* The built QueuedAction button has no border at all. The artboard shows a transparent border (always present, invisible at rest) that becomes a hairline `border` on hover — the ghost pill effect. Without the border the hover state is only a background fill, not a pill.  
*Fix:* Add `border border-transparent hover:border-border` to the QueuedAction base classes. For the danger variant add `hover:border-destructive/35` (approximates T.red+'55').  
<sub>verify: QueuedUserTurn.tsx lines 30-42 QueuedAction button has no border styling; prototype 11-usermessages.jsx lines 127-133 show ghost pill with `border: 0.5px solid transparent` at rest and `hover:border` (with danger color T.red+'55' for danger variant).</sub>  

**🟡 minor — QueuedAction reveal has no translateX slide-in (opacity-only transition)**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/QueuedUserTurn.tsx:85`  
*Artboard:* prototype UMQueuedTurn:164–167 — reveal: opacity 0→1 AND transform translateX(6px)→translateX(0), transition 'opacity .16s ease, transform .16s ease'  
*Drift:* The actions group only transitions opacity (via `transition-opacity group-hover/queued:opacity-100`). The artboard slides the actions in from the right (6px) while fading — a subtle animation that reinforces the directional reveal from the bubble edge.  
*Fix:* Add `translate-x-[6px] group-hover/queued:translate-x-0 group-focus-within/queued:translate-x-0 transition-[opacity,transform] duration-150` to the actions container div at line 85.  
<sub>verify: QueuedUserTurn.tsx line 85 applies only `transition-opacity` to actions container; prototype 11-usermessages.jsx lines 164-167 show `transform: reveal ? 'translateX(0)' : 'translateX(6px)'` with `transition: 'opacity .16s ease, transform .16s ease'`.</sub>  

**🟡 minor — Body text line-height is 1.65 (leading-relaxed) vs artboard 1.58**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/UserMessage.tsx:112`  
*Artboard:* prototype UMBubble:32 and UMQueuedTurn:171 — lineHeight: 1.58 on the message body text  
*Drift:* globals.css defines `--leading-relaxed: 1.65` but the artboard specifies `lineHeight: 1.58`. The `leading-relaxed` token used by CoolCard, ReadMoreBubble, and QueuedUserTurn is 0.07 units looser than the design target, making messages slightly taller than intended.  
*Fix:* Either set `--leading-relaxed: 1.58` in globals.css (if that rung is exclusively used for user bubbles) or introduce a named token `--leading-um: 1.58` and apply it as a custom class or inline style on the body text wrapper in CoolCard and QueuedUserTurn.  
<sub>verify: UserMessage.tsx line 112 CoolCard applies `leading-relaxed` (1.65 per globals.css:745); prototype 11-usermessages.jsx lines 32 and 171 specify `lineHeight: 1.58` on UMBubble and UMQueuedTurn body text.</sub>  

**🟡 minor — Body text letter-spacing is 0 (tracking-normal) vs artboard -0.1px**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/UserMessage.tsx:112`  
*Artboard:* prototype UMBubble:32, UMQueuedTurn:171, UMQueuedAction:129, UMQueuedMeta:146 — letterSpacing: -0.1 consistently throughout user message text  
*Drift:* globals.css maps `--tracking-normal: 0` (no negative tracking). The artboard uses -0.1px letter-spacing on all user message text — bubble body, queued card, queued actions, queued meta. At 13px this is a subtle but intentional tightening that matches the SF Pro text rendering profile.  
*Fix:* Add `--tracking-um: -0.1px` to globals.css @theme inline and apply `tracking-um` to the body text in CoolCard, QueuedUserTurn body, and QueuedMeta. Alternatively set `style={{ letterSpacing: '-0.1px' }}` inline on the text containers.  
<sub>verify: UserMessage.tsx line 112 applies `tracking-normal` (0 per globals.css:741); prototype 11-usermessages.jsx lines 32, 171, 129, 146 consistently specify `letterSpacing: -0.1` on message text, actions, and meta.</sub>  

**🟡 minor — File pill filename uses text-caption (11px) instead of artboard 12px**  
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/packages/app-tauri/src/features/chat/messages/UserAttachments.tsx:47`  
*Artboard:* prototype UMFileThumb:216 — filename span: fontSize: 12, fontWeight: 600  
*Drift:* The filename text uses `text-caption` (11px = 0.6875rem). The artboard specifies 12px. The correct token is `text-label` (0.75rem = 12px) which is mapped in globals.css:732.  
*Fix:* Change `text-caption` to `text-label` on the filename `<span>` at UserAttachments.tsx:47.  
<sub>verify: UserAttachments.tsx line 47 applies `text-caption` to filename span; prototype 11-usermessages.jsx line 216 specifies `fontSize: 12` (which is --text-label); globals.css shows --text-caption=11px (0.6875rem) vs --text-label=12px (0.75rem).</sub>  

<details><summary>Deferred (not drift) — 4</summary>

- UMPlanBubble ('Implementing plan' card) — the PLAN_PREFIX user turn variant is not built; deferred to a plan-card leaf per UserMessage.tsx:214 comment and MIGRATION-TRACKER.md 'Deferred user-message leaf states'.
- UMInspectChip producer (CSS inspect chip as a SENT context attachment) — the chip display code exists in UserAttachments.tsx but the producer (sandbox inspect surface → WS Zod schema) is gated on the sandbox capture leaf; MIGRATION-TRACKER.md line 338.
- UMCodeRef producer (editor sender wiring) — CodeRefCard renders correctly but there is no editor surface yet to produce meta.codeRef; noted in UserMessage.tsx:214 and MIGRATION-TRACKER.md.
- UMScreenshotMini / separate screenshot chip row — replaced by clickable native attachment tiles (ImageAttachment) per MIGRATION-TRACKER.md #M 2026-06-10 decision; not a drift.

</details>

---

### Composer states  ·  9 findings (0B / 4M / 5m)

**🟠 Major — Send button is a circle (rounded-full 32px) instead of a rounded-square (8px radius, 26px)**  
`packages/app-tauri/src/features/chat/composer/Composer.tsx:29`  
*Artboard:* Composer States.html § base — all three base artboards; prototype 03-content.jsx line 785: `width: 26, height: 26, borderRadius: 8`  
*Drift:* Prototype specifies 26×26px with borderRadius 8 (a rounded square). Built code applies `size-8` (32px) and `rounded-full` (a full circle). Shape and size both diverge from the artboard.  
*Fix:* Change `size-8 rounded-full` to `size-[26px] rounded-md` (or equivalent) on the base class in `SendOrCancelButton`. Apply the same fix to the Cancel button's base class on the same line.  
<sub>verify: Composer.tsx line 29: `size-8 rounded-full` renders 32px circle; prototype requires 26×26px with borderRadius 8 (rounded square).</sub>  

**🟠 Major — Chip triggers have no open-state accent border or background tint**  
`packages/app-tauri/src/features/chat/composer/config-toolbar/PermissionSelect.tsx:51-65, EffortPicker.tsx:57-68, ProviderModelSelect.tsx:155-170`  
*Artboard:* Composer States.html § base — all chip triggers (Model, Permission, Effort, Features); prototype 03-content.jsx lines 294-299, 395-399, 458-462, 534-537: when `open`, triggers get `border: ACCENT` + `background: ACCENT+'10'`  
*Drift:* Each chip trigger should show a primary-color border and ~6% primary background tint when its popover/dropdown is open. None of the built trigger buttons carry a `data-[state=open]:border-primary data-[state=open]:bg-mf-selection` (or equivalent) Tailwind class, so the open state is visually indistinguishable from resting.  
*Fix:* Add `data-[state=open]:border-primary data-[state=open]:bg-mf-selection` to each chip trigger button class list. For DropdownMenuTrigger (PermissionSelect, EffortPicker) use the same classes since Radix sets `data-state=open` on the trigger element.  
<sub>verify: PermissionSelect/EffortPicker/ProviderModelSelect trigger buttons lack open-state border/background tint classes like `data-[state=open]:border-primary`.</sub>  

**🟠 Major — PlanModeToggle active state uses blue (mf-selection / primary) instead of amber**  
`packages/app-tauri/src/features/chat/composer/config-toolbar/PlanModeToggle.tsx:42-48`  
*Artboard:* Composer States.html § base; prototype 03-content.jsx lines 416-427: active PlanModeToggle has `border: T.amber`, `background: T.amber+'14'`, icon color `T.amber`  
*Drift:* Built active state: `bg-mf-selection text-primary` (blue tint + blue icon). Artboard: amber border (`border-mf-warning`), amber-tint background (`bg-mf-warning-tint`), amber icon (`text-mf-warning`). Entire active hue is wrong — blue vs amber.  
*Fix:* Replace the active branch classes with `border border-mf-warning bg-mf-warning-tint text-mf-warning` and remove `bg-mf-selection text-primary`. Add `border border-transparent` to the inactive branch to keep layout stable.  
<sub>verify: PlanModeToggle.tsx line 47: active state is `bg-mf-selection text-primary` (blue); prototype specifies amber border/background/icon.</sub>  

**🟠 Major — EffortPicker trigger missing lock icon when ultracode-locked**  
`packages/app-tauri/src/features/chat/composer/config-toolbar/EffortPicker.tsx:54-70`  
*Artboard:* Composer States.html § tuning / 'Ultracode ON' artboard; prototype 03-content.jsx lines 466-468: trigger renders `<Icon name='lock' size={9} color={T.text4}/>` after the label when `locked`  
*Drift:* When ultracode is on (effort locked to xhigh), the prototype shows a small lock icon inside the trigger label. The built trigger only disables the button (`disabled={isDisabled}`) — no visual lock icon is rendered, so the user cannot tell why the picker won't open.  
*Fix:* Import `Lock` from lucide-react. After the `<EffortLabel>` element, render `{locked && <Lock size={10} className='shrink-0 text-mf-text-4' />}` inside the trigger button.  
<sub>verify: EffortPicker.tsx lines 54-71: no lock icon rendered when `locked` is true; prototype shows `<Icon name='lock' size={9}/>` inside trigger.</sub>  

**🟡 minor — FeaturesPopover trigger missing active-feature accent dot indicator**  
`packages/app-tauri/src/features/chat/composer/config-toolbar/FeaturesPopover.tsx:67-83`  
*Artboard:* Composer States.html § tuning; prototype 03-content.jsx lines 540-542: when any feature is on, a `5×5px` accent dot renders at `top:1, right:1` in the gear button with `background: ACCENT`  
*Drift:* No indicator dot. When Fast, Ultracode, or Adaptive Thinking is on the gear trigger gives no visual signal that a feature is active. The prototype shows a small primary-color pip in the corner.  
*Fix:* Read the active feature list inside FeaturesPopover (or accept a derived `hasActive` prop from ComposerToolbar). Add `relative` to the trigger button and render `{hasActive && <span className='absolute right-0.5 top-0.5 size-[5px] rounded-full bg-primary' />}` inside it.  
<sub>verify: FeaturesPopover.tsx trigger button (lines 67-83) lacks indicator dot; prototype shows `5×5px accent dot at top-right when feature is active`.</sub>  

**🟡 minor — Edit mode composer shell missing outer amber ambient-glow ring**  
`packages/app-tauri/src/features/chat/composer/edit/ComposerEditMode.tsx:49-51`  
*Artboard:* Composer States.html § edit — 'Edit mode · text + attachment'; prototype 03-content.jsx lines 694-697: editing shell has `boxShadow: '0 0 0 3px ${T.amber}1c, 0 8px 22px rgba(0,0,0,0.06)'`  
*Drift:* Built edit-mode shell: `border border-mf-warning shadow-sm`. The artboard adds a 3px soft amber halo (`0 0 0 3px amber/11%`) outside the border ring. The `shadow-sm` is a tight drop shadow that does not reproduce the wider amber glow.  
*Fix:* Replace `shadow-sm` with an arbitrary shadow value: `[box-shadow:0_0_0_3px_var(--mf-warning-tint),0_8px_22px_rgba(0,0,0,0.06)]` or add a Tailwind utility alias for the edit-mode ring to `globals.css`.  
<sub>verify: ComposerEditMode.tsx line 51: `shadow-sm` only; prototype requires `0 0 0 3px amber/11% halo` plus drop shadow.</sub>  

**🟡 minor — ProviderModelSelect popover missing footer hint in unlocked state**  
`packages/app-tauri/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx:206-210`  
*Artboard:* Composer States.html § base / 'Empty · new session (provider unlocked)'; prototype 03-content.jsx lines 367-369: footer always renders — `'Pick a provider before your first message.'` when unlocked, `'Provider stays fixed for this session.'` when locked  
*Drift:* Footer renders only when `locked === true`. When the session is new (provider unlocked), no footer hint appears. The artboard shows the hint in both states.  
*Fix:* Unconditionally render the footer paragraph. Change the condition to render the appropriate string: `{locked ? 'Provider stays fixed for this session.' : 'Pick a provider before your first message.'}`  
<sub>verify: ProviderModelSelect.tsx line 206: footer renders only `{locked && (...)}`, not when unlocked; prototype shows footer in both locked and unlocked states.</sub>  

**🟡 minor — PermissionSelect dropdown items render label-only — missing per-option description notes**  
`packages/app-tauri/src/features/chat/composer/config-toolbar/PermissionSelect.tsx:31-35, 69-77`  
*Artboard:* Composer States.html § base; prototype 03-content.jsx lines 754-760: ComposerSelect options have `note` text ('Approve every action', 'Edits auto-applied; commands ask', 'Runs without prompts') rendered as secondary text in each PopSelectRow  
*Drift:* The built `PERMISSION_MODES` array has no `description` field. `DropdownMenuItem` rows render a single label string. Users cannot see what each mode does without external knowledge.  
*Fix:* Add `description` to each PERMISSION_MODES entry (e.g. `'Approve every action'`). Inside the `DropdownMenuItem`, render a two-line layout: label in `text-label font-medium` + description in `text-caption text-muted-foreground`.  
<sub>verify: PermissionSelect.tsx lines 31-35: PERMISSION_MODES array has no `description` field; DropdownMenuItem renders label only, not per-option description notes.</sub>  

**🟡 minor — Toolbar missing vertical separator between paperclip and config chips**  
`packages/app-tauri/src/features/chat/composer/Composer.tsx:144-148`  
*Artboard:* Composer States.html § base — all artboards; prototype 03-content.jsx lines 752-753: `<div style={{ width: 1, height: 12, background: T.border, margin: '0 4px' }}/>`  between the @ button and the config chip group  
*Drift:* The built bottom bar has `ComposerAddAttachment` directly adjacent to `ComposerToolbar` with no visual break. The artboard shows a 1×12px hairline divider separating the attachment actions from the config chips.  
*Fix:* Between `<ComposerAddAttachment />` and `<ComposerToolbar />`, add `<div className='mx-1 h-3 w-px shrink-0 bg-border' aria-hidden />`. This matches the prototype's `width:1, height:12, margin: '0 4px'` separator.  
<sub>verify: Composer.tsx lines 145-147: ComposerAddAttachment and ComposerToolbar are adjacent with no separator div; prototype shows 1×12px hairline divider.</sub>  

<details><summary>Deferred (not drift) — 8</summary>

- WorktreeButton/WorktreePopover in the composer toolbar — explicitly deferred in tracker (tracker line 339, CLAUDE.md 'Deferred sub-features'); git/worktree API verification pending.
- Composer-drafts persistence across chat switches — deferred in tracker (tracker line 340); draft-config store covers the new-thread flow only.
- Composer highlight overlay for inline @/skill directive chips — deferred in tracker (tracker line 179).
- Sandbox captures in the composer toolbar — deferred in tracker (tracker line 123, 'captures control (gated: sandbox surface)'); producer surface not yet built.
- Edit mode attachment/capture tile rows (artboard 'Edit mode · text + attachment') — QueuedEdit type carries no attachments field; capture support in the queue-edit path is gated on the same sandbox capture surface deferral.
- Standalone @ icon button in the toolbar left slot (prototype line 746) — replaced by the native Unstable_TriggerPopoverRoot typing '@' to open the mention picker; documented approved divergence in CLAUDE.md.
- Background-tasks pill in the session bar — deferred in tracker (tracker line 36, 'background-tasks pill deferred').
- Provider-tuning-defaults inheritance in EffortPicker/FeaturesPopover — tracked open item (tracker line 335); Settings wired but the per-provider defaults fetch was incomplete at that time; wiring now resolved per tracker line 203 (Settings surface completion note).

</details>

---

### Base primitives & design tokens  ·  8 findings (0B / 3M / 5m)

**🟠 Major — tracking-tight and tracking-wide tokens resolve to 0 instead of prototype values**  
`packages/app-tauri/src/styles/globals.css:740-742`  
*Artboard:* Design Tokens Report.html §05 Typography, letter-spacing table; prototype/01-base.jsx LS = { tight: '-0.02em', wide: '0.06em' }. tight is for display/title sizes, wide for uppercase eyebrow labels.  
*Drift:* @theme inline defines --tracking-tight: 0 and --tracking-wide: 0. In Tailwind v4 these override the framework's built-in defaults (tight = -0.025em, wide = 0.025em) so any component using `tracking-tight` or `tracking-wide` gets letter-spacing: 0 instead of the intended negative or positive value. Confirmed callers: PreviewCaptureCluster.tsx:29 (uppercase label uses tracking-wide → 0 instead of 0.06em) and PreviewBodyState.tsx:38 (uses tracking-tight → 0 instead of -0.02em). The reference theme (mainframe-theme.css) does NOT define --tracking-* at all, meaning globals.css invented this override and set incorrect values.  
*Fix:* In the @theme inline block, change: --tracking-tight to -0.02em and --tracking-wide to 0.06em (matching prototype LS.tight / LS.wide). --tracking-normal: 0 is correct.  
<sub>verify: globals.css:740-742 defines --tracking-tight: 0 and --tracking-wide: 0, overriding Tailwind defaults and prototype LS values (-0.02em and 0.06em)</sub>  

**🟠 Major — Input and Textarea use bg-transparent instead of the content2 fill**  
`packages/app-tauri/src/components/ui/input.tsx:12 and packages/app-tauri/src/components/ui/textarea.tsx:10`  
*Artboard:* Primitives.html §03 Form controls: 'tdInput · radius 8, hairline border, content2 fill'. Prototype (12-todos.jsx:320-322): tdInput = { background: T.content2, ... }. T.content2 = #f8f6f2 (light classic) — a subtly warm off-white, distinct from the pure-white --background.  
*Drift:* Both Input and Textarea apply `bg-transparent`. On surfaces backed by the window matte (--mf-window = #e9e7e2) or any non-white parent, the field will show through as gray/warm-grey instead of the intended content2 white-ish fill. The artboard always renders fields with the content2 chip.  
*Fix:* Change both to `bg-card` (--card = #f8f6f2 in classic-light, per-scheme in others, which equals T.content2). Add `dark:bg-card` is automatically handled since --card overrides per `.dark`.  
<sub>verify: input.tsx:12 and textarea.tsx:10 both use bg-transparent; design calls for content2 fill via bg-card</sub>  

**🟠 Major — ContextMenu surfaces use hardcoded Tailwind shadows instead of --mf-shadow-pop**  
`packages/app-tauri/src/components/ui/context-menu.tsx:60 (ContextMenuSubContent: shadow-lg) and :74 (ContextMenuContent: shadow-md)`  
*Artboard:* component-map.md §2 ContextMenu: 'Radius md, --mf-shadow-pop'. Primitives.html §01 and Design Tokens Report §06 show all pop-up surfaces use the two-tier --mf-shadow-pop (blur + 0.5px ring). DropdownMenu and Popover both use shadow-[var(--mf-shadow-pop)] correctly.  
*Drift:* ContextMenuSubContent uses `shadow-lg` and ContextMenuContent uses `shadow-md` — both are Tailwind's built-in opinionated box-shadows. The warm-chrome design requires `shadow-[var(--mf-shadow-pop)]` which composes a theme-responsive blur with a 0.5px hairline ring. Compare DropdownMenuContent (line 72) and DropdownMenuSubContent (line 46) which both correctly use shadow-[var(--mf-shadow-pop)].  
*Fix:* Replace `shadow-lg` in ContextMenuSubContent and `shadow-md` in ContextMenuContent with `shadow-[var(--mf-shadow-pop)]`. Also add `rounded-lg` for consistency with other pop-up surfaces (currently rounded-md).  
<sub>verify: context-menu.tsx:60 uses shadow-lg and :74 uses shadow-md; dropdown-menu.tsx correctly uses shadow-[var(--mf-shadow-pop)]</sub>  

**🟡 minor — Button disabled state uses opacity-50 instead of artboard's 0.45**  
`packages/app-tauri/src/components/ui/button.tsx:12`  
*Artboard:* Primitives.html §01 Buttons: 'disabled — opacity 0.45 · no events' (Spec card shows 0.45 explicitly).  
*Drift:* Built code: `disabled:opacity-50` (50%). Artboard specifies 0.45 (45%). The 5% difference makes disabled buttons slightly more opaque than the design intent — marginally more legible than specified.  
*Fix:* Change `disabled:opacity-50` to `disabled:opacity-45` in the base buttonVariants cva string.  
<sub>verify: button.tsx:12 uses disabled:opacity-50; design specifies 0.45, a 5% divergence</sub>  

**🟡 minor — Input and Textarea use a 1px border instead of the prototype's 0.5px hairline**  
`packages/app-tauri/src/components/ui/input.tsx:12 and packages/app-tauri/src/components/ui/textarea.tsx:10`  
*Artboard:* Primitives.html §03 Form controls: 'tdInput · hairline border'. Prototype (12-todos.jsx:321): `border: '0.5px solid ${T.border}'`. Design Tokens Report §01 notes hairlines at 0.5px throughout the chrome.  
*Drift:* Both components apply `border border-input` which is a standard 1px border. The artboard uses a 0.5px hairline (styled via `border-width: 0.5px`). Popovers, menus and cards all use 0.5px borders; the form fields should match.  
*Fix:* Add `[border-width:0.5px]` as an arbitrary Tailwind utility alongside `border-input`, replacing the default `border` (which implies 1px).  
<sub>verify: input.tsx:12 and textarea.tsx:10 use border utility (1px default); design specifies 0.5px hairline per component-map</sub>  

**🟡 minor — ContextMenuLabel uses text-body (13px, foreground) instead of caption/muted like DropdownMenuLabel**  
`packages/app-tauri/src/components/ui/context-menu.tsx:167`  
*Artboard:* component-map.md §2: context-menu and dropdown-menu are the same visual pattern. Prototype menus show section labels at caption size (11px), muted color — matching DropdownMenuLabel's text-caption font-semibold text-muted-foreground.  
*Drift:* ContextMenuLabel renders with `text-body font-medium text-foreground` (13px, normal weight, full ink). DropdownMenuLabel (dropdown-menu.tsx:174) uses `text-caption font-semibold text-muted-foreground` (11px, semibold, muted). The context-menu label is 2px larger and uses primary ink color — not matching the muted group-header aesthetic.  
*Fix:* Change ContextMenuLabel className to `px-2 py-1.5 text-caption font-semibold text-muted-foreground` to match DropdownMenuLabel.  
<sub>verify: context-menu.tsx:167 uses text-body font-medium text-foreground; dropdown-menu.tsx:174 correctly uses text-caption font-semibold text-muted-foreground</sub>  

**🟡 minor — ScrollArea thumb always visible with bg-border instead of warm auto-hide mf-text-4**  
`packages/app-tauri/src/components/ui/scroll-area.tsx:37`  
*Artboard:* globals.css defines `.mf-thin-scrollbar` (lines 900-929) as the warm-chrome scrollbar pattern: thumb hidden until hover (scrollbar-color: transparent transparent resting, mf-text-4 on hover), thin 10px width. The sessions sidebar uses this class. The artboard shows scrollbars as hidden until scrolling/hover.  
*Drift:* ScrollArea thumb uses `bg-border` (rgba(0,0,0,0.08)) which is always visible. The warm-chrome spec hides scrollbar thumbs at rest and reveals them on hover using --mf-text-4 (#bcbab5) as the thumb color. The Radix ScrollArea implementation does not apply .mf-thin-scrollbar behaviors.  
*Fix:* Apply the warm scrollbar theme to ScrollBar: change thumb class to `bg-mf-text-4 opacity-0 group-hover/scroll:opacity-100 transition-opacity` or apply the `.mf-thin-scrollbar` CSS class to the ScrollAreaPrimitive.Root element instead of using the Radix scrollbar.  
<sub>verify: scroll-area.tsx:37 hardcodes bg-border (always visible); globals.css:902-929 defines .mf-thin-scrollbar with hover behavior that should be applied</sub>  

**🟡 minor — mf-viewer-check-a and mf-viewer-check-b are defined but not mapped to Tailwind utilities in @theme inline**  
`packages/app-tauri/src/styles/globals.css:84-85 (defined) — absent from the @theme inline block (lines 646-766)`  
*Artboard:* Design Tokens Report.html §04 File-viewer backdrop: viewer checkerboard uses --mf-viewer-check-a and --mf-viewer-check-b per-scheme tokens. mainframe-theme.css @theme inline maps --mf-viewer-matte but NOT the two check tokens.  
*Drift:* Both --mf-viewer-check-a and --mf-viewer-check-b are defined across all 6 theme blocks but have no corresponding --color-mf-viewer-check-a / --color-mf-viewer-check-b entries in @theme inline. Any component that tries to use the Tailwind utility `bg-mf-viewer-check-a` or `bg-mf-viewer-check-b` would get a phantom class (drops silently to transparent). Currently no code uses them as Tailwind classes (they are used via CSS var() inline), but the gap is a latent phantom-token trap.  
*Fix:* Add to the @theme inline block: `--color-mf-viewer-check-a: var(--mf-viewer-check-a);` and `--color-mf-viewer-check-b: var(--mf-viewer-check-b);`  
<sub>verify: globals.css:84-85 define --mf-viewer-check-a and --mf-viewer-check-b; @theme inline omits --color-mf-viewer-check-a and --color-mf-viewer-check-b mappings</sub>  

<details><summary>Deferred (not drift) — 5</summary>

- Button 22px icon-xs size variant: the artboard specifies 22px for sidebar/group-header icon buttons, 24px for pane toolbars, 28px for main toolbar. Built button.tsx has icon=28px and icon-sm=24px but no 22px variant. Current consumers (SessionRow.tsx) work around it with inline `size-[22px]` classes on native `<button>` elements rather than the Button primitive — this is a tracker backlog cleanup item, not an active breakage.
- Window radial-gradient background: the artboard shows a warm radial-gradient behind the floating panels; today AppShell renders flat `bg-mf-window`. Listed as deferred in MIGRATION-TRACKER.md.
- Sidebar Update pill: tracker defers this until a Tauri updater data source is available.
- Context/Skills/Agents bottom panel (resize handle, tabbed panel): deferred in tracker.
- Settings → Appearance UI (scheme/window-style picker): store-only switching is in place; the Settings UI surface is a deferred tracker leaf.

</details>

---

## Notes

- **2 refuted** findings removed by the verify pass (chat-cards, tasks).
- Verify was lenient (2 refuted); the orchestrator independently re-verified the four foundational token claims — all TRUE. `minor` items were not all re-checked at source — treat `minor` as a polish checklist, not gospel.
- A few fixes cite pixel values that want a live render check; flagged inline where relevant.
