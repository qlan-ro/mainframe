# @qlan-ro/mainframe-desktop

## 0.20.1

### Patch Changes

- [#363](https://github.com/qlan-ro/mainframe/pull/363) [`00f722c`](https://github.com/qlan-ro/mainframe/commit/00f722c0af68286bab1cebe463a4652f5d56a2ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Skip the fixed 9222 Chrome DevTools port when running under e2e (`MF_E2E=1`). The harness launches Electron instances in quick succession; the fixed port collides between launches and makes suite runs flaky. Production and normal dev are unaffected (the port is still enabled when `MF_E2E` is not set).

- [#361](https://github.com/qlan-ro/mainframe/pull/361) [`bd7330a`](https://github.com/qlan-ro/mainframe/commit/bd7330a49111cbf023ac9223c885b3602ceccb20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the first-run tutorial highlighting the wrong elements — steps 1 and 2 now point at the add-project and new-session buttons — and stop the projects/chats stores from being clobbered when the websocket reconnects.

- Updated dependencies [[`00f722c`](https://github.com/qlan-ro/mainframe/commit/00f722c0af68286bab1cebe463a4652f5d56a2ec)]:
  - @qlan-ro/mainframe-core@0.20.1
  - @qlan-ro/mainframe-types@0.20.1
