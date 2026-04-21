# @qlan-ro/mainframe-core

## 0.11.0

### Minor Changes

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - File search now surfaces gitignored config files (e.g. .env) while still excluding build artifacts like node_modules and dist.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.0
