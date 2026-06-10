---
'@qlan-ro/mainframe-app-tauri': patch
---

Archiving the active session now falls back to the most recently used session (desktop parity) instead of the first thread in list order. With a project filter active, the fallback stays within the filtered project; it widens to all sessions only when that project has none left.
