---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': patch
---

feat: support enabling and attaching worktrees mid-session

When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.
