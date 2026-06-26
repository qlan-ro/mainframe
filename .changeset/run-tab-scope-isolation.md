---
"@qlan-ro/mainframe-ui": patch
---

Scope Run-surface tabs to the active session so they no longer leak across
projects/worktrees. Every run tab — launch configs, terminals, and Files guests
— is now stamped with the active session's launch scope (`projectId:effectivePath`),
and the Run surface renders only the tabs matching the active session's scope. The
launch-config singleton dedup and the already-running reconcile are now scope-aware,
so a config sharing a name across two projects (e.g. "dev") gets its own tab in each
instead of hijacking the other's.
