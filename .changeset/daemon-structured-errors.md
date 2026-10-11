---
'@qlan-ro/mainframe-app-tauri': patch
---

Daemon errors now answer with the right HTTP status: a missing chat or project is a 404 instead of a 400 or 500, a refused request such as deleting the hidden scratch project or an invalid attachment chat id is a 400, a busy chat is a 409, and internal failures while moving a chat into a worktree (transcript move, adapter, disk) are 500s instead of 400s. Unexpected storage failures no longer leak database text in tag responses. Error messages are unchanged.
