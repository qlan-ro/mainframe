# @qlan-ro/mainframe-types

## 2.3.2

### Patch Changes

- [#698](https://github.com/qlan-ro/mainframe/pull/698) [`0b68c88`](https://github.com/qlan-ro/mainframe/commit/0b68c889995bdda629e76cab1f96940d5707248e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sending a message with only file attachments and no typed text now shows up as a turn with its attachment pills, both live and after reloading the session. Previously the daemon stored the turn but two guards meant to hide internal CLI plumbing erased it, so the attachments reached the agent but never appeared in the transcript.

- [#699](https://github.com/qlan-ro/mainframe/pull/699) [`d5f0ec8`](https://github.com/qlan-ro/mainframe/commit/d5f0ec8bf8bfaa90204f81d102ff3c26623e9ffa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex-backed chats now report context-window usage: the rail ring and Summary row populate the same way they do for Claude chats, instead of staying empty for the life of the session.

  Also fixed: recorded context totals now survive a daemon restart instead of regressing to a coarser estimate on reload.
