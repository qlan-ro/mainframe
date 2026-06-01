---
'@qlan-ro/mainframe-core': patch
---

Collapse project deletion into one transactional cascade. `remove(id)` now detaches child projects (`parent_project_id` → NULL), deletes child chats, and deletes the project atomically in a single transaction, replacing the bare `remove`/`removeWithChats` pair that could orphan chats or fail under `foreign_keys = ON`. Also prune the background-task tracker's per-chat maps when a chat ends, is archived, or its project is removed, fixing an unbounded memory leak.
