# @qlan-ro/mainframe-desktop

## 0.18.0

### Minor Changes

- [#290](https://github.com/qlan-ro/mainframe/pull/290) [`9998508`](https://github.com/qlan-ro/mainframe/commit/99985081bf6ab6182f9541f8d302e2082d1818e9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Review Panel modal: pre-PR review surface for the active chat. Cmd/Ctrl+Shift+R or the Review button opens a modal showing every changed file with a Monaco diff viewer (inline / split toggle) and gutter-comment widgets that post line-anchored comments back into the chat. Selection on added/removed lines is preserved and visible. Staging / commit / Open PR controls are not yet exposed in the UI; the matching git API surface ships behind it (`/api/git/stage`, `/unstage`, `/commit`, `/push`).

- [#297](https://github.com/qlan-ro/mainframe/pull/297) [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session row tagging.

  Sessions can now be tagged with user-defined tags via right-click → Tags or by clicking the tag row on hover. The sessions panel header gains a tag filter row with synthetic `has-pr` and `has-worktree` chips alongside user tags; multiple selected chips combine with strict AND. The session row layout moves the worktree pill and PR badge into the title row and replaces the project · branch · time metadata line with a dedicated tag row.

### Patch Changes

- [#299](https://github.com/qlan-ro/mainframe/pull/299) [`587c0cb`](https://github.com/qlan-ro/mainframe/commit/587c0cb19ac2d776f9971a903d14f3a2f6f8653f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a "Check for Updates…" item to the Help menu. Triggers a manual update check and shows a native dialog when you're already on the latest version or when the check fails. Available updates continue to surface in the status bar as before.

- Updated dependencies [[`9998508`](https://github.com/qlan-ro/mainframe/commit/99985081bf6ab6182f9541f8d302e2082d1818e9), [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850)]:
  - @qlan-ro/mainframe-core@0.18.0
  - @qlan-ro/mainframe-types@0.18.0
