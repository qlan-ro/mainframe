---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the janky sidebar drag-to-collapse on the floating window styles. The main
pane slides over the sidebar to collapse it, but `pane` was `bg-transparent`, so
the (transparent) toolbar strip let the sidebar header icons show through during
the drag. Make the pane opaque with `bg-mf-window` — the same colour it already
showed through transparency, so the resting appearance is unchanged — giving a
solid cover while dragging.
