---
"@qlan-ro/mainframe-app-tauri": patch
"@qlan-ro/mainframe-types": patch
---

Open a sub-agent tab faster: it fetches only its own tool call and its steps instead of paging the parent conversation back to it, and restoring a sub-agent tab on reload no longer loads parent history. The history request can now return an item's descendants.
