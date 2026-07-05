---
'@qlan-ro/mainframe-ui': patch
---

Fix sessions sidebar bugs: right-click "Tags" now defers past Radix's context-menu close so the popover actually opens; the tag registry is now a single shared cache so recoloring a tag repaints every row's tag dot live; the draft row's discard-on-navigate-away effect no longer wipes a just-created draft mid pill-active "New" handoff.
