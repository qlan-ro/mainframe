# @qlan-ro/mainframe-desktop

## 0.15.1

### Patch Changes

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies [[`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3), [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b)]:
  - @qlan-ro/mainframe-core@0.15.1
  - @qlan-ro/mainframe-types@0.15.1
