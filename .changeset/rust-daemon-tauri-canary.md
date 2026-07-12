---
'@qlan-ro/mainframe-app-tauri': patch
---

Tauri shell gains the `MAINFRAME_DAEMON_IMPL` canary flag: `rust` spawns the ported Rust daemon as an externalBin sidecar (with login-shell PATH, bundled-LSP env, identical supervision); `node` (default) keeps the existing Node sidecar untouched. The Rust binary is opt-in at build time — default `bundle`/`tauri:build` stays Node-only, and `bundle:canary`/`tauri:build:canary` (via the `tauri.rust-canary.conf.json` overlay) produces the dual-daemon build. See `docs/rust-port/CUTOVER.md` for the signing/notarization gate before shipping the canary publicly.
