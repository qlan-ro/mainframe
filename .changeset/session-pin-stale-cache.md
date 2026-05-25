---
'@qlan-ro/mainframe-core': patch
---

Fix sessions silently unpinning themselves after navigating away and back. `PATCH /api/chats/:id/pinned` updated SQLite but left the in-memory cached chat (`activeChats[id].chat.pinned`) stale; the next `resumeChat` broadcast `chat.updated` with the old `pinned: false` and clobbered the renderer. Same hole existed for `PATCH /api/chats/:id/effort`. Added `ChatManager.syncChatFields(chatId, partial)` and call it from both routes after the DB write, mirroring the existing `syncChatTags` pattern.
