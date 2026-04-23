# @qlan-ro/mainframe-core

## 0.13.0

### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.

### Patch Changes

- [#236](https://github.com/qlan-ro/mainframe/pull/236) [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list now re-orders correctly when a chat gets new activity, switching sessions while another is being archived no longer blocks the UI, and archiving a running chat no longer leaves a stuck spinner when the dying CLI process emits a final chat.updated event.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed three file/diff editor issues: the editor can now open files outside the project root, collapsed editor panels can be re-expanded, and the diff editor no longer crops the first character of each line.

- Updated dependencies [[`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c)]:
  - @qlan-ro/mainframe-types@0.13.0
