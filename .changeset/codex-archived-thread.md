---
"@qlan-ro/mainframe-app-tauri": patch
---

If a message can't start a turn, the chat no longer stays stuck as working. The message shows as failed, with the actual reason and a Retry option. When the cause is a Codex thread that was archived in Codex, the failed message also has an Unarchive button: it unarchives the thread and sends the message again, so you don't need to open the Codex app.
