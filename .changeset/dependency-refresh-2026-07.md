---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-app-electron': patch
---

Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet), better-sqlite3 13 / nanoid 6 / jest-dom 7 (all drop Node 20, which CI still runs), and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).
