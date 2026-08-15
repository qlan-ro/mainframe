---
'@qlan-ro/mainframe-ui': patch
---

Fix background-task output never loading. The daemon derived the Claude
CLI's spool directory from a uid it never read, so it looked for task output
in `/tmp/claude-0` — a directory that does not exist for a normal user — and
the output request failed as an invalid path. The same wrong directory meant
tasks were not recovered after a daemon restart, shells writing into a
removed worktree were never signalled, and live bash tasks were falsely
reported as stopped. The daemon now reads its real uid.
