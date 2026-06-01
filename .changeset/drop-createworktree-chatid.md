---
'@qlan-ro/mainframe-core': patch
---

Remove the unused `chatId` parameter from `createWorktree`. The argument was never read by the function body; callers in `config-manager` and the worktree tests are updated to the four-argument signature.
