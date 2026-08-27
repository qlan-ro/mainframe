---
'@qlan-ro/mainframe-ui': minor
---

Replace the sidebar's inline Projects list with a multi-select project scope dropdown. Any number of projects can be checked (empty = all); the trigger shows the scope, the attention hidden by it, and a hover ✕ that clears it. Selecting a project no longer switches the active session. The single-project filter persisted in `mf:filterProjectId` migrates to the new `mf:filterProjectIds` set automatically.
