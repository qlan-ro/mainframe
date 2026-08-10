---
'@qlan-ro/mainframe-ui': patch
---

Session tabs now restore against the settled thread list, so a reload no longer drops every tab but the active one, and a failed or empty list no longer overwrites the persisted set.
