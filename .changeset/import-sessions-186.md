---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
'@qlan-ro/mainframe-types': patch
---

Import External Sessions: surface sessions from deleted worktrees and project subdirectories by scanning every encoded `~/.claude/projects/` directory whose prefix matches the project, then filtering by the session's own `cwd`. Drop the `new Date()` timestamp fallback that silently labelled missing-timestamp sessions as "Today"; use the JSONL file's `stat().mtime` as the always-real anchor. The popover now also displays the worktree (or subdirectory) the session ran in, and the relative-time formatter uses a single millisecond basis so "Yesterday" never appears before "Today" anymore.
