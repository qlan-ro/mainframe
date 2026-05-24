---
'@qlan-ro/mainframe-desktop': patch
---

Revert Electron to ^41.0.3. The dependency bump in #330 raised Electron
to ^42.1.0, but better-sqlite3@12.10.0 (the latest published version)
cannot compile against Electron 42's V8: `v8::External::New` now requires
a third `ExternalPointerTypeTag` argument. `electron-builder` rebuilds
better-sqlite3 from source during macOS packaging, so the release
workflow would fail. CI never caught this because `ci.yml` does not run
`electron-builder` packaging — only the release workflow does, and no
release has shipped since #330. Pinning back to Electron 41 (the version
v0.18.2 shipped green with) unblocks releases until better-sqlite3 ships
an Electron-42-compatible build.
