---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-ui': minor
---

Automations: add a read-only details view (Overview/Runs tabs, reached by clicking a library row) and make project scoping real. Automations now save non-configurably to the session's active project — the scope toggle is gone, the library filters to it, and Agent steps inherit it automatically with a real branch picker for their worktree's base branch. Also: removed the non-functional per-tool auto-approve chips (permission mode already covers this), added a short inline explanation for the agent step's "Result" token, and replaced the hardcoded model list with the live provider/model catalog.
