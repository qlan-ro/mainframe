---
'@qlan-ro/mainframe-desktop': patch
---

fix(desktop): always render `FolderGit` icon for the composer worktree button

The button previously swapped between `FolderGit` (when a worktree path
existed) and `GitBranch` (when it didn't), which made the affordance read
as two different actions. The button is the same control either way, so
the icon is now `FolderGit` in both states.
