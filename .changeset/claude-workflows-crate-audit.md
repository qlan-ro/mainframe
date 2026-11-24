---
"@qlan-ro/mainframe-app-tauri": patch
---

Free a chat's Claude workflow run details from daemon memory when the chat or its project is deleted, instead of keeping them until the daemon restarts.
