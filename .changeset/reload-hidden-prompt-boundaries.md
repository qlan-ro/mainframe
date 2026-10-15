---
'@qlan-ro/mainframe-app-tauri': patch
---

Reloaded Claude chats keep each reply to a hidden prompt, such as a background-task notification, on its own line instead of running it into the previous reply. Codex history likewise keeps replies from different turns apart when no user message separates them.
