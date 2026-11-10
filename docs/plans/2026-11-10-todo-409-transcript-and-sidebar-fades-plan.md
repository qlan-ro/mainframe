# Todo #409 — transcript edge fades and sidebar fade labels (short form)

Route: no-spec. Design direction A (brief, 2026-11-10). Expected source diff is well under 150 lines, so this is the short-form plan: one implementation group, TDD inline.

## Goal

1. The chat transcript scroller fades at its top edge and just above the composer, driven by scroll position: no top ramp at the very top, no bottom ramp when pinned to the bottom. The composer, footer banners and the scroll-to-bottom button stay fully opaque.
2. Every single-line label in the left session sidebar that still uses `truncate` (ellipsis) uses `FadeLabel` instead, so it fades only when it actually overflows.

## Files

- `packages/ui/src/features/chat/thread/ChatThreadViewport.tsx`: add `scroll-fade-y scroll-fade-sticky` to `ThreadPrimitive.Viewport`. Set `--scroll-fade-inset-b` to the measured height of the `ThreadPrimitive.ViewportFooter` element, and leave `--scroll-fade-inset-t` at 0. Compose the existing `footerRef` from `useThreadBottomPin` with a state setter so the footer element can be measured. Move the scroll-to-bottom button out of the masked subtree (see the Risks section). The file is 156 lines today. Put new logic in a sibling file so this one stays small.
- New `packages/ui/src/features/chat/thread/use-element-height.ts` (or a similar name): a ResizeObserver hook that returns an element's border-box height in px. It returns 0 for a null element and 0 when `ResizeObserver` is undefined (jsdom).
- New `packages/ui/src/features/chat/thread/TranscriptScrollToBottom.tsx`: the existing `ThreadPrimitive.ScrollToBottom` button, with the same `data-testid="chat-scroll-to-bottom"`, aria-label and classes. It renders through `createPortal` into an overlay host that is a sibling of the viewport inside the existing `relative` root div. Position it absolutely at `bottom: footerHeight + 2.5rem` so it lands where `-top-10` puts it today.
- `packages/ui/src/features/sessions/SessionGroupHeader.tsx`: label span becomes `FadeLabel className="flex-1"`.
- `packages/ui/src/features/sessions/DraftSessionRow.tsx`: `sessions-draft-row-title` span becomes `FadeLabel`. Keep the testid and colour classes.
- `packages/ui/src/features/sessions/SessionSidebar.tsx` (`NewSessionRow`): "New session" span becomes `FadeLabel className="flex-1"`.
- `packages/ui/src/features/sessions/NoProjectLabel.tsx`: the inner "No project" span becomes `FadeLabel className="flex-1"`. The outer `inline-flex min-w-0` wrapper takes the caller's `flex-1`, which gives the fade a flexible box. In content-sized callers (welcome picker, archived dialog, palette) the label fits, so nothing changes there.
- `packages/ui/src/features/sessions/SessionRowMetaLine.tsx` (`sessions-row-your-turn`) and `ScopeSummary.tsx` (`sessions-scope-label`): swap `truncate` for `FadeLabel` so the sweep is complete. Keep the testids.
- Tests: colocated `__tests__` next to each touched area (sessions labels, chat thread viewport).
- `.changeset/todo-409-transcript-and-sidebar-fades.md`: patch for `@qlan-ro/mainframe-ui`.

## TDD (inline, red before green)

1. Sidebar labels: write a test that renders `SessionGroupHeader`, `DraftSessionRow`, `NewSessionRow` (or `SessionSidebar` if that is lighter to mount) and `NoProjectLabel`. Stub `scrollWidth`/`clientWidth` on the label element. Assert that each label is a `[data-slot="fade-label"]` with `truncate-fade` only when `scrollWidth > clientWidth + 1`, with no `truncate` class and no `text-overflow: ellipsis`. A fitting label has no mask class. Run it red, swap the spans, run it green.
2. Transcript: write a test that mounts `ChatThreadViewport` the way the existing `ChatThread*.test.tsx` suites do. Assert that `chat-thread-viewport` carries `scroll-fade-y` and `scroll-fade-sticky`. With `ResizeObserver` stubbed and a stubbed footer height, `--scroll-fade-inset-b` must equal that height in px, and it must update when the observed height changes, which models a growing composer. `chat-scroll-to-bottom`, when rendered, must not be a descendant of `chat-thread-viewport`, and clicking it must still call the viewport store's scroll-to-bottom (assert observable scroll or the existing behaviour the current tests use). Run it red, implement, run it green.
3. Visual: record light and dark screenshots for the PR in three states: transcript scrolled mid-way (both ramps, composer opaque, button unfaded), at the top (no top ramp) and pinned at the bottom (no bottom ramp). jsdom cannot evaluate scroll-driven animations, so the screenshot is the evidence for the ramps themselves.

## Risks

