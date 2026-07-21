---
'@qlan-ro/mainframe-ui': patch
---

Fix picking a project in the "All projects" view doing nothing. The picker read the draft thread's id before anything had created one — assistant-ui only mints that id inside `switchToNewThread`, and clears it again every time a draft is committed on first send — so the handler hit its null guard and returned silently. It now creates the draft first and seeds it afterwards.

A new session started from the picker also honors the configured default adapter, matching the path taken when a project is already selected; it previously always started on Claude.
