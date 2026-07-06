---
'@qlan-ro/mainframe-app-tauri': patch
---

Codesign the bundled daemon's nested native binaries (better-sqlite3, fsevents, node-pty, ripgrep, the provisioned Node runtime) during `bundle-daemon`, fixing macOS notarization rejections caused by unsigned Mach-O addons inside the sidecar.
