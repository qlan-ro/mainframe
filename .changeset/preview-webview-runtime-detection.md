---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-app-tauri': patch
---

Previewing a Mainframe dev server no longer hangs on "Connecting to the daemon". The nested app was mistaking the preview webview for the host app.
