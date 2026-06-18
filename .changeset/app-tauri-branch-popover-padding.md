---
"@qlan-ro/mainframe-app-tauri": patch
---

Restore the 5px inner padding on the branch popover (it was `p-0`, so rows butted
against the border and the "Update all" row's trailing glyph sat ~5px from the edge,
and rounded row-hovers touched the corner). Matches the prototype's padded popover.
