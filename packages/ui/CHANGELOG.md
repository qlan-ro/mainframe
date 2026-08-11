# @qlan-ro/mainframe-ui

## 2.0.0-rc.23

### Patch Changes

- [#603](https://github.com/qlan-ro/mainframe/pull/603) [`5add23b`](https://github.com/qlan-ro/mainframe/commit/5add23bc5e0b341a60de4c71d102a451e79829cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop a background history re-seed blanking a transcript that is already on screen. A reconnect or reattach re-reads history and replaces the thread wholesale, and the daemon answers "empty" for a chat it has no CLI session to read from yet — so one badly-timed re-seed emptied a populated thread until the next message arrived.

- [#611](https://github.com/qlan-ro/mainframe/pull/611) [`c37b2e0`](https://github.com/qlan-ro/mainframe/commit/c37b2e0fc4007b85dc0780bae132af7b56249515) Thanks [@doruchiulan](https://github.com/doruchiulan)! - GitHub sync: store a real personal access token instead of the Automations placeholder. The link dialog now takes a pasted PAT, the sync pill menu gains "Update GitHub token…", and an auth failure in the import dialog shows a readable message with a one-click path to fix the token. The daemon also stops offering pull requests as importable issues.

- [#594](https://github.com/qlan-ro/mainframe/pull/594) [`05fab23`](https://github.com/qlan-ro/mainframe/commit/05fab235cc642f7e1b2827cfb554ac16c53aa6fc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Band long turn durations in the message timing footer. A two-hour turn read "8158.94s"; it now reads "2h 15m", matching the running indicator's own readout. Turns under a minute keep their fractional second.

- [#612](https://github.com/qlan-ro/mainframe/pull/612) [`77eb70a`](https://github.com/qlan-ro/mainframe/commit/77eb70a6bc5024422fbfe6294f206c832e5b63d7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep pinned chat transcripts at the bottom across WKWebView content reflows.

- [#593](https://github.com/qlan-ro/mainframe/pull/593) [`4ac8666`](https://github.com/qlan-ro/mainframe/commit/4ac86664cb9b5d61fc3270ddd1fdd795507fa19c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop showing two working indicators at once. While a tool call was the last part of a running turn, the message rendered a bare pulse dot on top of the thread's "Working… 12s" row, with the message timestamp between them. The per-message dot is now suppressed in the main thread and kept only in nested subagent transcripts, which have no thread-level indicator.

- [#602](https://github.com/qlan-ro/mainframe/pull/602) [`aeee900`](https://github.com/qlan-ro/mainframe/commit/aeee9008a8c1a7a7a8a973906e537f9ee07779c9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Move the assistant-ui set to the 0.15 line, replacing the legacy context hooks it removes with `useAui`/`useAuiState` selectors. No user-facing change.

- [#601](https://github.com/qlan-ro/mainframe/pull/601) [`5378940`](https://github.com/qlan-ro/mainframe/commit/5378940150537f7ee721374aec81c913d1ae26c9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Internal cleanup: the shared surface-host geometry constant is retired into the surface host component itself, and the dead command-palette inspector icon entry and the unused right-rail sidebar glyph are removed. No user-visible change.

- [#604](https://github.com/qlan-ro/mainframe/pull/604) [`010a14c`](https://github.com/qlan-ro/mainframe/commit/010a14c4485d1315f733c2210b429663011e6ccc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session tabs now restore against the settled thread list, so a reload no longer drops every tab but the active one, and a failed or empty list no longer overwrites the persisted set.

- [#606](https://github.com/qlan-ro/mainframe/pull/606) [`34a8780`](https://github.com/qlan-ro/mainframe/commit/34a8780d06070c05a56406c04c444863a0f25232) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Starting a session no longer leaves a second, unselectable tab behind — the draft tab becomes the session's tab in place.

- [#612](https://github.com/qlan-ro/mainframe/pull/612) [`77eb70a`](https://github.com/qlan-ro/mainframe/commit/77eb70a6bc5024422fbfe6294f206c832e5b63d7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session-panel rework and chrome cleanups: the rail is always visible and vertically centred (it used to vanish below 876px and cover the find band); Background Activity, Launch, and Tasks are now independent stacked glass panels toggled from the rail (Tasks moved out of the left sidebar); branch management left the titlebar and lives on the welcome screen and the session panel's branch row; automations can be deleted from the library, are scoped to the selected project (plus unscoped ones), and each row is annotated with its project.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.23
