---
"@qlan-ro/mainframe-ui": patch
---

Add a short open delay to tooltips so they no longer fire the instant the
pointer crosses an element. Every `TooltipProvider` (root, `Hint`,
`DismissibleHint`, `TruncatedWithTooltip`, `TooltipIconButton`) now uses a shared
`TOOLTIP_DELAY_MS` — 500ms in the app, 0 under test so hover assertions stay
synchronous — replacing the previous `delayDuration={0}` that made tooltips pop
eagerly all over the UI.
