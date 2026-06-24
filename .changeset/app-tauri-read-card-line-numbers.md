---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix duplicated line numbers in the expanded Read tool card. The Read result is
already `cat -n` formatted (each line carries its own line number), but the card
also rendered a synthesized gutter, so every line showed its number twice. The
card now drops its gutter and renders the Read output verbatim.
