# @qlan-ro/mainframe-core

## 2.0.0-rc.3

### Patch Changes

- [#411](https://github.com/qlan-ro/mainframe/pull/411) [`f3754e6`](https://github.com/qlan-ro/mainframe/commit/f3754e69e123930d4ec78604f6332632e81117f0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the packaged Tauri app hanging on "waiting for daemon". The daemon's CORS
  allowlist only accepted `http(s)://localhost|127.0.0.1` origins, so it never
  returned `Access-Control-Allow-Origin` for the packaged Tauri webview, whose
  page is served from the `tauri://localhost` custom scheme (`http://tauri.localhost`
  on Windows). WKWebView then blocked every daemon response as a CORS error and the
  renderer's `/health` poll could never succeed — even though the daemon was healthy.
  The allowlist now includes the Tauri webview origins.
- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.3
