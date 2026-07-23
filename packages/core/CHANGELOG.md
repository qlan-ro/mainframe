# @qlan-ro/mainframe-core

## 2.0.0-rc.12

### Patch Changes

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).

- Updated dependencies [[`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.12
