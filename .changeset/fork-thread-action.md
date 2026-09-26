---
'@qlan-ro/mainframe-ui': minor
---

Add a Fork action to the sidebar row's and session tab's context menus. Forking branches a chat's conversation into a new chat that opens as the active session, nested under its parent in the sidebar. The item is disabled with a reason (adapter can't fork, no provider session yet, missing transcript or folder, or a turn in flight) when forking isn't currently possible.
