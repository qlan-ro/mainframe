---
"@qlan-ro/mainframe-ui": patch
---

Fix the toolbar launch picker to always reflect the active session's project.
The selected launch config is now keyed per launch scope (`projectId:effectivePath`,
mirroring process statuses) so it no longer bleeds across session/project switches,
and the picker derives its effective selection from the active project's configs —
defaulting to the first real config instead of a hard-coded "Preview" label. When a
project has no launch configurations the picker shows "No Launch Configurations" with
the run button disabled.
