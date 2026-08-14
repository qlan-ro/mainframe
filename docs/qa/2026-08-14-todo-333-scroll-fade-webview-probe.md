# Todo #333 — Task 1: shipping WebView probe for `scroll-fade`

Answers the three engine-behavior questions the plan (`docs/plans/2026-08-14-todo-333-scroll-fade-plan.md`,
"Explicitly NOT established") flagged as unverifiable from jsdom, before Task 5–10 commit to the
`scroll-fade` utility family.

## Method

`wry` (the crate behind `tauri = { version = "2", ... }`,
`packages/app-tauri/src-tauri/Cargo.toml:21`) instantiates a plain system `WKWebView` on macOS — it
does not bundle its own engine. A ~50-line Swift script (`probe2.swift`, scratch, not committed)
built the same object directly: an `NSWindow` hosting a `WKWebView`, loaded via `loadFileURL` against
a scratch `probe.html` (scratch, not committed, outside `packages/ui/src` per the plan's ordering
constraint). This is a closer proxy to the shipping engine than Safari-the-app (different feature
toggles) or Playwright's WebKit (a separately bundled build, not the OS-provided engine).

The scratch page's CSS was `tailwindcss@4.3.3`'s own `compile()` API, given the same
`loadStylesheet` resolution the plan's own probe used (plan lines 26–34): `tailwindcss` →
`node_modules/tailwindcss/index.css`, `shadcn/tailwind.css` → `node_modules/shadcn/dist/tailwind.css`,
`tw-animate-css` → its `dist/tw-animate.css`. The candidate list was `['scroll-fade-y', 'scroll-fade-x']`.
The compiled output includes the `@property --scroll-fade-t/-b/-s/-e { initial-value: 0px }`
registrations — load-bearing for the "no overflow → no fade" case (checkpoint a).

First attempt used `WKWebView.takeSnapshot`, which turned out **not** to composite `backdrop-filter`
(both the masked and unmasked glass-card boxes rendered identically flat — see `full-window.png` for
the corrected version's contrast). Second attempt kept the window on screen, printed its
`NSWindow.windowNumber`, and captured the real compositor output with
`screencapture -o -l<windowID>` from the shell — that is what every screenshot below is. The Swift
process was killed after the capture; no background process was left running.

Environment: macOS 26.4.1 (build 25E253), Xcode 26.3, system WebKit as shipped with that macOS build.

## Findings

**(a) Does the non-overflowing box show a fade? No.**

Two identical `overflow-y-auto scroll-fade-y` boxes, one whose content fits (no overflow) and one
whose content overflows. The fitting box shows no fade at either edge; the overflowing box shows a
fade at the bottom only (it starts scrolled to the top, so there is nothing above the top edge to
fade against yet, and content below the bottom edge) — the scroll-driven timeline reads container
overflow, not a static both-ends ramp. Screenshot:
`docs/qa/assets/2026-08-14-todo-333/checkpoint-a-fits-vs-overflow.png`.

**(b) Does `backdrop-filter` survive under a masked ancestor? Yes.**

A `scroll-fade-y` scroller containing a `backdrop-filter: blur(16px)` glass child over a
high-contrast diamond pattern, next to an unmasked control with the same child. Both glass cards
blur the pattern behind them to the same degree — the masked ancestor does not flatten the
`backdrop-filter` compositing layer. Screenshot:
`docs/qa/assets/2026-08-14-todo-333/checkpoint-b-backdrop-filter.png` (full window, uncropped, for
side-by-side contrast: `docs/qa/assets/2026-08-14-todo-333/full-window.png`).

This clears Task 7's conditional: `SessionPanel.tsx`'s `stackChrome` may take `scroll-fade-y`
directly: no fallback comment is needed.

**(c) Does the horizontal rail whose items fit dim them? No.**

A `overflow-x-auto scroll-fade-x` rail with three items, none of which overflow the container. All
three render at full opacity/saturation, no dimming at either end. Screenshot:
`docs/qa/assets/2026-08-14-todo-333/checkpoint-c-horizontal-rail-fits.png`.

**(d) Which `@supports` branch is live?**

`CSS.supports('animation-timeline', 'scroll()')` evaluated **`true`** in this WebView, rendered into
the DOM (not read from a detached console) and captured in the same screenshots. Screenshot:
`docs/qa/assets/2026-08-14-todo-333/checkpoint-d-supports-badge.png`. This is also corroborated by
(a): a static both-edges fallback (`@supports not (animation-timeline: scroll())`,
`node_modules/shadcn/dist/tailwind.css:191-194`) would have faded the non-overflowing box too, and it
did not.

## Conclusion

None of the three plan-halting conditions fired: (a) and (c) both show no fade on fitting content,
so the change's premise (the utility is genuinely scroll-aware, not a static ramp) holds. (b) shows
`backdrop-filter` surviving a masked ancestor, so Task 7 does not need the outer-stack fallback its
own conditional describes — `SessionPanel.tsx`'s `stackChrome` can take the fade unconditionally, same
as `PanelCard.tsx`'s card body. (d) confirms the primary scroll-timeline path is what this engine
takes today, not the fallback.
