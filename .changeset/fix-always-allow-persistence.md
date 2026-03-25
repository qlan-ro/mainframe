---
'@qlan-ro/mainframe-core': patch
---

fix(core): persist "Always Allow" permissions to settings.local.json

The CLI's permission_suggestions always use destination:"session" (in-memory only).
When users clicked "Always Allow" in Mainframe, the permission was lost after the
session ended. Now we promote session-scoped suggestions to localSettings, matching
the terminal CLI's behavior.
