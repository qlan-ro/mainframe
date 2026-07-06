# @qlan-ro/mainframe-core

## 2.0.0-rc.1

### Minor Changes

- [#405](https://github.com/qlan-ro/mainframe/pull/405) [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename the daemon CLI to `mainframe` and add a `mainframe update` command.

  The standalone binary is now `mainframe` (the old `mainframe-daemon` name still
  ships as an alias, so existing systemd units keep working). `mainframe update`
  upgrades a standalone install in place: it downloads the matching release tarball
  for the host platform and unpacks it over `~/.mainframe/bin`. Supports
  `--pre` (include pre-releases), `--version <tag>`, and `--dir <path>`; the daemon
  keeps serving until you restart it.

### Patch Changes

- [#405](https://github.com/qlan-ro/mainframe/pull/405) [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the standalone daemon tarball (the `linux`/`darwin` release artifacts installed
  via `scripts/install.sh`) so it ships a complete `node_modules` sibling to
  `daemon.cjs`. Previously `build-standalone.sh` only copied better-sqlite3's raw
  `.node` binary, so the bundled daemon's `require('better-sqlite3')` (and the LSP
  servers + ripgrep) could not resolve and the daemon failed to start with
  `Cannot find module 'better-sqlite3'`. The standalone build now uses the same
  dependency collector as the Tauri sidecar bundler.
- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.1

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
  - @qlan-ro/mainframe-types@2.0.0-rc.0
