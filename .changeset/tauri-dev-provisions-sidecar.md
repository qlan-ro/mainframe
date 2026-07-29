---
'@qlan-ro/mainframe-app-tauri': patch
---

`pnpm tauri:dev` now provisions the daemon sidecar when it is missing, so a checkout that has never built one starts instead of failing in `build.rs` with an unexplained missing-resource panic.
