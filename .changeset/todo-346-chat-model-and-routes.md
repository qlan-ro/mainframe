---
'@qlan-ro/mainframe-app-tauri': minor
'@qlan-ro/mainframe-ui': minor
---

Chats can now be created without a project (a hidden scratch project owns their per-chat scratch cwd under the data dir) or marked temporary at creation (excluded from default listings, refuses pin/tag/archive/unarchive, and removed only by an explicit discard or by removing its project). `Chat` gains `temporary`, `noProject` and `contextLostAt`; `POST /api/chats` accepts `noProject` and `temporary`, and a new `POST /api/chats/{id}/discard` removes a temporary chat and its scratch directory.
