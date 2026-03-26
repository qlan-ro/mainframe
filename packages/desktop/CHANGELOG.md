# @qlan-ro/mainframe-desktop

## 0.3.0

### Minor Changes

- [#110](https://github.com/qlan-ro/mainframe/pull/110) [`341054d`](https://github.com/qlan-ro/mainframe/commit/341054de99dcd07673b0999769c9073ddf3d015b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Restore external session import UI with popover, title generation, and command boilerplate stripping

- [#92](https://github.com/qlan-ro/mainframe/pull/92) [`ce26558`](https://github.com/qlan-ro/mainframe/commit/ce26558cc02af3188deefbc257b91033906f2f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add branch management popover with git operations (checkout, merge, push, pull, fetch, rebase, rename, delete) and reusable toast notification system

- [#105](https://github.com/qlan-ro/mainframe/pull/105) [`34cc461`](https://github.com/qlan-ro/mainframe/commit/34cc4611dc230b4425ef23fa3a657e7c737f0615) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: unified session view — remove project selector, show all sessions grouped by project

  Replace the project selector dropdown with a unified sidebar showing all sessions
  across all projects in collapsible groups. The active project is derived from the
  selected session. Worktree projects are auto-detected and linked to their parent
  repository via `git worktree list`.

### Patch Changes

- [#88](https://github.com/qlan-ro/mainframe/pull/88) [`6d7bcfe`](https://github.com/qlan-ro/mainframe/commit/6d7bcfebf1e96a36a1a5a0b9e58c7b93879c1d40) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Auto-refresh editor tab when agent edits the open file

- [#89](https://github.com/qlan-ro/mainframe/pull/89) [`877e717`](https://github.com/qlan-ro/mainframe/commit/877e717799b03415bee7ed87587d478f45ff2fd1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix chat message text overflow by adding word-break rules to markdown container

- [#104](https://github.com/qlan-ro/mainframe/pull/104) [`aa3adce`](https://github.com/qlan-ro/mainframe/commit/aa3adcea5edf758142f1bd53c02b86888556904a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): make entire project row clickable in projects dropdown

  Clicking the right side of a project row (outside the text button) did nothing.
  Added onClick to the row container so any click switches the project, unless
  the delete confirmation is active.

- [#98](https://github.com/qlan-ro/mainframe/pull/98) [`b6f5c90`](https://github.com/qlan-ro/mainframe/commit/b6f5c90299aa1c9bec6859fc53d19bfa51e95b05) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix stale messages showing after project switch by removing duplicate useProject() call from ChatsPanel

- [#109](https://github.com/qlan-ro/mainframe/pull/109) [`9bc7d73`](https://github.com/qlan-ro/mainframe/commit/9bc7d73ab15db04f052da178b22c9a3250540b5e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): show error toasts for failed git actions (checkout, rename, fetch, abort, create branch)

- [#103](https://github.com/qlan-ro/mainframe/pull/103) [`9cac5a2`](https://github.com/qlan-ro/mainframe/commit/9cac5a252e968cd1d5ff4f1c50790c10763e6c40) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make console panel resizable by dragging the separator between preview and console

- Updated dependencies [[`4171e74`](https://github.com/qlan-ro/mainframe/commit/4171e742874f983bf37cea00f3c571573869e6d3), [`a5f8502`](https://github.com/qlan-ro/mainframe/commit/a5f8502de8cde46d00fa6fad7e42808ce89effcf), [`1353e58`](https://github.com/qlan-ro/mainframe/commit/1353e58a7f5199c928261bb52ea79ffedf804b92), [`829fbca`](https://github.com/qlan-ro/mainframe/commit/829fbca5f236c1fb596813f956ddff304cab3472), [`b04c3dd`](https://github.com/qlan-ro/mainframe/commit/b04c3ddee032bdb5bd378589c70121d7414bd11d), [`341054d`](https://github.com/qlan-ro/mainframe/commit/341054de99dcd07673b0999769c9073ddf3d015b), [`ce26558`](https://github.com/qlan-ro/mainframe/commit/ce26558cc02af3188deefbc257b91033906f2f52), [`c293e00`](https://github.com/qlan-ro/mainframe/commit/c293e008d5ad3437e86f1a11372a6e11e8a48a89), [`34cc461`](https://github.com/qlan-ro/mainframe/commit/34cc4611dc230b4425ef23fa3a657e7c737f0615)]:
  - @qlan-ro/mainframe-core@0.3.0
  - @qlan-ro/mainframe-types@0.3.0
