---
'@qlan-ro/mainframe-ui': patch
---

Fix losing a text selection in a streaming reply: the selected part now holds the text shown on screen, keeps it through the end of the turn, and continues forward instead of retyping when released.
