---
'@qlan-ro/mainframe-app-tauri': patch
---

Codex's Default permission mode no longer asks before every command. Reads and searches now run without a prompt inside a read-only sandbox, while edits, commands that write, and network access still ask first. Before, Default asked about almost every command and "Accept for session" rarely stuck, because it only remembers that exact command. Delegated tasks also inherit the parent chat's permission mode unless the agent deliberately picks a stricter one, so a task started from an Unattended chat no longer floods you with approval prompts.
