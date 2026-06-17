---
"@qlan-ro/mainframe-app-tauri": patch
---

Correct spacing on the parity surfaces for the app's compressed integer spacing
scale (integer `p-N` is half standard Tailwind here, e.g. `p-2`=4px, `p-4`=8px):
settings sidebar padding (8px), About header/row gaps (24/16px), task column
header bottom + card-area padding (8/12px), and the task-list + palette footer
kbd-pair gaps (16px). Caught by live `getComputedStyle` probes.
