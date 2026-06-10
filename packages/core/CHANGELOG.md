# @qlan-ro/mainframe-core

## 0.22.2

### Patch Changes

- [#385](https://github.com/qlan-ro/mainframe/pull/385) [`193663d`](https://github.com/qlan-ro/mainframe/commit/193663df57881320dd264dccce26ae3df0f14d39) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Start the daemon before reconciling recovered Claude background tasks, and broadcast recovered tasks to connected clients once reconciliation completes.

- [#384](https://github.com/qlan-ro/mainframe/pull/384) [`6479309`](https://github.com/qlan-ro/mainframe/commit/6479309395716d1844e3ea3562148612b612d2b4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Handle Codex app-server JSON-RPC messages that include trailing stdout bytes on the same line instead of dropping the notification as malformed.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.22.2
