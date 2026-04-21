# @qlan-ro/mainframe-desktop

## 0.11.0

### Minor Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `@`-picker gains terminal-style path autocomplete. Typing `/` in an `@`-token switches from fuzzy search to tree navigation; Tab completes filenames; Enter on a directory drills in.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#224](https://github.com/qlan-ro/mainframe/pull/224) [`29cddc7`](https://github.com/qlan-ro/mainframe/commit/29cddc7a0a9531fa0acfdebb84e1da6ec6c6afd9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer now preserves newlines in sent messages and caps its growth at a max height with internal scroll.

  The max-height cap is applied to an outer scroll wrapper rather than the textarea itself, so the textarea grows naturally and shares its wrapping width with the highlight overlay. With the cap on the textarea, its own scrollbar shaved the effective content width, causing the two layers to wrap at different widths and the caret to drift from the visible text. The overlay also emits a trailing zero-width marker so the caret stays aligned when the text ends with a newline.

  The global text selection color is now a neutral blue instead of the orange accent, so mentions and other accent-colored text stay readable while selected.

  The highlight overlay now seeds its text from the runtime's current state on mount instead of waiting for a subscribe event, so draft text stays visible after ancestors remount (for example, when a permission prompt closes).

- [#222](https://github.com/qlan-ro/mainframe/pull/222) [`1ee5874`](https://github.com/qlan-ro/mainframe/commit/1ee5874732bd683cdb1d379f13c72923d9031027) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list view mode is now derived from the project filter. Grouped view is used when 'All' is selected; flat view is used when filtering by a single project. The manual toggle is gone.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - While a worktree delete is in flight, show a spinner on that row's trash icon and disable both the trash and new-session buttons. Other worktree rows remain interactive.

- Updated dependencies [[`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec), [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805), [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec)]:
  - @qlan-ro/mainframe-core@0.11.0
  - @qlan-ro/mainframe-types@0.11.0
