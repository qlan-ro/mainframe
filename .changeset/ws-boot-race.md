---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
---

Keep live file-watching reliable and stop a spurious boot-time CSP error. The editor now re-subscribes its file watches on every WebSocket reconnect and the daemon re-arms watchers after inode-replacing (atomic) saves, so external edits keep reaching the open editor and the disk-conflict banner now also shows for markdown files. The client no longer opens a doomed `ws://127.0.0.1:0` connection before the daemon target is seeded.
