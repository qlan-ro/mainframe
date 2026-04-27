---
'@qlan-ro/mainframe-desktop': patch
---

Fix sidebar project filter drifting out of sync with the open chat. When the active chat changes (search palette, toast click, tab switch, daemon-driven activation, runtime thread switch), the filter is now cleared if the new chat lives in a different project, so the badge no longer points at a project the user is not viewing.
