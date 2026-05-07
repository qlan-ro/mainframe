# @qlan-ro/mainframe-desktop

## 0.17.3

### Patch Changes

- [#292](https://github.com/qlan-ro/mainframe/pull/292) [`9600737`](https://github.com/qlan-ro/mainframe/commit/960073750d8550da49b3e96fffe9fc49dba37314) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix three HIGH priority desktop UI bugs:
  - [#149](https://github.com/qlan-ro/mainframe/issues/149): Remove overflow-hidden clipping that prevented worktree dialog and "/" popover from displaying
  - [#150](https://github.com/qlan-ro/mainframe/issues/150): Reorder SystemMessage rendering logic to prioritize compaction pills and suppress unwanted artifacts
  - [#151](https://github.com/qlan-ro/mainframe/issues/151): Preserve Monaco editor scroll position when external file modifications trigger value updates

- [#294](https://github.com/qlan-ro/mainframe/pull/294) [`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Persist detected PRs to the database. Previously they lived only in the renderer's in-memory `detectedPrs` Map, which was rebuilt by replaying events from the daemon's per-`loadChat` history scan — so PR badges only appeared on sessions the user had opened during the current daemon lifetime. PRs are now stored on the chat row (new `detected_prs` column) by both the live `onPrDetected` sink and the history-replay scan, with URL-based dedup and `mentioned → created` source upgrades. The renderer seeds its Map from `chat.detectedPrs` on chat list load, so badges show on the sidebar immediately on app start.

- [#293](https://github.com/qlan-ro/mainframe/pull/293) [`0e6bf80`](https://github.com/qlan-ro/mainframe/commit/0e6bf80807347481a7ce0d5b7ca381cff4f247b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix [#147](https://github.com/qlan-ro/mainframe/issues/147): Queued messages don't dismiss and thinking indicator disappears while assistant is working

  Add comprehensive debug logging and test coverage for message queuing and thinking state management. Identify race conditions and edge cases where queued messages fail to dismiss or the thinking indicator flips false prematurely while the assistant is still streaming responses. Tests cover queued message lifecycle and proper thinking indicator state transitions across subagent execution.

- [#288](https://github.com/qlan-ro/mainframe/pull/288) [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the desktop from auto-switching its active chat when another client (e.g. mobile) creates a new session. The daemon now stamps `chat.created` events with an `originClientId` derived from the originating WebSocket connection, and the desktop only opens/selects the new chat when the event originated locally. Each client receives its own id via a new `connection.ready` event sent on WS open.

- Updated dependencies [[`e30d1dd`](https://github.com/qlan-ro/mainframe/commit/e30d1dded2fe7359a27f854372f9d00d11deea95), [`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845), [`0e6bf80`](https://github.com/qlan-ro/mainframe/commit/0e6bf80807347481a7ce0d5b7ca381cff4f247b3), [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3)]:
  - @qlan-ro/mainframe-core@0.17.3
  - @qlan-ro/mainframe-types@0.17.3
