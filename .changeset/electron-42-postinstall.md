---
'@qlan-ro/mainframe-desktop': patch
---

Restore Electron binary download on clean install. Electron 42 removed its `postinstall` script, so `pnpm install --frozen-lockfile` no longer fetched `Electron.app`. A root `postinstall` now invokes Electron's own (idempotent) `install.js`.
