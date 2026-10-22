# @qlan-ro/mainframe-ui

## 2.12.3

### Patch Changes

- [#867](https://github.com/qlan-ro/mainframe/pull/867) [`7435f8e`](https://github.com/qlan-ro/mainframe/commit/7435f8e6c496dd93374754be13f064cf376b140e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Bound the initial transcript and earlier pages by encoded items as well as message containers, so large tool and subagent turns load progressively. Preserve parent task cards, reconnect state and find navigation within partially loaded turns.

- [#866](https://github.com/qlan-ro/mainframe/pull/866) [`b1cc1ba`](https://github.com/qlan-ro/mainframe/commit/b1cc1ba06743a31d7a5567aa0ab09339d0c2d7ee) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show chat transcripts after history and pending permissions are restored, while metadata discovery, worktree bookkeeping and session startup continue in the background. Keep late warmup work from reactivating closed chats.

- Updated dependencies [[`7435f8e`](https://github.com/qlan-ro/mainframe/commit/7435f8e6c496dd93374754be13f064cf376b140e)]:
  - @qlan-ro/mainframe-types@2.12.3
