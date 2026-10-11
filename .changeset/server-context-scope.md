---
'@qlan-ro/mainframe-app-tauri': patch
---

Return not-found responses for missing chat/project inputs and deleted chat worktrees. Report plugin storage failures instead of returning empty or unpersisted results.

Preserve workflow history and Run panel controls after a worktree is deleted. Deleting a worktree now stops its launch processes and preview tunnels.
