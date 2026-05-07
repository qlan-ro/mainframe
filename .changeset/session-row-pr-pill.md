---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Session row redesign: PR pill, accent worktree pill, dynamic tag overflow, and stale-tag fix

- New PR pill in session row matches the chat header `PrBadge` styling and links to the detected PR.
- Worktree pill uses the accent colour for clearer visual distinction from user tags.
- Tags share the title row with smart capping: title trims at 50% only when tags need the space, otherwise tags expand into the available width with a `+N` overflow that opens the tag popover.
- Status dot is now vertically centred against the entire row (title + metadata).
- Time column stacks day-label and time on two lines and uses short weekdays.
- Daemon: `PUT /api/chats/:id/tags` now syncs the in-memory active chat so a subsequent `chat.updated` emission (e.g. from `resumeChat`) no longer broadcasts stale tags and clobber the renderer store.
