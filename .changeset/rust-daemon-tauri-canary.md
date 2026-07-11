---
'@qlan-ro/mainframe-app-tauri': patch
---

Tauri shell gains the `MAINFRAME_DAEMON_IMPL` canary flag: `rust` spawns the ported Rust daemon as an externalBin sidecar (with login-shell PATH, bundled-LSP env, identical supervision); `node` (default) keeps the existing Node sidecar untouched.
