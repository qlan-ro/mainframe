# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.5

### Patch Changes

- [#442](https://github.com/qlan-ro/mainframe/pull/442) [`4eab7ed`](https://github.com/qlan-ro/mainframe/commit/4eab7ed094a70d8c39087fb0590ca65067783ae1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop leaking the daemon on quit and fail loudly on port collisions. macOS quit paths (Cmd+Q, updater relaunch) end the run loop without destroying windows, so the window-Destroyed handler never killed the daemon — the orphan kept the port and the next launch's daemon died on EADDRINUSE with no log line, leaving the UI silently talking to an old, contract-skewed daemon. The Tauri shell now also kills the daemon on RunEvent::Exit, reaps the child (no zombie), and watches for unexpected daemon exits, surfacing them through daemon:status. The daemon surfaces bind failures as logged fatal errors and reports its pid via /health so a stale port owner can be identified with one curl.

- Updated dependencies [[`8189745`](https://github.com/qlan-ro/mainframe/commit/8189745d8deb596a8f9fc5480c88bb378f73ce51)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.5
