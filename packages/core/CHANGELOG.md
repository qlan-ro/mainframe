# @qlan-ro/mainframe-core

## 0.19.0

### Minor Changes

- [#327](https://github.com/qlan-ro/mainframe/pull/327) [`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Answered AskUserQuestion now renders durably in thread history (desktop + mobile), parsed in core from the CLI tool_result the session already persists.

- [#328](https://github.com/qlan-ro/mainframe/pull/328) [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Resolve and persist absolute CLI executable paths at daemon startup; Settings shows the full path with a daemon-side file Browse; PATH fallback preserved.

- [#321](https://github.com/qlan-ro/mainframe/pull/321) [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - External Sessions now also lists sessions from worktrees of the active project.

- [#324](https://github.com/qlan-ro/mainframe/pull/324) [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Truncate oversized tool_result content in the display pipeline; fetch full output on demand from the session JSONL via a new expand endpoint.

### Patch Changes

- [#317](https://github.com/qlan-ro/mainframe/pull/317) [`5f200b4`](https://github.com/qlan-ro/mainframe/commit/5f200b448259111723d422ce9fc7f1aba3252ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Branch popover horizontal resize, branch-name tooltip, friendly error when deleting the current branch.

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

- [#320](https://github.com/qlan-ro/mainframe/pull/320) [`f2b5e78`](https://github.com/qlan-ro/mainframe/commit/f2b5e7896c6923a9ecbdf4417542c68bbb434dd2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove Claude Agent SDK adapter (migration converts existing claude-sdk chats to claude); rename Claude CLI display label to Claude Code.

- Updated dependencies [[`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858), [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0), [`d485b18`](https://github.com/qlan-ro/mainframe/commit/d485b18a9a05e7ba3eea9b20dc29b875c7f2455f), [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7), [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1)]:
  - @qlan-ro/mainframe-types@0.19.0
