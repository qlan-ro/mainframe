---
'@qlan-ro/mainframe-ui': patch
---

The sessions list no longer reserves layout width for a scrollbar that is invisible at rest. A global `scrollbar-width: thin` made WebKit render a classic, space-reserving bar, shrinking every row by 13px to line a gutter whose thumb is transparent until hover; the list now uses a Radix ScrollArea, whose absolutely-positioned thumb overlays the rows at no layout cost.

Fixes a latent bug in the shared `ScrollArea`: its `[&>div]:!block` rule used Tailwind v3's important-prefix syntax, which compiles to nothing under Tailwind v4, so the rule had never taken effect. Radix's `display: table` viewport wrapper now gets a viewport-bounded width as intended, restoring `truncate` on flex rows in every ScrollArea.

The Tasks section now shows at most five tasks with a "View all N tasks" row, and sits in the bottom cluster below the flexible spacer. Project rows reserve full-strength foreground for the unread signal instead of using it at rest, matching the session-row convention.
