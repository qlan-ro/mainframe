---
'@qlan-ro/mainframe-app-tauri': patch
---

Codex's Default permission mode now asks before every edit and every command, matching what "Interactive" already promises in the permission menu. It used to edit files and run commands without asking, just like Accept Edits. Existing Codex chats left in Default mode will start seeing approval prompts; pick Accept Edits for the old auto-edit behavior. This also lets a Claude chat in Default mode delegate to a Codex chat, since both now carry the same real privilege.
