---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-ui': minor
---

Hide automation-created chats from the default sessions list. `ask_agent` steps now stamp the new chat with `automationRunId`, and the daemon excludes those chats from the default `/api/chats` list — they remain reachable directly (e.g. "Open agent chat" from a workflow run).
