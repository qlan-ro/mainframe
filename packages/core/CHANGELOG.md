# @qlan-ro/mainframe-core

## 0.17.3

### Patch Changes

- [#291](https://github.com/qlan-ro/mainframe/pull/291) [`e30d1dd`](https://github.com/qlan-ro/mainframe/commit/e30d1dded2fe7359a27f854372f9d00d11deea95) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hiding `worktrees`/`.worktrees` directories from the file tree at any depth. The shared `IGNORED_DIRS` set (used by recursive search/list paths) was applied unconditionally to the tree route, which hid e.g. `.claude/worktrees/` even though the user expects to navigate into it. The tree route now uses a narrower allowlist (`.git`, `node_modules`); search and file listing keep the broader exclusion.

- [#294](https://github.com/qlan-ro/mainframe/pull/294) [`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Persist detected PRs to the database. Previously they lived only in the renderer's in-memory `detectedPrs` Map, which was rebuilt by replaying events from the daemon's per-`loadChat` history scan — so PR badges only appeared on sessions the user had opened during the current daemon lifetime. PRs are now stored on the chat row (new `detected_prs` column) by both the live `onPrDetected` sink and the history-replay scan, with URL-based dedup and `mentioned → created` source upgrades. The renderer seeds its Map from `chat.detectedPrs` on chat list load, so badges show on the sidebar immediately on app start.

- [#293](https://github.com/qlan-ro/mainframe/pull/293) [`0e6bf80`](https://github.com/qlan-ro/mainframe/commit/0e6bf80807347481a7ce0d5b7ca381cff4f247b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix [#147](https://github.com/qlan-ro/mainframe/issues/147): Queued messages don't dismiss and thinking indicator disappears while assistant is working

  Add comprehensive debug logging and test coverage for message queuing and thinking state management. Identify race conditions and edge cases where queued messages fail to dismiss or the thinking indicator flips false prematurely while the assistant is still streaming responses. Tests cover queued message lifecycle and proper thinking indicator state transitions across subagent execution.

- [#288](https://github.com/qlan-ro/mainframe/pull/288) [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the desktop from auto-switching its active chat when another client (e.g. mobile) creates a new session. The daemon now stamps `chat.created` events with an `originClientId` derived from the originating WebSocket connection, and the desktop only opens/selects the new chat when the event originated locally. Each client receives its own id via a new `connection.ready` event sent on WS open.

- Updated dependencies [[`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845), [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3)]:
  - @qlan-ro/mainframe-types@0.17.3
