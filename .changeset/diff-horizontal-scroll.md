---
'@qlan-ro/mainframe-ui': patch
---

Fix diff chunk navigation (next/prev change) leaving the changed text horizontally clipped in its pane — the scroll target now spans the chunk's full range instead of just its first column, so CodeMirror scrolls both axes into view.
