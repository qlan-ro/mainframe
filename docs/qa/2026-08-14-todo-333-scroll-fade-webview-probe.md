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

**(b) Does `backdrop-filter` survive under a masked ancestor? No — it is significantly attenuated.**

A `scroll-fade-y` scroller containing a `backdrop-filter: blur(16px)` glass child over a
high-contrast diamond pattern, next to an unmasked control with the same child. By eye the two looked
close enough to be a judgment call, so the claim was quantified instead of eyeballed (the `takeSnapshot`
miss above is exactly why): grayscale standard deviation of the card interior (a band clear of the
label text and the rounded border, sampled from the committed `full-window.png`, two independent band
placements to rule out a one-off crop) —

| sample                              | mean  | stddev |
|--------------------------------------|-------|--------|
| masked card interior (band 1)        | 115.4 | 25.75  |
| masked card interior (band 2)        | 108.1 | 25.74  |
| masked card interior (alt band)      | 107.3 | 26.02  |
| unmasked control interior (band 1)   | 112.1 | 0.38   |
| unmasked control interior (band 2)   | 112.1 | 3.48   |
| unmasked control interior (alt band) | 112.1 | 0.35   |
| sharp diamond background (unblurred) | 28.0  | 0.00 †|

† low stddev here is a flat run of one background tile at the crop origin, not a blur signal — included
only to show the sampling method also produces near-zero stddev on genuinely flat input, which the
control matches and the masked card does not.

The control is blurred nearly flat (stddev 0.3–3.5, matching a real 16px Gaussian blur over a 20px-tile
pattern). The masked card is not: stddev ~26, an order of magnitude higher, with individual diamonds
still visually distinguishable in `checkpoint-b-backdrop-filter.png`. `mask-image` on the ancestor does
not kill `backdrop-filter` outright, but it does not let it "survive" either — it is compositing a
markedly weaker blur, plausibly because the mask forces the ancestor into its own compositing layer
that the backdrop filter samples through differently. This is the plan's own named risk
("A masked element plausibly forms a backdrop root, which would flatten the card's `backdrop-blur-xl`
to nothing") landing as a partial rather than total flatten. Screenshot:
`docs/qa/assets/2026-08-14-todo-333/checkpoint-b-backdrop-filter.png` (full window, uncropped:
`docs/qa/assets/2026-08-14-todo-333/full-window.png`).

Task 7's conditional reads "only if Task 1's checkpoint (b) showed `backdrop-filter` surviving a masked
ancestor" — it did not. `SessionPanel.tsx`'s `stackChrome` should stay unmasked, with the one-line
comment the task's own fallback branch specifies; the fade belongs on `PanelCard.tsx`'s card body only.

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
so the change's premise (the utility is genuinely scroll-aware, not a static ramp) holds — the halt
condition on those checkpoints is not triggered. (b) is not a halt condition either way (the plan
scopes it to Task 7's own conditional, not a stop), but the answer is the fallback branch, not the
happy path: `backdrop-filter` is markedly attenuated (quantified above) under a masked ancestor, so
Task 7 should leave `SessionPanel.tsx`'s `stackChrome` unmasked and fade only `PanelCard.tsx`'s card
body, per the fallback the task itself describes. (d) confirms the primary scroll-timeline path is
what this engine takes today, not the static-fallback branch.
