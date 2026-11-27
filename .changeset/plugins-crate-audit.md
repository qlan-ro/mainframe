---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix tasks GitHub sync getting stuck as "already running" after a sync request was interrupted. A repository link deleted during a sync no longer comes back when the sync ends. Creating or importing a task can no longer leave a half-written task behind. Task attachments record their real size.
