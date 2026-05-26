# @qlan-ro/mainframe-core

## 0.19.0

### Minor Changes

- [#327](https://github.com/qlan-ro/mainframe/pull/327) [`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Answered AskUserQuestion now renders durably in thread history (desktop + mobile), parsed in core from the CLI tool_result the session already persists.

- [#346](https://github.com/qlan-ro/mainframe/pull/346) [`a6897b2`](https://github.com/qlan-ro/mainframe/commit/a6897b26f6f9184f991c8030241c6fc03f27a4ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: surface Claude background tasks in chat session bar

  Adds a chat-header pill showing running and completed-with-output
  Claude background tasks (run_in_background Bash, Monitor). Kill via
  the CLI's own `stop_task` control_request; View shows a bounded tail
  of the spool file (terminal status only). MVP scope — persistence,
  auto-reap on chat archive, live tailing, and Monitor inline streaming
  are tracked as follow-up todos.

- [#328](https://github.com/qlan-ro/mainframe/pull/328) [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Resolve and persist absolute CLI executable paths at daemon startup; Settings shows the full path with a daemon-side file Browse; PATH fallback preserved.

- [#321](https://github.com/qlan-ro/mainframe/pull/321) [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - External Sessions now also lists sessions from worktrees of the active project.

- [#324](https://github.com/qlan-ro/mainframe/pull/324) [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Truncate oversized tool_result content in the display pipeline; fetch full output on demand from the session JSONL via a new expand endpoint.

### Patch Changes

- [#317](https://github.com/qlan-ro/mainframe/pull/317) [`5f200b4`](https://github.com/qlan-ro/mainframe/commit/5f200b448259111723d422ce9fc7f1aba3252ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Branch popover horizontal resize, branch-name tooltip, friendly error when deleting the current branch.

- [#350](https://github.com/qlan-ro/mainframe/pull/350) [`d8e0519`](https://github.com/qlan-ro/mainframe/commit/d8e05193129f7cebd48af5989ad776f22c57b0af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(codex): stop "Duplicate key toolCallId-default" crash when two subagents share a description

  TaskGroup `agentId` now derives from the unique tool_use id instead of `taskArgs.description`, so two CollabAgent spawns in the same turn that resolve to the same role/description label no longer collide on assistant-ui's per-part React key. A defensive dedup pass in `convertMessage` guards the renderer against any future regression that lets repeated or empty toolCallIds through.

- [#348](https://github.com/qlan-ro/mainframe/pull/348) [`d006ab4`](https://github.com/qlan-ro/mainframe/commit/d006ab43acecbe0b51325d156be4f0742ea9c48d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix ENOENT when creating a worktree from a running Codex session. `enableWorktree`/`attachWorktree` now skip the Claude-specific session file rename for non-Claude adapters; Codex resumes by `threadId + cwd` and doesn't need files relocated.

- [#315](https://github.com/qlan-ro/mainframe/pull/315) [`9f43958`](https://github.com/qlan-ro/mainframe/commit/9f439584fde42f4604bb86410b0b52adb594cc6e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: don't peg context bar at 100% on 1M models

  The Claude CLI's model probe doesn't report `contextWindow`, so the
  probed catalog replaced the static one with entries that had no
  window size. The renderer then fell back to a hardcoded 200k default,
  so any chat on a 1M model (e.g. `default` → Opus 4.7 1M, `opus[1m]`,
  `sonnet[1m]`) showed its context bar pegged at 100% as soon as usage
  crossed 200k — even though the real window had ~720k headroom left.

  Two changes:
  - `ClaudeAdapter.probeModels()` now reconciles probed entries with
    the static catalog by id, with a description-string fallback
    (`"1M context"`) for ids unknown to the static list.
  - `getModelContextWindow()` returns `undefined` for unknown models
    instead of silently defaulting to 200k. `ChatSessionBar` hides the
    progress segments and percentage when the window is unknown and
    the CLI hasn't reported a usage percentage of its own.

- [#318](https://github.com/qlan-ro/mainframe/pull/318) [`d485b18`](https://github.com/qlan-ro/mainframe/commit/d485b18a9a05e7ba3eea9b20dc29b875c7f2455f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix CMD-F not working when focus is outside the chat thread; archived sessions popover now receives data.

- [#332](https://github.com/qlan-ro/mainframe/pull/332) [`dcf0eb2`](https://github.com/qlan-ro/mainframe/commit/dcf0eb28efdfc75714894a8c4c16e62d00201205) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Archiving a session no longer blocks the daemon event loop — worktree removal is now async.

- [#345](https://github.com/qlan-ro/mainframe/pull/345) [`49cecfa`](https://github.com/qlan-ro/mainframe/commit/49cecfa4326b14687e6d01e2c7508b5dd217a355) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Import External Sessions: surface sessions from deleted worktrees and project subdirectories by scanning every encoded `~/.claude/projects/` directory whose prefix matches the project, then filtering by the session's own `cwd`. Drop the `new Date()` timestamp fallback that silently labelled missing-timestamp sessions as "Today"; use the JSONL file's `stat().mtime` as the always-real anchor. The popover now also displays the worktree (or subdirectory) the session ran in, and the relative-time formatter uses a single millisecond basis so "Yesterday" never appears before "Today" anymore.

- [#319](https://github.com/qlan-ro/mainframe/pull/319) [`98ea740`](https://github.com/qlan-ro/mainframe/commit/98ea740e9725571207bacbd822251273bfdfd2e3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Memory leak fixes: webview destroy, Monaco model dispose, trimmed Shiki languages, Claude CLI idle eviction (2h), renderer memory baseline logging (read via `app.getAppMetrics()` from the main process — the renderer has no `process`). Also fixes the preview webview hanging on "Waiting for localhost…" when the first navigation loses the race with the dev server: `loadURL` now retries with backoff instead of swallowing the error.

- [#308](https://github.com/qlan-ro/mainframe/pull/308) [`e49b5c8`](https://github.com/qlan-ro/mainframe/commit/e49b5c84fe00d3a85b787ba5fbd9f369a9b655d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core/claude): gate PR-URL detection on the originating tool

  Path A (URL scrape) used to run on every `tool_result` block, so any chat
  that read or grepped a file containing a PR URL would get falsely tagged
  with that PR. Path A is now restricted to:
  - `Bash` whose command matches `gh pr` / `glab mr` / `az repos pr`, or
  - `Agent` / `Task` (subagent) tool_results — whose `content` is an array
    of typed blocks rather than a string, now flattened so a PR URL in the
    subagent's final report is actually detected.

  This fixes both the false positives (PR badges from `Read`/`Grep`/`cat`)
  and the false negative where a session that opened a PR via an
  `azure-devops` subagent never registered its own PR.

- [#337](https://github.com/qlan-ro/mainframe/pull/337) [`d0f2442`](https://github.com/qlan-ro/mainframe/commit/d0f244234a38c97acf4e6c34e13877ba09b210c3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix AskUserQuestion answered-question rendering losing the question and answer text. The result parser used a blind regex that broke whenever a question or answer contained a double quote (the question text was truncated/dropped) and split every answer on commas (mangling free-text answers). It now anchors on the exact known question strings from the tool input, preserves free-text answers verbatim, and only comma-splits multi-select answers.

- [#320](https://github.com/qlan-ro/mainframe/pull/320) [`f2b5e78`](https://github.com/qlan-ro/mainframe/commit/f2b5e7896c6923a9ecbdf4417542c68bbb434dd2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove Claude Agent SDK adapter (migration converts existing claude-sdk chats to claude); rename Claude CLI display label to Claude Code.

- [#344](https://github.com/qlan-ro/mainframe/pull/344) [`c47b7c1`](https://github.com/qlan-ro/mainframe/commit/c47b7c154e2556570b2e37a48895c1069cf2f42b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix sessions silently unpinning themselves after navigating away and back. `PATCH /api/chats/:id/pinned` updated SQLite but left the in-memory cached chat (`activeChats[id].chat.pinned`) stale; the next `resumeChat` broadcast `chat.updated` with the old `pinned: false` and clobbered the renderer. Same hole existed for `PATCH /api/chats/:id/effort`. Added `ChatManager.syncChatFields(chatId, partial)` and call it from both routes after the DB write, mirroring the existing `syncChatTags` pattern.

- [#351](https://github.com/qlan-ro/mainframe/pull/351) [`8e125e9`](https://github.com/qlan-ro/mainframe/commit/8e125e9926c83e062e314de068718562315b77db) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stable mobile device identity (UUID generated on the phone, persisted in SecureStore) eliminates duplicate paired-device rows on re-pair. Tokens are now bound to a per-device `auth_epoch` counter so device removal and re-pairing actually invalidate old tokens. WebSocket upgrade and `/api/auth/status` route through the same `validateAuthedToken` check. `/api/auth/register-push` now requires a matching bearer; deleting a device also unregisters its push token. Adds `GET /api/auth/pair-status?code=…` so the CLI can detect re-pairs (same `deviceId`, no new device row). Pair-code entry on mobile is now an OTP-style 6-box input that auto-submits.

  Fixes [#148](https://github.com/qlan-ro/mainframe/issues/148), [#156](https://github.com/qlan-ro/mainframe/issues/156).

- [#342](https://github.com/qlan-ro/mainframe/pull/342) [`1859604`](https://github.com/qlan-ro/mainframe/commit/1859604708ecea42eb5fb6ee78a9ceab7dd4b33d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tolerate malformed JSON in todos columns. `parseTodo` now routes `labels`, `assignees`, and `dependencies` through `safeJsonArray`, which defaults to `[]` and logs the offending row instead of throwing. Historical writes left some rows with double-encoded values that crashed `JSON.parse` and took down the whole Tasks panel; one bad row no longer hides the rest.

- Updated dependencies [[`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858), [`a6897b2`](https://github.com/qlan-ro/mainframe/commit/a6897b26f6f9184f991c8030241c6fc03f27a4ca), [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0), [`d485b18`](https://github.com/qlan-ro/mainframe/commit/d485b18a9a05e7ba3eea9b20dc29b875c7f2455f), [`49cecfa`](https://github.com/qlan-ro/mainframe/commit/49cecfa4326b14687e6d01e2c7508b5dd217a355), [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7), [`8e125e9`](https://github.com/qlan-ro/mainframe/commit/8e125e9926c83e062e314de068718562315b77db), [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1)]:
  - @qlan-ro/mainframe-types@0.19.0
