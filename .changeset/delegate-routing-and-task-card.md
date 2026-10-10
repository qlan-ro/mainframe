---
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-ui': patch
---

Asking an agent to "spawn a Codex agent" or "ask Claude to" do something now starts a Mainframe task you can see, instead of a Claude Code plugin's hidden subagent. Delegated task results and other messages from agents now show as full-width cards on the left, like assistant replies, not on the right like your own messages. Their headers show the chat's title instead of a raw chat id. A delegated task's "Delegated by" link no longer reads "Untitled session" for a parent chat started in the same app session.
