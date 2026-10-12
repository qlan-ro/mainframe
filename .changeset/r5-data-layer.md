---
'@qlan-ro/mainframe-app-tauri': patch
---

Creating or forking a chat, opening a side chat and deleting a todo now either complete fully or leave nothing behind. Todo attachment ids must be a single safe file name, and a damaged value stored in a chat, todo or tag column is logged and shown with a safe default instead of failing the whole list; todo statuses, types and priorities written by other tools are kept as they are.
