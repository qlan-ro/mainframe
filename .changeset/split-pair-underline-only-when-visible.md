---
'@qlan-ro/mainframe-ui': patch
---

Light the split pair's shared tab underline only while the split is on screen.

A split groups two session tabs under one container in the title-bar strip, and that container drew its 2px underline unconditionally. Because a pair stays open while parked behind a third session, the strip could show three tabs wearing the selected underline at once — the pair's plus the focused tab's — leaving no way to tell which session you were actually looking at. The underline now lights on exactly the terms a lone tab's does: a member of the pair is the focused session. The container's faint tint is dropped with it, so grouping reads from the two tabs sitting adjacent rather than from a mark that outlives the split it describes.
