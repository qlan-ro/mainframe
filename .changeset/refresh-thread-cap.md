---
'@qlan-ro/mainframe-app-tauri': patch
---

The turn-end history refresh now parses with at most 2 workers, so a chat opened right after a turn ends no longer finds the shared parse budget spent and reads serially.
