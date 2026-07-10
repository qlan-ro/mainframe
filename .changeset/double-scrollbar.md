---
"@qlan-ro/mainframe-ui": patch
---

Fix the double vertical scrollbar on chat tool cards: Bash, Read, Edit, Write, Plan, Search, Skill, and Schedule cards no longer nest their own `overflow-y-auto` region inside the thread viewport, so only the thread scrolls vertically while wide code and terminal lines still scroll horizontally.
