---
"@qlan-ro/mainframe-core": patch
---

Fix `ChatManager.renameChat` to emit a `chat.updated` event, matching
`unarchiveChat`. Previously a REST-based rename was invisible to connected
clients until they reloaded.
