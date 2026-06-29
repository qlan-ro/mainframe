---
"@qlan-ro/mainframe-ui": patch
---

Stop tooltips from stretching across the whole viewport. The shared
`TooltipContent` now has a default `max-w-xs` with `break-words`, so long content
wraps into a readable block instead of one full-width line (callers that need a
different width still override via their own `max-w-*`). The skills/agents list
rows (`ScopedListRow`) now use `TruncatedWithTooltip` for the description, so it
wraps and only appears when the description is actually clipped.
