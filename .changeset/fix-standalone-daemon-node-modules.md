---
"@qlan-ro/mainframe-core": patch
---

Fix the standalone daemon tarball (the `linux`/`darwin` release artifacts installed
via `scripts/install.sh`) so it ships a complete `node_modules` sibling to
`daemon.cjs`. Previously `build-standalone.sh` only copied better-sqlite3's raw
`.node` binary, so the bundled daemon's `require('better-sqlite3')` (and the LSP
servers + ripgrep) could not resolve and the daemon failed to start with
`Cannot find module 'better-sqlite3'`. The standalone build now uses the same
dependency collector as the Tauri sidecar bundler.
