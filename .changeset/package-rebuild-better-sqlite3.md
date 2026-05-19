---
'@qlan-ro/mainframe-desktop': patch
---

Rebuild `better-sqlite3` against Electron's ABI when packaging. The `package` script only ran `electron-rebuild -o node-pty`, so the bundled `better-sqlite3` kept its Node-ABI prebuild and the packaged app crashed on launch with `NODE_MODULE_VERSION 137 ... requires 145`. It is now rebuilt with the module dir pointed at `@qlan-ro/mainframe-core` (where it is a declared dependency, since pnpm hoists it out of the desktop package) and `-f` to bypass a stale `.forge-meta` cache that was silently skipping the build.
