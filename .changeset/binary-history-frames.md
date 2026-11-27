---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-types": patch
---

Load large sub-agent and older history pages faster: the daemon sends them as binary WebSocket frames that the app inflates natively, and updates are validated by tag.
