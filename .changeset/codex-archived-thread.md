---
"@qlan-ro/mainframe-app-tauri": patch
---

If a message can't start a turn, the chat no longer stays stuck as working. One example is a Codex chat whose thread was archived in Codex. The message shows as failed with a Retry option instead. For an archived Codex thread, the error says the thread is archived in Codex and needs to be unarchived there before you send again.
