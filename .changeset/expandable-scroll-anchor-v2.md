---
'@qlan-ro/mainframe-desktop': patch
---

Follow-up to #271: the original 1px nudge did not actually defeat assistant-ui's autoScroll. Tracing `useThreadViewportAutoScroll.js`: the ResizeObserver callback reads `isAtBottom` from a Zustand store, and the store is only updated by the scroll event handler. Programmatic `scrollTop = X` queues the scroll event asynchronously — so the resize fires first with the stale `isAtBottom = true`, autoScroll snaps to bottom, and the just-expanded pill flies off-screen anyway. Live repro: pill viewport top went 482.5 → -5.5 (-488 px). Fix: nudge 2px (safer than 1px against sub-pixel scrollTop) AND synchronously dispatch a `scroll` event so assistant-ui's handler updates the store BEFORE the resize callback consults it. After fix: pill top 482.5 → 484.5 (+2 px, just the nudge), scrollTop 207.5 → 205.5, autoScroll skipped.
