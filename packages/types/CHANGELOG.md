# @qlan-ro/mainframe-types

## 0.5.0

## 0.4.0

### Minor Changes

- [#118](https://github.com/qlan-ro/mainframe/pull/118) [`ab58314`](https://github.com/qlan-ro/mainframe/commit/ab58314573f510ff4566048db028eed3ff29b488) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add base branch selector, custom branch naming, fork-to-worktree, worktree awareness indicators, and worktree-aware launch configurations

### Patch Changes

- [#117](https://github.com/qlan-ro/mainframe/pull/117) [`572a492`](https://github.com/qlan-ro/mainframe/commit/572a4924b4016d395b71b119073959cb6d6985d8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix push/pull using wrong remote ref when local branch name differs from tracking branch. Group worktree branches into separate collapsible sections in the branch popover. Add tooltip on tracking label for truncated names.

## 0.3.0

### Minor Changes

- [#92](https://github.com/qlan-ro/mainframe/pull/92) [`ce26558`](https://github.com/qlan-ro/mainframe/commit/ce26558cc02af3188deefbc257b91033906f2f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add branch management popover with git operations (checkout, merge, push, pull, fetch, rebase, rename, delete) and reusable toast notification system

- [#105](https://github.com/qlan-ro/mainframe/pull/105) [`34cc461`](https://github.com/qlan-ro/mainframe/commit/34cc4611dc230b4425ef23fa3a657e7c737f0615) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: unified session view — remove project selector, show all sessions grouped by project

  Replace the project selector dropdown with a unified sidebar showing all sessions
  across all projects in collapsible groups. The active project is derived from the
  selected session. Worktree projects are auto-detected and linked to their parent
  repository via `git worktree list`.
