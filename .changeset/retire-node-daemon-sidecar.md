---
'@qlan-ro/mainframe-app-tauri': minor
---

Retire the Node.js daemon sidecar from the Tauri shell. `externalBin` now ships only the Rust `mainframe-daemon` binary (packages/core-rs); the bundled Node runtime, `daemon.cjs` resource bundle, and the `MAINFRAME_DAEMON_IMPL` canary flag are gone. Packaged builds are smaller and no longer carry a second copy of `better-sqlite3`/`node-pty`/LSP servers alongside the app.
