---
"@qlan-ro/mainframe-core": patch
---

Recover orphaned `processState: 'working'` on daemon boot. No in-memory CLI sessions
survive a restart, so a chat left `'working'` by the previous shutdown/crash would
look "running" to clients — new messages then queue forever ("sends after the current
run") with no run to finish. `ChatManager.recoverStaleWorkingState()` (called from the
daemon entry point at startup) resets all `'working'` chats to `'idle'`.
