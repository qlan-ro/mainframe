---
'@qlan-ro/mainframe-app-tauri': patch
---

PR 3 of the Rust-daemon cutover: the Tauri shell now boots the Rust `mainframe-daemon` by default. `MAINFRAME_DAEMON_IMPL=node` (or a persisted `daemonImpl: "node"` app setting) still selects the legacy Node sidecar as a rollback path until it's retired in PR 4 — this PR only flips the unset default from Node to Rust.
