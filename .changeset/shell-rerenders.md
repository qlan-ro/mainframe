---
'@qlan-ro/mainframe-ui': patch
---

The app shell does less work while a chat streams. The title bar, rail, sidebar and dialog hosts no longer re-render on every streamed chunk or background chat update. A chat whose only change is cost or tokens no longer re-renders the session list. In compact mode, a streamed chunk now re-renders only the turn being written instead of every message above it.
