---
'@qlan-ro/mainframe-ui': patch
---

Fixed three editor/overlay bugs found during e2e verification: Markdown Preview now reflects live Source edits instead of the stale loaded value, the diff editor's chunk navigation scrolls the correct container instead of a redundant outer wrapper, and pressing Escape while editing the directory-picker path crumb reverts the draft in place instead of always closing the whole dialog.
