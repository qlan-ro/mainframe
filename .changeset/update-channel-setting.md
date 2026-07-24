---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-app-tauri': minor
---

Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.
