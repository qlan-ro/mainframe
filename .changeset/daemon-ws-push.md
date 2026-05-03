---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Push tunnel status and file changes over WebSocket so the renderer reacts in real-time without polling or reopening settings. The RemoteAccessSection now updates immediately when a tunnel becomes DNS-verified, and the editor auto-reloads (or shows a "File changed on disk" banner with dirty state) when an agent modifies an open file.
