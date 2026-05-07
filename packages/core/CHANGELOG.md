# @qlan-ro/mainframe-core

## 0.18.2

### Patch Changes

- [#306](https://github.com/qlan-ro/mainframe/pull/306) [`0dd31dd`](https://github.com/qlan-ro/mainframe/commit/0dd31dda84e2c31e402a5ab0cf40145bda757f12) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): reconcile queued-message state on every result event

  The previous gated sweep (`queueRemaining === 0`) couldn't escape the
  common stranded-state where a leftover `queuedRefs` entry kept the count
  non-zero and pinned `processState='working'` forever, while the renderer's
  composer banner showed stale rows that no event would ever clear.

  `onResult` now reconciles bidirectionally:
  - Cached `metadata.queued` with no matching ref → strip the flag and emit
    `message.queued.processed(uuid)`.
  - `queuedRef` with no matching cached message → drop the ref and emit
    `message.queued.processed(ref.uuid)`.
  - Always emits `message.queued.snapshot` so the renderer's
    `queuedMessages` map converges on the daemon's truth — defends against
    any out-of-order delivery between `message.queued` and
    `message.queued.processed`.

  `processState` now uses the post-reconcile count.

- [#302](https://github.com/qlan-ro/mainframe/pull/302) [`93416b7`](https://github.com/qlan-ro/mainframe/commit/93416b7dd668f9acdafbbd6bdbe7ff4a697a94c3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session row redesign: PR pill, accent worktree pill, dynamic tag overflow, and stale-tag fix
  - New PR pill in session row matches the chat header `PrBadge` styling and links to the detected PR.
  - Worktree pill uses the accent colour for clearer visual distinction from user tags.
  - Tags share the title row with smart capping: title trims at 50% only when tags need the space, otherwise tags expand into the available width with a `+N` overflow that opens the tag popover.
  - Status dot is now vertically centred against the entire row (title + metadata).
  - Time column stacks day-label and time on two lines and uses short weekdays.
  - Daemon: `PUT /api/chats/:id/tags` now syncs the in-memory active chat so a subsequent `chat.updated` emission (e.g. from `resumeChat`) no longer broadcasts stale tags and clobber the renderer store.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.18.2
