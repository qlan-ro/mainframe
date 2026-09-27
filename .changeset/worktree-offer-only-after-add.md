---
'@qlan-ro/mainframe-ui': patch
---

Stop the "switch to worktree" offer from showing a chat worktrees that other sessions created. The daemon rescanned git's worktree list after any shell command that mentioned "worktree" (including `git worktree list` or a `cd` into a worktree) and offered every worktree that was new since the chat's last scan. It now rescans only after `EnterWorktree` or a command that runs `git worktree add`.
