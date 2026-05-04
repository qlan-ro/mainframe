---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Push tunnel status and file changes over WebSocket so the renderer reacts in real-time without polling or reopening settings. The RemoteAccessSection now updates immediately when a tunnel becomes DNS-verified, and the editor auto-reloads (or shows a "File changed on disk" banner with dirty state) when an agent modifies an open file.

Also fix a long-standing bug where files opened from Edit/Write tool cards (which use absolute worktree paths) skipped `context.updated` subscriptions entirely — the editor and diff views now classify "external" by checking against known project/worktree bases instead of by the path's leading slash, so agent edits inside a worktree refresh open editors regardless of how the file was opened.
