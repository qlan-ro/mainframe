---
---

Release/CI only: retire the Electron shell (`@qlan-ro/mainframe-app-electron`) —
the Rust daemon cutover leaves it as the last consumer of the Node sidecar
tooling this stack replaces. Deletes the package, its `node-gyp`/Electron-cache
CI steps, and the `--electron`/stale `--canary` legs of the local release-build
script; `release.yml` now produces two artifact families (the Tauri app, Rust
daemon inside, and standalone `mainframe-daemon` tarballs) instead of three.
No package changelog.
