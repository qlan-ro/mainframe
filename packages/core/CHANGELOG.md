# @qlan-ro/mainframe-core

## 0.7.0

### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

### Patch Changes

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): add --ff-only to pull commands to prevent merge commits on divergent branches

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): pass localBranch to pull service so non-current branches use fetch instead of ff-only pull

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20)]:
  - @qlan-ro/mainframe-types@0.7.0
