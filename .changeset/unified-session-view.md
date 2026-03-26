---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-desktop": minor
---

feat: unified session view — remove project selector, show all sessions grouped by project

Replace the project selector dropdown with a unified sidebar showing all sessions
across all projects in collapsible groups. The active project is derived from the
selected session. Worktree projects are auto-detected and linked to their parent
repository via `git worktree list`.
