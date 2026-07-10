---
'@qlan-ro/mainframe-ui': patch
---

Reflect a new session's worktree and branch choice before the first message is sent.

A new-session draft has no daemon chat yet, so the titlebar branch chip, worktree popover, and file tree used to fall back to the project root while you composed — hiding the branch you picked. The active identity now resolves from the seeded draft config, so those surfaces show the chosen branch and worktree pre-send, and the choice carries into chat creation on first send: an existing worktree attaches with the new chat, and a new worktree is created before the CLI spawns.
