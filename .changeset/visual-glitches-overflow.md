---
'@qlan-ro/mainframe-desktop': minor
---

fix: handle width-overflow across chat/status/panel rows

Adds two shared UI primitives, `<ScrollRow>` (horizontal scroll with
fading-edge masks + focusin auto-scroll, LTR-only) and `<TruncatedLabel>`
(truncate + min-w-0 + opt-in native title + forwardRef for Radix
TooltipTrigger asChild), and refactors PR badges, the chat session bar,
status bar, selector breadcrumb, tag filter row, context section title,
project group names, task card header, schedule pill, and context file
items to use them. Fixes #182.

Composer dropdown cluster is deferred — every dropdown there mounts an
inline popover that would be clipped by overflow-x; the correct fix is
to port the popovers to portal-based mounting, tracked as a follow-up.
