---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.
