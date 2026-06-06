---
"@qlan-ro/mainframe-app-tauri": patch
---

Make optimistic-message reconciliation robust against lingering duplicates. The
pending↔echo match used a 2-minute window and matched one pending per server
message, so a wedged/slow run (echo delayed past the window) or a double-fired send
stranded an optimistic copy next to the real server message. The live match window
is now 10 minutes, and history re-seed reconciliation is authoritative — it clears
every pending whose text the server history already contains, with no time window.
