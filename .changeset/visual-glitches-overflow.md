---
'@qlan-ro/mainframe-desktop': minor
---

fix: handle width-overflow across chat/status/panel/title-bar rows

Adds two shared UI primitives, `<ScrollRow>` (horizontal scroll with
fading-edge masks + focusin auto-scroll, LTR-only) and `<TruncatedLabel>`
(truncate + min-w-0 + opt-in native title + forwardRef for Radix
TooltipTrigger asChild), and refactors PR badges, the chat session bar,
status bar, selector breadcrumb, tag filter row, context section title,
project group names, task card header, schedule pill, context file
items, the title bar, the skills panel, and the flat session row
actions column to use them.

Title bar layout was rewritten to a `[1fr_auto_1fr]` grid so the project
name, centered search box, and launch picker can each truncate
independently without overlapping at narrow widths.

FlatSessionRow's time column was collapsed to one line and the hover
actions now overlay absolutely so the actions slot doesn't reserve
width when not hovered.

Composer bottom row now wraps so Send/Stop stays inside the card at
narrow widths. The deeper popover-portal port (so dropdown menus can
live inside a `ScrollRow` without clipping) is still tracked as a
follow-up.

Fixes #182.
