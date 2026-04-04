# @qlan-ro/mainframe-types

## 0.7.0

### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements
