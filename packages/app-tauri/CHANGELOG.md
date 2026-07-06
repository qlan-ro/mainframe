# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.0

### Major Changes

- [#398](https://github.com/qlan-ro/mainframe/pull/398) [`17a2630`](https://github.com/qlan-ro/mainframe/commit/17a26309dd9369ac6a381642a5377cb0a81ad77e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Mainframe 2.0 — Tauri desktop shell.

  Ships the Tauri 2 desktop app (`@qlan-ro/mainframe-app-tauri`) alongside the
  existing Electron shell. The React renderer moves into a shared
  `@qlan-ro/mainframe-ui` package consumed by both shells, the daemon ships as a
  bundled Node sidecar, and the UI is rebuilt on assistant-ui + shadcn/ui. Also
  includes the workflows engine, remote-daemon support, and a browser-mode
  Playwright e2e suite.

### Patch Changes

- Updated dependencies [[`17a2630`](https://github.com/qlan-ro/mainframe/commit/17a26309dd9369ac6a381642a5377cb0a81ad77e)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.0
