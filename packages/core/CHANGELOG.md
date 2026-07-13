# @qlan-ro/mainframe-core

## 2.0.0-rc.7

### Minor Changes

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.

### Patch Changes

- [#455](https://github.com/qlan-ro/mainframe/pull/455) [`09debb6`](https://github.com/qlan-ro/mainframe/commit/09debb6ee884b41836c8e06b40859c3a08b126c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions failing to start when a configured MCP server needs authentication.

  The codex binary writes tracing logs to stderr as normal operation, and the adapter escalated
  every stderr line to a fatal run error. An unauthenticated remote MCP server makes codex log an
  `rmcp` ERROR on every startup, so each Codex session died instantly with "Agent run failed"
  while the underlying run was healthy.

  stderr is now treated as a log stream. Real failures still surface: an unexpected non-zero exit
  reports its code along with the tail of recent stderr, so genuine startup crashes keep their
  diagnostics.

- Updated dependencies [[`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.7
