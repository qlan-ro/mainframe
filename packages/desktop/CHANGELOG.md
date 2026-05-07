# @qlan-ro/mainframe-desktop

## 0.18.2

### Patch Changes

- [#305](https://github.com/qlan-ro/mainframe/pull/305) [`b8288d8`](https://github.com/qlan-ro/mainframe/commit/b8288d8549ff3b4cd161d69dc2ba8613b89dd466) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render fullview plugin zone as an overlay modal instead of replacing the center layout.

- [#302](https://github.com/qlan-ro/mainframe/pull/302) [`93416b7`](https://github.com/qlan-ro/mainframe/commit/93416b7dd668f9acdafbbd6bdbe7ff4a697a94c3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session row redesign: PR pill, accent worktree pill, dynamic tag overflow, and stale-tag fix
  - New PR pill in session row matches the chat header `PrBadge` styling and links to the detected PR.
  - Worktree pill uses the accent colour for clearer visual distinction from user tags.
  - Tags share the title row with smart capping: title trims at 50% only when tags need the space, otherwise tags expand into the available width with a `+N` overflow that opens the tag popover.
  - Status dot is now vertically centred against the entire row (title + metadata).
  - Time column stacks day-label and time on two lines and uses short weekdays.
  - Daemon: `PUT /api/chats/:id/tags` now syncs the in-memory active chat so a subsequent `chat.updated` emission (e.g. from `resumeChat`) no longer broadcasts stale tags and clobber the renderer store.

- Updated dependencies [[`0dd31dd`](https://github.com/qlan-ro/mainframe/commit/0dd31dda84e2c31e402a5ab0cf40145bda757f12), [`93416b7`](https://github.com/qlan-ro/mainframe/commit/93416b7dd668f9acdafbbd6bdbe7ff4a697a94c3)]:
  - @qlan-ro/mainframe-core@0.18.2
  - @qlan-ro/mainframe-types@0.18.2
