---
'@qlan-ro/mainframe-ui': patch
---

Always show the branch chip in the titlebar, for main-repo sessions too.

The toolbar branch chip used to render only for worktree sessions, because it derived its label from the persisted `chat.branchName`, which is set only when a session runs in a worktree. It now reads the live current branch from git on mount, so a session on the shared main repo shows and can switch its branch as well. Matching the Workspace Surfaces artboard, a worktree session gets an accent-tinted chip with a fork glyph and a "WT" badge, while a main-repo session stays neutral; the tooltip names which.
