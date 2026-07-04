---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
---

Task progress cards keep task names across turns: the daemon backfills TaskUpdate subjects from earlier TaskCreates, and the card reads real task ids from tool results instead of positional fallbacks.
