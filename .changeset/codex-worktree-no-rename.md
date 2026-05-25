---
'@qlan-ro/mainframe-core': patch
---

Fix ENOENT when creating a worktree from a running Codex session. `enableWorktree`/`attachWorktree` now skip the Claude-specific session file rename for non-Claude adapters; Codex resumes by `threadId + cwd` and doesn't need files relocated.
