---
'@qlan-ro/mainframe-desktop': patch
---

fix(sessions): renaming a session no longer exits editor mode when a new message arrives (#185). The rename input now survives the list re-sort that follows an `updatedAt` bump, commits on outside pointerdown instead of blur, and is no longer nested inside a `<button>` (invalid HTML).
