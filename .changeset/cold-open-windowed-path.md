---
"@qlan-ro/mainframe-app-tauri": patch
---

Opening a chat the daemon has not cached (the first open after a start, an update or a turn it never saw) now shows the newest turns from the end of the transcript, or from Codex's turn pages, instead of reading the whole history first. The rest of the history still loads right after.
