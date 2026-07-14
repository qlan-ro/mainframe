---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Add a global "Default provider" setting (Settings → Providers) that picks which adapter seeds new chats, replacing the hardcoded Claude default. Also fix the top-level "Providers" nav item showing a blank pane until a specific provider was picked underneath it — it now auto-selects the first installed adapter.
