---
"@qlan-ro/mainframe-types": major
"@qlan-ro/mainframe-core": major
"@qlan-ro/mainframe-ui": major
"@qlan-ro/mainframe-app-tauri": major
---

Mainframe 2.0 — Tauri desktop shell.

Ships the Tauri 2 desktop app (`@qlan-ro/mainframe-app-tauri`) alongside the
existing Electron shell. The React renderer moves into a shared
`@qlan-ro/mainframe-ui` package consumed by both shells, the daemon ships as a
bundled Node sidecar, and the UI is rebuilt on assistant-ui + shadcn/ui. Also
includes the workflows engine, remote-daemon support, and a browser-mode
Playwright e2e suite.
