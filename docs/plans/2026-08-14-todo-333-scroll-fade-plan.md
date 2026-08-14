# Todo #333 — adopt shadcn `scroll-fade` for scroll edge fades

## Goal

Replace the app's one hand-rolled scroll edge fade with the `scroll-fade` utility family that
`shadcn@4.16.1` already ships and `packages/ui/src/styles/globals.css` already imports, and extend
the treatment to the scrollers that clip today. The sidebar keeps its sticky-header offset by
feeding a header-aware gradient through the utility's own `--scroll-fade-mask` override, so its
scroll-position tracking and its inline `maskImage` both go away while the header-inset measurement
stays. The session panel's vertical scrollers, both horizontal tab strips, and the composer
attachment rail gain fades. One shared depth token (`--scroll-fade-size: 20px`) keeps every adopted
surface reading at the same ramp. The transcript viewport, the clamped-content ramps, and
`truncate-fade` are untouched.

## Established facts

Every line below was verified in this worktree while planning. Paths are relative to
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-333-scroll-fade`.

- The `scroll-fade` family exists in the installed package: `@utility scroll-fade` at
  `node_modules/shadcn/dist/tailwind.css:158`, `-y` at `:198`, `-x` at `:238`, `-t/-b/-l/-r/-s/-e`
  at `:287/:317/:350/:380/:413/:451`, `scroll-fade-none` at `:517`. `shadcn` is `4.16.1`
  (`node_modules/shadcn/package.json:3`).
- The stylesheet is imported by the v2 token layer: `@import 'shadcn/tailwind.css'` at
  `packages/ui/src/styles/globals.css:53`.
- **These utilities compile in this project today.** Verified by compiling
  `packages/ui/src/styles/globals.css` through the installed `tailwindcss@4.3.3`
  (`node_modules/tailwindcss/dist/lib.mjs`, `compile()` with a `loadStylesheet` that resolves
  `tailwindcss` → `node_modules/tailwindcss/index.css`, `shadcn/tailwind.css` → the package's
  `dist/tailwind.css`, `tw-animate-css` → its `dist/tw-animate.css`) and building the candidate
  list `['scroll-fade-y','scroll-fade-x','scroll-fade-t','scroll-fade-none','truncate-fade']`. The
  output contained `.scroll-fade-y`, `.scroll-fade-x`, `.scroll-fade-t`, `.scroll-fade-none`,
  `animation-timeline`, `@property --scroll-fade-mask`, and `@keyframes scroll-fade-reveal-s`.
  (The probe script was a scratch file; it was deleted and is not part of the change.)
- **The per-edge size variable is `--scroll-fade-t-size`, not `--scroll-fade-size-t`.** The Agent
  Brief names it loosely. Receipt: `node_modules/shadcn/dist/tailwind.css:159-167` reads
  `var(--scroll-fade-t-size, var(--scroll-fade-size, …))` into the private `--_scroll-fade-size-t`.
- The shared depth knob is `--scroll-fade-size`; its default is
  `min(12%, calc(var(--spacing) * 10))` (`node_modules/shadcn/dist/tailwind.css:161`). With
  Tailwind's default `--spacing: 0.25rem` (`node_modules/tailwindcss/theme.css:325`, and nothing in
  `packages/ui/src/styles/*.css` or `shadcn/dist/tailwind.css` overrides it) that is
  `min(12%, 40px)` — percentage-based and much deeper than the app's current ramp.
- The reveal distance knob is `--scroll-fade-reveal`, default `calc(var(--spacing) * 24)` = 96px
  (`node_modules/shadcn/dist/tailwind.css:187-188`).
- Per-surface depth overrides exist as classes: `@utility scroll-fade-*` sets `--scroll-fade-size`
  from an integer spacing step or a bare length/percentage
  (`node_modules/shadcn/dist/tailwind.css:492-495`), so `scroll-fade-5` = `calc(0.25rem * 5)` = 20px.
- **Upstream's own per-edge variants use the `--scroll-fade-mask` override to reshape the gradient
  while still consuming the scroll-driven depth vars.** `@utility scroll-fade-t`
  (`node_modules/shadcn/dist/tailwind.css:287-301`) sets `--scroll-fade-mask` to a gradient built
  from `var(--scroll-fade-t, 0px)`. Our sticky-header shape is the same pattern, not an invention.
- `--scroll-fade-mask` is registered as `@property { syntax: "*"; inherits: false; }` with **no**
  `initial-value` (`node_modules/shadcn/dist/tailwind.css:118-121`, and the compiled output emits it
  verbatim). A registered property with no initial value is guaranteed-invalid until set, so
  `var(--scroll-fade-mask, var(--scroll-fade-block))` in `scroll-fade-y`
  (`node_modules/shadcn/dist/tailwind.css:216-217`) falls back to the block gradient until something
  sets it, and setting it on the same element replaces the shape.
- `--scroll-fade-t/-b/-s/-e` are registered `<length-percentage>` with `initial-value: 0px`
  (`node_modules/shadcn/dist/tailwind.css:98-117`) — i.e. depth 0, no fade, when nothing animates
  them.
- The sidebar scroller is a real scroll container the timeline can bind to: `SidebarContent` carries
  `overflow-auto` (`packages/ui/src/components/ui/sidebar/sections.tsx:35`) and spreads props, so
  `className` and `style` both reach the DOM node (`sections.tsx:38`).
- The app's current ramp depth is 20px: `const FADE = 20` in
  `packages/ui/src/features/shared/SidebarScrollRegion.tsx:24`; the inline mask is applied at
  `SidebarScrollRegion.tsx:72` via `style={{ maskImage: edgeMask(edges) }}`.
- `SidebarScrollRegion.tsx` is on the raw-color-literal allowlist purely because of the `#000`
  gradient stops: `packages/ui/src/__tests__/design-token-audit.test.ts:56` inside
  `COLOR_LITERAL_ALLOWLIST`, justified by the comment at `:48-49`.
- The sticky headers the sidebar mask offsets around are `[data-slot="sidebar-group-label"]`
  (`packages/ui/src/features/shared/use-scroll-edges.ts:19`), emitted by `SidebarGroupLabel`
  (`packages/ui/src/components/ui/sidebar/sections.tsx:63`).
- Nothing outside the sidebar consumes the hook: the only importers of `useScrollEdges` /
  `SidebarScrollRegion` are `SidebarScrollRegion.tsx` itself,
  `packages/ui/src/features/sessions/SessionSidebar.tsx:35,153` and
  `packages/ui/src/features/sessions/SessionListVirtuoso.tsx:23,61` (the latter uses only
  `useScrollRegion`, the element context — not the edges). There is **no** existing test file for
  `use-scroll-edges.ts`, so nothing asserts the removed contract.
- The attachment rail dropped upstream's fade deliberately; the comment to delete is at
  `packages/ui/src/components/ui/attachment.tsx:159-161`, on the `AttachmentGroup` `overflow-x-auto`
  container at `:162`.
- Target surfaces and their exact scroll containers:
  `packages/ui/src/features/session-panel/SessionPanel.tsx:77` (`stackChrome`, used by both the
  inline and overlay stacks), `packages/ui/src/features/session-panel/PanelCard.tsx:55` (card body),
  `packages/ui/src/features/session-tabs/SessionTabs.tsx:143` (session tab strip),
  `packages/ui/src/layout/WorkspaceTabStrip.tsx:47` (workspace tab strip),
  `packages/ui/src/components/ui/attachment.tsx:162` (attachment rail).
- `docs/plans/` is gitignored (`.gitignore:53`), so this plan is committed with `git add -f`.

### Explicitly NOT established (verify in the WebView — Task 1)

- That an `overflow-*-auto` container whose content fits produces an inactive `scroll()` timeline and
  therefore **no** fade. This is the whole premise of the change and it is engine behavior; jsdom
  cannot see it.
- That a `mask-image` on an ancestor does not break `backdrop-filter` on descendants (the
  `PanelCard` glass). A masked element plausibly forms a backdrop root, which would flatten the
  card's `backdrop-blur-xl` to nothing.
- That the fallback branch (`@supports not (animation-timeline: scroll())`,
  `node_modules/shadcn/dist/tailwind.css:191-194`) is not what the shipping WebView takes.

## Decisions made in-lane

The Design direction delegates the visual calls to this lane. These are the calls.

1. **Sidebar: hybrid, per the brief's recommendation.** `scroll-fade-y` supplies the scroll-driven
   depth; an app-level `scroll-fade-sticky` utility supplies the header-offset shape through
   `--scroll-fade-mask`. Only the sticky-inset measurement survives in TS.
2. **The gradient lives in CSS, not in a component.** The component passes two numbers
   (`--scroll-fade-inset-t/-b`) as an inline style. This satisfies the acceptance criterion
   literally ("no component computes a `mask-image`") and lets `SidebarScrollRegion.tsx` come off
   the `design-token-audit` color-literal allowlist.
3. **The scroll listener SURVIVES in the hook.** The brief says to delete it; that is wrong. The
   sticky header stack changes *as you scroll* (a parked section header, then the group header you
   are inside), so the inset must still be re-measured on scroll. What dies is the `top`/`bottom`
   boolean state and the `scrollTop`/`scrollHeight` arithmetic that fed it.
4. **Depth: `--scroll-fade-size: 20px` on `:root`.** Matches the app's shipped `FADE = 20`, is
   unregistered so it inherits to every adopted surface, and is overridable per surface with
   `scroll-fade-<n>` if one ever needs to differ.
5. **Reveal distance: keep upstream's 96px default.** The brief's decision covers depth, not reveal.
   A long reveal degrades gracefully on a barely-overflowing container (a partial ramp rather than a
   full-depth fade eating half the overflow). Revisit only if Task 1 reads the ramp-in as laggy.
6. **Include `WorkspaceTabStrip` (`layout/WorkspaceTabStrip.tsx:47`).** The brief names only the
   session-tab strip, but its rationale — a clipped tab strip is the app's clearest "there is more"
   case — applies verbatim, and the `AttachmentGroup` comment being deleted cites "the app's other
   horizontal rails (tab strips) clip" as precedent. Leaving one of two adjacent tab strips clipping
   preserves exactly the inconsistency this todo exists to remove. One class; lane decision.
7. **Nested `PanelCard` bodies get the fade; the outer stack gets it only if Task 1 clears the
   backdrop-root risk.** Card bodies genuinely scroll independently (`max-h-96` cap,
   `PanelCard.tsx:55`). If masking the stack kills the card glass, the stack is left alone with a
   one-line comment recording why — the acceptance criteria's own escape hatch.

## Constraints

- `packages/ui` only. No core, no Rust, no types package.
- Max 300 lines/file, 50/function (CLAUDE.md). No `@ts-ignore`. Comments say *why*.
- `data-testid` on interactive elements — none of these edits add interactive elements.
- Changeset required before commit (patch, `@qlan-ro/mainframe-ui`).
- Single test file runs: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`.
  Typecheck: `pnpm --filter @qlan-ro/mainframe-ui typecheck` (includes test files).
- Running `tauri:dev` MUST set `MAINFRAME_DATA_DIR` and `DAEMON_PORT` to non-default values, or the
  dev app hijacks the production daemon on :31415 and the user's `~/.mainframe`.
- Out of scope, do not touch: `features/chat/thread/ChatThread.tsx` (transcript viewport), the
  read-more / collapsed-code-snippet / reasoning clamp ramps, `truncate-fade`
  (`globals.css:209-213`), scrollbar styling.

---

## Tasks

### Task 1 — Probe the shipping WebView for the three engine behaviors

**Kind:** verification. **Files:** creates `docs/qa/2026-08-14-todo-333-scroll-fade-webview-probe.md`.

Build a scratch HTML page and load it in the Tauri WebView (simplest route: a temporary route or a
`file://` page opened from the dev app; do NOT commit the scratch page). It must contain:

1. A `overflow-y-auto` box with `scroll-fade-y` whose content **fits** (no overflow), and a second
   identical box whose content **overflows**.
2. A `overflow-y-auto` box with `scroll-fade-y` containing a child with
   `backdrop-filter: blur(16px)` over a patterned background — the `PanelCard` arrangement.
3. A `overflow-x-auto` box with `scroll-fade-x` whose items fit.

Record, one line each with a screenshot path under `docs/qa/assets/2026-08-14-todo-333/`:

- (a) Does the non-overflowing box show a fade? Expected: no.
- (b) Does the `backdrop-filter` child still blur its backdrop under the masked ancestor?
- (c) Does the horizontal rail whose items fit dim them? Expected: no.
- (d) Which `@supports` branch is live — evaluate `CSS.supports('animation-timeline', 'scroll()')`
      in the WebView console and record the boolean.

**Verification:** the doc exists, committed, and answers (a)–(d) with a screenshot for (a), (b), (c).
If (a) or (c) is "yes, it fades anyway", stop and report — the whole change's premise is void.
If (b) is "no", Task 7 skips the outer stack (see its conditional).

---

### Task 2 — Red test for the sticky-inset measurement

**Kind:** test (red phase — must fail before Task 4 exists). **Files:** creates
`packages/ui/src/features/shared/__tests__/sticky-insets.test.ts`.

Write a unit test against a **pure** function that does not exist yet:

```ts
// packages/ui/src/features/shared/use-sticky-insets.ts
export function stickyInset(
  bounds: { top: number; bottom: number },
  headers: Array<{ top: number; bottom: number }>,
  edge: 'top' | 'bottom',
): number
```

Semantics to assert (lifted from the surviving half of
`packages/ui/src/features/shared/use-scroll-edges.ts:29-41`, so behavior is preserved, not redesigned):

- No headers → `0` for both edges.
- One header parked flush at the top edge → its height.
- Two headers stacked at the top (second's `top` equals the first's `bottom`) → the combined depth
  (the deeper `bottom - bounds.top`).
- A header scrolled well away from the edge (its offset exceeds the accumulated inset by more than
  the 1px epsilon) → `0`, i.e. it does not count.
- Symmetric cases for `edge: 'bottom'` (depth measured as `bounds.bottom - rect.top`).
- Sub-pixel: a header offset of `0.5px` from the edge still counts (EPSILON = 1).

**Verification:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/shared/__tests__/sticky-insets.test.ts`
fails with a module-not-found / undefined-export error. That failure is the deliverable of this task.

---

### Task 3 — Fade tokens and the sticky-header mask utility

**Kind:** ui. **Files:** `packages/ui/src/styles/globals.css` (only file touched by this task).

Add, after the imports and near the existing `truncate-fade` utility (`globals.css:209`):

1. A `:root` declaration of `--scroll-fade-size: 20px`, in a `@layer base` block, with a one-line
   comment saying why the stock `min(12%, 40px)` default is wrong here (it scales with panel height
   and is twice the app's shipped ramp).
2. An `@utility scroll-fade-sticky` that sets `--scroll-fade-mask` to a `linear-gradient(to bottom, …)`
   built from `--scroll-fade-inset-t` / `--scroll-fade-inset-b` (both defaulting to `0px`) and the
   utility's animated `--scroll-fade-t` / `--scroll-fade-b`. Stop order, mirroring the shape
   `edgeMask()` produces today (`SidebarScrollRegion.tsx:34-46`):

   ```
   #000 0
   #000 var(--scroll-fade-inset-t, 0px)
   transparent var(--scroll-fade-inset-t, 0px)
   #000 calc(var(--scroll-fade-inset-t, 0px) + var(--scroll-fade-t, 0px))
   #000 calc(100% - var(--scroll-fade-inset-b, 0px) - var(--scroll-fade-b, 0px))
   transparent calc(100% - var(--scroll-fade-inset-b, 0px))
   #000 calc(100% - var(--scroll-fade-inset-b, 0px))
   #000 100%
   ```

   Comment it with the *why*: the ramp must start below the sticky header stack or the fade
   dissolves the header instead of the rows; depth still comes from the utility's scroll-driven
   vars, so a zero depth collapses each transparent stop to zero width and the mask becomes opaque.

The utility sets only a custom property, so it composes with `scroll-fade-y` regardless of emission
order.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui build` succeeds — the script is
`tsc && vite build` (`packages/ui/package.json:8`) and Vite runs `@tailwindcss/vite`, so a malformed
`@utility` fails the build. Then `rg -n -- '--scroll-fade-size' packages/ui/dist/assets/*.css` finds
the `:root` declaration (a base-layer rule, always emitted; the bundle is minified per
`packages/ui/vite.config.ts:33`, so match the token, not the formatting).

Do **not** try to grep `.scroll-fade-sticky` here: Tailwind v4 emits an `@utility` only when a
scanned source file uses the class, and no file does until Task 5. That check lives in Task 12.

---

### Task 4 — Shrink the scroll-edge hook to sticky insets

**Kind:** ui. **Files:** creates `packages/ui/src/features/shared/use-sticky-insets.ts`, deletes
`packages/ui/src/features/shared/use-scroll-edges.ts`.

- Export the pure `stickyInset(bounds, headers, edge)` from Task 2's contract. It takes plain rect
  shapes, so jsdom can exercise it without layout.
- Export `useStickyInsets(viewport: HTMLElement | null): { top: number; bottom: number }`. It reads
  `viewport.getBoundingClientRect()` and the rects of
  `viewport.querySelectorAll('[data-slot="sidebar-group-label"]')`, feeds them to `stickyInset`, and
  keeps the existing rAF-coalesced `scroll` listener + `ResizeObserver` on the viewport and its first
  element child — **the listener stays**: the parked header stack changes as you scroll. Keep the
  identity-preserving `setState` guard so an unchanged measurement does not re-render.
- Delete `ScrollEdges`, the `top`/`bottom` booleans, and the `scrollTop`/`scrollHeight` arithmetic.
- Carry over the two load-bearing comments (why the stack depth cannot be assumed from one header's
  height; why content height is observed as well as scroll position), trimmed to the surviving
  behavior. Drop the "a static edge fade is wrong at rest" paragraph — the utility owns that now.
- Keep `EPSILON = 1` and the `HEADER_SELECTOR` constant.

**Verification:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/shared/__tests__/sticky-insets.test.ts`
passes (Task 2's red test goes green). `rg 'use-scroll-edges|useScrollEdges|ScrollEdges' packages/ui/src`
returns nothing.

---

### Task 5 — Swap `SidebarScrollRegion` onto the utility

**Kind:** ui. **Files:** `packages/ui/src/features/shared/SidebarScrollRegion.tsx`.

- Delete `const FADE = 20` and the whole `edgeMask()` function.
- Replace `useScrollEdges` with `useStickyInsets`.
- Add `'scroll-fade-y scroll-fade-sticky'` to the `cn()` class list, keeping `gap-0` and
  `overscroll-contain` and their comments.
- Replace `style={{ maskImage: edgeMask(edges) }}` with the two inset custom properties:

  ```tsx
  style={{ '--scroll-fade-inset-t': `${insets.top}px`, '--scroll-fade-inset-b': `${insets.bottom}px` } as CSSProperties}
  ```

  The cast is required — React's `CSSProperties` does not type custom properties. Use
  `as CSSProperties` (allowed; `@ts-ignore` is not).
- Rewrite the file docstring's fade paragraph: the fade is now the shadcn utility, scroll-aware by
  construction; the component contributes only the sticky-header insets.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes.
`rg 'maskImage' packages/ui/src` returns nothing.

---

### Task 6 — Take `SidebarScrollRegion` off the color-literal allowlist

**Kind:** ui. **Files:** `packages/ui/src/__tests__/design-token-audit.test.ts`.

Remove `'features/shared/SidebarScrollRegion.tsx'` from `COLOR_LITERAL_ALLOWLIST` (`:56`) and delete
the two sentences of the preceding comment block (`:48-49`) that justify it. Leave every other entry
and the rest of the comment intact.

**Verification:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/__tests__/design-token-audit.test.ts`
passes — proving the `#000` literals really are gone from the component.

---

### Task 7 — Fade the session panel's vertical scrollers

**Kind:** ui. **Files:** `packages/ui/src/features/session-panel/PanelCard.tsx`,
`packages/ui/src/features/session-panel/SessionPanel.tsx`.

- `PanelCard.tsx:55`: add `scroll-fade-y` to the card body's class list. Unconditional — the mask is
  on a descendant of the glass card, not an ancestor of it.
- `SessionPanel.tsx:77` (`stackChrome`): add `scroll-fade-y` **only if Task 1's checkpoint (b)
  showed `backdrop-filter` surviving a masked ancestor.** If it did not, leave `stackChrome`
  unchanged and add a one-line comment above it: masking the stack flattens each card's
  `backdrop-blur`, so the fade lives on the card bodies instead.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes. In the dev app, open two
session panels tall enough to overflow their caps: the card bodies fade at the edge with content
past it and show no fade when their content fits. Cards still read as glass.

---

### Task 8 — Fade the session tab strip

**Kind:** ui. **Files:** `packages/ui/src/features/session-tabs/SessionTabs.tsx`.

Add `scroll-fade-x` to the `overflow-x-auto` strip at `:143`, keeping `[scrollbar-width:none]`.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes, and
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs` stays green. In the
dev app: with enough tabs to overflow, the strip fades at the end you can still scroll toward; with
three tabs, no fade.

---

### Task 9 — Fade the workspace tab strip

**Kind:** ui. **Files:** `packages/ui/src/layout/WorkspaceTabStrip.tsx`.

Add `scroll-fade-x` to the `overflow-x-auto` strip at `:47`. Lane decision (Decisions §6) — the
brief names only the session-tab strip; record the reason in the changeset body, not in a code
comment (the class is self-explanatory).

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes. In the dev app with many
workspace tabs open, the strip fades; with two tabs, it does not.

---

### Task 10 — Restore the attachment rail's fade

**Kind:** ui. **Files:** `packages/ui/src/components/ui/attachment.tsx`.

Add `scroll-fade-x` to `AttachmentGroup`'s class list (`:162`) and **delete** the three-line comment
at `:159-161` that explains why upstream's ramp was dropped. Keep `[scrollbar-width:none]`,
`snap-x snap-mandatory`, `scroll-px-1`, `overscroll-x-contain`, and the `*:data-[slot=attachment]`
rules untouched.

Do this only after Task 1's checkpoint (c) confirms a rail whose items fit is not dimmed — that
objection is the reason the fade was removed, and deleting the comment without the receipt would be
re-introducing a known regression.

**Verification:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/attachments/__tests__/ComposerAttachmentStrip.test.tsx`
passes. In the dev app: attach two files — no dimming; attach eight — the rail fades at the end with
items past it.

---

### Task 11 — Changeset

**Kind:** test/close-out. **Files:** creates `.changeset/scroll-fade-utility-adoption.md`.

`pnpm changeset` → `@qlan-ro/mainframe-ui`, **patch**. Body: one sentence on the mechanism swap, one
naming the newly faded surfaces, one recording the `WorkspaceTabStrip` inclusion as a lane decision
beyond the brief's named scope.

**Verification:** the file exists and names `@qlan-ro/mainframe-ui` with `patch`.

---

### Task 12 — Acceptance sweep

**Kind:** test/close-out. **Files:** may touch any file from Tasks 4–10 if a check fails.

Run, in order:

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck`
2. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/shared/__tests__/sticky-insets.test.ts`
3. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/__tests__/design-token-audit.test.ts`
4. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/attachments/__tests__/ComposerAttachmentStrip.test.tsx`
5. `rg -n 'maskImage' packages/ui/src` → no hits. And after
   `pnpm --filter @qlan-ro/mainframe-ui build`,
   `rg -n 'scroll-fade-sticky|scroll-fade-y|scroll-fade-x' packages/ui/dist/assets/*.css` → all
   three present, proving the utilities really reached the shipped bundle.
6. Net line count in production UI source goes down:
   `git diff --numstat origin/main..HEAD -- 'packages/ui/src/**/*.ts' 'packages/ui/src/**/*.tsx' 'packages/ui/src/styles/globals.css' ':!packages/ui/src/**/__tests__/**'`
   — added minus deleted must be negative. Record the number.
7. WebView sweep in the dev app (with `MAINFRAME_DATA_DIR` and `DAEMON_PORT` overridden): sidebar
   fades top and bottom only where there is content past that edge; sticky section/group headers
   parked at an edge stay at full opacity with a fade running below them; a short session list
   shows no fade at either edge; the four newly adopted surfaces behave as their own tasks describe.

**Verification:** all seven pass. Any failure is fixed in this task, not deferred.

## Risks

- **Backdrop root.** If a masked ancestor kills `backdrop-filter`, the session panel's outer stack
  cannot take the fade. Task 1 answers this before Task 7 commits to it; the fallback is scoped and
  costs nothing.
- **Reveal feel.** 96px of scroll to reach full depth may read as a lagging fade against the old
  binary on/off. Mitigation is a one-line `--scroll-fade-reveal` override; deliberately not taken
  pre-emptively.
- **Virtuoso + mask.** The session list is windowed against this exact scroller
  (`SessionListVirtuoso.tsx:61`). A mask does not create a containing block for positioned
  descendants, and the scroller already carries an inline mask today, so this is low risk — but the
  Task 12 sweep must scroll the virtualized list far enough to trigger windowing, not just a screen.
- **Net-lines criterion.** The CSS utility adds ~20 lines to `globals.css` against ~35 deleted from
  the two TS files. The margin is thin; Task 12 measures it rather than assuming it.
