---
"@qlan-ro/mainframe-ui": patch
---

Fixed the first-run tutorial popover clipping off the right edge of the
viewport on step 4 ("Open the workspace"), whose anchor sits near the right
edge of the toolbar. The label card's horizontal position is now clamped
against both viewport edges, not just the left.
