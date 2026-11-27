---
"@qlan-ro/mainframe-app-tauri": patch
---

Reopen recently used chats faster after a restart: the daemon now refreshes a chat's saved history shortly after each turn and at shutdown, keeps plan and skill results with it, and caches Codex chats whose sub-agent transcripts are compressed.
