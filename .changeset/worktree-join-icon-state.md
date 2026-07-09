---
"@qlan-ro/mainframe-ui": patch
---

Fix the worktree chip icons staying stale after joining or creating a worktree: the composer config mirror now adopts chat updates that change only worktreePath/branchName, and the shell identity (titlebar branch chip, chat header, branch popover) re-derives custom from the remoteId-keyed thread entry so sessions created in the current app run update too.
