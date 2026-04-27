# @qlan-ro/mainframe-core

## 0.15.1

### Patch Changes

- [#259](https://github.com/qlan-ro/mainframe/pull/259) [`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(claude): drop sidechain entries from history loader so subagent dispatch prompts no longer render as ghost user bubbles in the parent thread. Skill-loaded synthesis still runs first, so user-typed `/skill` invocations are preserved.

- [`eace2d6`](https://github.com/qlan-ro/mainframe/commit/eace2d648157ac64f437b5f1f70e37d65abf3f46) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect PR mutation commands (gh pr edit/ready/merge/close/reopen/comment/review and GitLab/Azure equivalents) so the PR badge appears when the agent mutates a PR, not only when it creates one.

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.15.1
