---
'@qlan-ro/mainframe-types': patch
---

Codex-backed chats now report context-window usage: the rail ring and Summary row populate the same way they do for Claude chats, instead of staying empty for the life of the session.

Also fixed: recorded context totals now survive a daemon restart instead of regressing to a coarser estimate on reload.
