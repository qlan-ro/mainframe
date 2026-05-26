# @qlan-ro/mainframe-types

## 0.19.0

### Minor Changes

- [#346](https://github.com/qlan-ro/mainframe/pull/346) [`a6897b2`](https://github.com/qlan-ro/mainframe/commit/a6897b26f6f9184f991c8030241c6fc03f27a4ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: surface Claude background tasks in chat session bar

  Adds a chat-header pill showing running and completed-with-output
  Claude background tasks (run_in_background Bash, Monitor). Kill via
  the CLI's own `stop_task` control_request; View shows a bounded tail
  of the spool file (terminal status only). MVP scope — persistence,
  auto-reap on chat archive, live tailing, and Monitor inline streaming
  are tracked as follow-up todos.

### Patch Changes

- [#327](https://github.com/qlan-ro/mainframe/pull/327) [`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Answered AskUserQuestion now renders durably in thread history (desktop + mobile), parsed in core from the CLI tool_result the session already persists.

- [#328](https://github.com/qlan-ro/mainframe/pull/328) [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Resolve and persist absolute CLI executable paths at daemon startup; Settings shows the full path with a daemon-side file Browse; PATH fallback preserved.

- [#318](https://github.com/qlan-ro/mainframe/pull/318) [`d485b18`](https://github.com/qlan-ro/mainframe/commit/d485b18a9a05e7ba3eea9b20dc29b875c7f2455f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix CMD-F not working when focus is outside the chat thread; archived sessions popover now receives data.

- [#345](https://github.com/qlan-ro/mainframe/pull/345) [`49cecfa`](https://github.com/qlan-ro/mainframe/commit/49cecfa4326b14687e6d01e2c7508b5dd217a355) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Import External Sessions: surface sessions from deleted worktrees and project subdirectories by scanning every encoded `~/.claude/projects/` directory whose prefix matches the project, then filtering by the session's own `cwd`. Drop the `new Date()` timestamp fallback that silently labelled missing-timestamp sessions as "Today"; use the JSONL file's `stat().mtime` as the always-real anchor. The popover now also displays the worktree (or subdirectory) the session ran in, and the relative-time formatter uses a single millisecond basis so "Yesterday" never appears before "Today" anymore.

- [#321](https://github.com/qlan-ro/mainframe/pull/321) [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - External Sessions now also lists sessions from worktrees of the active project.

- [#351](https://github.com/qlan-ro/mainframe/pull/351) [`8e125e9`](https://github.com/qlan-ro/mainframe/commit/8e125e9926c83e062e314de068718562315b77db) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stable mobile device identity (UUID generated on the phone, persisted in SecureStore) eliminates duplicate paired-device rows on re-pair. Tokens are now bound to a per-device `auth_epoch` counter so device removal and re-pairing actually invalidate old tokens. WebSocket upgrade and `/api/auth/status` route through the same `validateAuthedToken` check. `/api/auth/register-push` now requires a matching bearer; deleting a device also unregisters its push token. Adds `GET /api/auth/pair-status?code=…` so the CLI can detect re-pairs (same `deviceId`, no new device row). Pair-code entry on mobile is now an OTP-style 6-box input that auto-submits.

  Fixes [#148](https://github.com/qlan-ro/mainframe/issues/148), [#156](https://github.com/qlan-ro/mainframe/issues/156).

- [#324](https://github.com/qlan-ro/mainframe/pull/324) [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Truncate oversized tool_result content in the display pipeline; fetch full output on demand from the session JSONL via a new expand endpoint.
