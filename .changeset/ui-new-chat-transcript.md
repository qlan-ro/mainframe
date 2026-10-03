---
'@qlan-ro/mainframe-ui': patch
---

Fix new chats showing no transcript at all. A session resume that read the display snapshot before the chat's first prompt seeded the incremental display projector with empty history; every message appended afterward was then silently skipped instead of being folded into the chat, so the daemon never sent any transcript items.
