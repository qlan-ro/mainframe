# @qlan-ro/mainframe-types

## 0.3.0

### Minor Changes

- [#92](https://github.com/qlan-ro/mainframe/pull/92) [`ce26558`](https://github.com/qlan-ro/mainframe/commit/ce26558cc02af3188deefbc257b91033906f2f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add branch management popover with git operations (checkout, merge, push, pull, fetch, rebase, rename, delete) and reusable toast notification system

- [#105](https://github.com/qlan-ro/mainframe/pull/105) [`34cc461`](https://github.com/qlan-ro/mainframe/commit/34cc4611dc230b4425ef23fa3a657e7c737f0615) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: unified session view — remove project selector, show all sessions grouped by project

  Replace the project selector dropdown with a unified sidebar showing all sessions
  across all projects in collapsible groups. The active project is derived from the
  selected session. Worktree projects are auto-detected and linked to their parent
  repository via `git worktree list`.