- **Scroll-to-bottom context.** `ThreadPrimitive.Viewport` wraps its children in its own `ThreadPrimitiveViewportProvider`, and `ThreadPrimitive.Root` does not provide one. A plain JSX hoist of `ScrollToBottom` outside the Viewport would lose the store and throw or hide. Use a React portal declared inside the Viewport tree, so context flows while the DOM sits outside the mask. Do not import the unexported provider.
- **Mask scope.** The mask covers the whole viewport element, including the sticky footer. `scroll-fade-sticky` makes the bottom `inset-b` band opaque (`#000`), so the footer stays opaque as long as the inset equals the footer's full height. Measure the footer's border box. Its `max-h` cap still yields the rendered height.
- **The bottom ramp is scroll-driven.** `scroll-fade-y` runs off `scroll(self y)`. Bottom-pin following keeps `scrollTop` at max, so the ramp is 0 while following. No extra state is needed. Do not add JS show/hide logic.
- **SidebarMenuButton `[&>span:last-child]:truncate`.** This adds an ellipsis to the button's last-child span. None of the swapped labels is the last child: "New session" is followed by the Plus icon, and the draft title is followed by the meta span. Keep it that way. The test's ellipsis assertion would catch a regression.
- **Function and file limits.** These are 50 lines per function and 300 per file. `ChatThreadViewport` must keep its function bodies short, so the measuring and portal logic goes in the new files.

## Established facts

- `scroll-fade-y` sets `mask-image: var(--scroll-fade-mask, …)` and drives `--scroll-fade-t/b` with `animation-timeline: scroll(self y)` inside `@supports (animation-timeline: scroll())`. Receipt: `node_modules/.pnpm/shadcn@4.16.1*/node_modules/shadcn/dist/tailwind.css`, `@utility scroll-fade-y` and `@keyframes scroll-fade-reveal-b`.
- `scroll-fade-sticky` overrides `--scroll-fade-mask` with `--scroll-fade-inset-t/b` bands that stay opaque and ramps that start inside them. Receipt: `packages/ui/src/styles/globals.css`, `@utility scroll-fade-sticky`.
- The ramp depth token is `--scroll-fade-size: 20px`, and the `@supports not (animation-timeline: scroll())` rule drops the mask on `.scroll-fade-y`. Receipt: `packages/ui/src/styles/globals.css`, the `:root` `--scroll-fade-size` and the `@supports not` block.
- `SidebarScrollRegion` is the existing pattern: it uses classes plus inline `--scroll-fade-inset-*` style from a measured hook. Receipt: `packages/ui/src/features/shared/SidebarScrollRegion.tsx`, `SidebarScrollRegion` and `useStickyInsets`.
- `FadeLabel` applies `truncate-fade` only when `useIsTruncated` reports `scrollWidth > clientWidth + 1`, and exposes `data-slot="fade-label"` and `data-truncated`. Receipt: `packages/ui/src/components/ui/fade-label.tsx` `FadeLabel`, `packages/ui/src/lib/ui/use-is-truncated.ts` `useIsTruncated`.
- `ThreadPrimitive.Viewport` creates a nested viewport store via `ThreadPrimitiveViewportProvider`. `ScrollToBottom` reads `useThreadViewportStore()` from context, and `ThreadRoot` provides no store. Receipt: `@assistant-ui/react@0.15.13` `dist/primitives/thread/ThreadViewport.js`, `ThreadScrollToBottom.js` and `ThreadRoot.js`, plus `dist/context/providers/ThreadViewportProvider.js`.
- The `footerRef` returned by `useThreadBottomPin` is a `RefCallback` that registers the footer with the pin's ResizeObserver. A composed ref must still call it. Receipt: `packages/ui/src/features/chat/thread/use-thread-bottom-pin.ts`, `useFooterObserver`.
- The SidebarMenuButton base class includes `[&>span:last-child]:truncate`. Receipt: `packages/ui/src/components/ui/sidebar/menu.tsx`, the menu button `cva` base.
- `docs/plans/` is gitignored, so commit it with `git add -f`. Receipt: `.gitignore` (`docs/plans/`).

## Exit gates (end of the single group)

- New and existing tests pass for the touched areas (sessions and chat thread suites). UI typecheck and lint are clean.
- A grep of the left session sidebar components (`SessionSidebar`, `SessionGroupHeader`, `DraftSessionRow`, `NoProjectLabel`, `SessionRowMetaLine`, `ScopeSummary` outside its tooltip content) finds no remaining `truncate` on single-line labels.
- Existing testids (`chat-thread-viewport`, `chat-scroll-to-bottom`, `chat-thread-footer`, `sessions-row-title`, `sessions-draft-row-title`, `sessions-group-header-*`, `sidebar-action-new-thread`) still resolve.
- The changeset is present, and the screenshots are captured for the PR.

## Out of scope

- The session panel, file tree, settings and filter dropdown menu (`SessionsFilterMenu`), and the hover card (`SessionMetaCard`).
- Ramp-depth changes for existing scrollers, and new tooltips.
