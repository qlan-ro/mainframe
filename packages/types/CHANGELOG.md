# @qlan-ro/mainframe-types

## 0.17.3

### Patch Changes

- [#294](https://github.com/qlan-ro/mainframe/pull/294) [`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Persist detected PRs to the database. Previously they lived only in the renderer's in-memory `detectedPrs` Map, which was rebuilt by replaying events from the daemon's per-`loadChat` history scan — so PR badges only appeared on sessions the user had opened during the current daemon lifetime. PRs are now stored on the chat row (new `detected_prs` column) by both the live `onPrDetected` sink and the history-replay scan, with URL-based dedup and `mentioned → created` source upgrades. The renderer seeds its Map from `chat.detectedPrs` on chat list load, so badges show on the sidebar immediately on app start.

- [#288](https://github.com/qlan-ro/mainframe/pull/288) [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the desktop from auto-switching its active chat when another client (e.g. mobile) creates a new session. The daemon now stamps `chat.created` events with an `originClientId` derived from the originating WebSocket connection, and the desktop only opens/selects the new chat when the event originated locally. Each client receives its own id via a new `connection.ready` event sent on WS open.
