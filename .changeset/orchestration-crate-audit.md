---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix delegated tasks and agent messages. A message to a chat whose CLI can't start is kept for its next turn instead of being retried in an endless loop. A delegation or delivery no longer stops halfway when the calling agent disconnects or cancels. Results dropped by a Stop stay dropped after a restart, and a database error no longer drops a result or ends a task. A stopped task is reported as interrupted even when its parent is waiting on it, and a task cancelled while it starts stays cancelled. Stopping an idle chat no longer blocks its agent's tools for the next turn.
