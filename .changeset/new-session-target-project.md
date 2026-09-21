---
'@qlan-ro/mainframe-ui': patch
---

Clicking "+" (sidebar button, sidebar New Thread row, session-tab strip, ⌘N) now opens the new draft already scoped to the active project filter, or failing that the project of the session you were on — no more landing on "Choose a project" when it's obvious where the session belongs. The welcome screen's own project picker, when it does show, now lists projects most-recently-active first, matching the sessions sidebar's ordering.

A new draft also opens with only the chat surface — it no longer inherits the Workspace panel arrangement from the session you were on, and no longer overwrites that session's remembered layout while you're composing. Opening a Workspace on the draft and then sending the first message now hands that arrangement off to the resulting chat instead of losing it.
