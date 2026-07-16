---
'@qlan-ro/mainframe-ui': patch
---

Overhaul the left sidebar's visual density and information architecture: unified per-level indentation across Projects/Sessions/Tasks/Tags (matching macOS outline conventions, full-width selection highlights on indented rows), all four root sections now independently collapsible and persisted, Context/Skills/Agents moved into the right inspector while Tasks moved into the left sidebar as its own section (per HIG, contextual detail vs. navigable collections), colored tag pills replacing neutral chips with color dots, a redesigned daemon selector card matching the mobile app's pattern, and numerous row-height/padding/font/scroll-behavior fixes throughout.

The Tasks section now shows at most five tasks with a "View all N tasks" row, and sits in the bottom cluster below the flexible spacer. Project rows reserve full-strength foreground for the unread signal instead of using it at rest, matching the session-row convention.

The sessions list no longer reserves layout width for a scrollbar that is invisible at rest. A global `scrollbar-width: thin` made WebKit render a classic, space-reserving bar, shrinking every row by 13px to line a gutter whose thumb is transparent until hover; the list now uses a Radix ScrollArea, whose absolutely-positioned thumb overlays the rows at no layout cost.

Fixes a latent bug in the shared `ScrollArea`: its `[&>div]:!block` rule used Tailwind v3's important-prefix syntax, which compiles to nothing under Tailwind v4, so the rule had never taken effect. Radix's `display: table` viewport wrapper now gets a viewport-bounded width as intended, restoring `truncate` on flex rows in every ScrollArea.
