---
'@qlan-ro/mainframe-ui': patch
---

Fix a Claude chat showing "Transcript deleted" after its agent called `EnterWorktree` or `ExitWorktree`. The CLI moves the session transcript into the new working directory's project folder, but the daemon only looked at the stored path and the path derived from the chat's own directory. It now also searches the other Claude project folders for the session, saves the path it finds, and re-checks the location right after either worktree tool completes, so the banner no longer appears and history, tool-output lookups and resume keep working.
