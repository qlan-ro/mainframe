# @qlan-ro/mainframe-desktop

## 0.19.0

### Minor Changes

- [#327](https://github.com/qlan-ro/mainframe/pull/327) [`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Answered AskUserQuestion now renders durably in thread history (desktop + mobile), parsed in core from the CLI tool_result the session already persists.

- [#328](https://github.com/qlan-ro/mainframe/pull/328) [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Resolve and persist absolute CLI executable paths at daemon startup; Settings shows the full path with a daemon-side file Browse; PATH fallback preserved.

- [#324](https://github.com/qlan-ro/mainframe/pull/324) [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Truncate oversized tool_result content in the display pipeline; fetch full output on demand from the session JSONL via a new expand endpoint.

### Patch Changes

- [#317](https://github.com/qlan-ro/mainframe/pull/317) [`5f200b4`](https://github.com/qlan-ro/mainframe/commit/5f200b448259111723d422ce9fc7f1aba3252ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Branch popover horizontal resize, branch-name tooltip, friendly error when deleting the current branch.

- [#313](https://github.com/qlan-ro/mainframe/pull/313) [`abc45cf`](https://github.com/qlan-ro/mainframe/commit/abc45cf3d44a6f8297adffaf70ed4656b80e3e86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): always render `FolderGit` icon for the composer worktree button

  The button previously swapped between `FolderGit` (when a worktree path
  existed) and `GitBranch` (when it didn't), which made the affordance read
  as two different actions. The button is the same control either way, so
  the icon is now `FolderGit` in both states.

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

- [#331](https://github.com/qlan-ro/mainframe/pull/331) [`633a5bc`](https://github.com/qlan-ro/mainframe/commit/633a5bc818888deb97f7ed1429cd3e372fb71a7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add scoped data-testid hooks to interactive controls and dialog/modal roots
  across the desktop renderer (test-infra only; no user-facing behavior change).

- [#330](https://github.com/qlan-ro/mainframe/pull/330) [`20acaa3`](https://github.com/qlan-ro/mainframe/commit/20acaa3bea1b71044cd57a56176ebfea145b9a98) Thanks [@dependabot](https://github.com/apps/dependabot)! - Restore Electron binary download on clean install. Electron 42 removed its `postinstall` script, so `pnpm install --frozen-lockfile` no longer fetched `Electron.app`. A root `postinstall` now invokes Electron's own (idempotent) `install.js`.

- [#319](https://github.com/qlan-ro/mainframe/pull/319) [`98ea740`](https://github.com/qlan-ro/mainframe/commit/98ea740e9725571207bacbd822251273bfdfd2e3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Memory leak fixes: webview destroy, Monaco model dispose, trimmed Shiki languages, Claude CLI idle eviction (2h), renderer memory baseline logging (read via `app.getAppMetrics()` from the main process — the renderer has no `process`). Also fixes the preview webview hanging on "Waiting for localhost…" when the first navigation loses the race with the dev server: `loadURL` now retries with backoff instead of swallowing the error.

- [#325](https://github.com/qlan-ro/mainframe/pull/325) [`5fb7c25`](https://github.com/qlan-ro/mainframe/commit/5fb7c258f9fe4f796b24145359f7e1c68cacc588) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope assistant-ui tapClientLookup index-race crashes to a single message via a reusable per-message render boundary.

- [#320](https://github.com/qlan-ro/mainframe/pull/320) [`f2b5e78`](https://github.com/qlan-ro/mainframe/commit/f2b5e7896c6923a9ecbdf4417542c68bbb434dd2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove Claude Agent SDK adapter (migration converts existing claude-sdk chats to claude); rename Claude CLI display label to Claude Code.

- [#314](https://github.com/qlan-ro/mainframe/pull/314) [`af96120`](https://github.com/qlan-ro/mainframe/commit/af96120253af8cfe262a6beddd3cf5a45adc1889) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): enrich `render-process-gone` log payload

  When the renderer crashes, the main-process log now also records the
  URL, renderer OS PID, app uptime, RSS, and crashpad dumps directory.
  The renderer PID matches the `pid` field in
  `~/Library/Logs/DiagnosticReports/*.ips` so a crash log entry can be
  matched to its system crash report without guessing by timestamp.

- [#326](https://github.com/qlan-ro/mainframe/pull/326) [`c5eb04d`](https://github.com/qlan-ro/mainframe/commit/c5eb04d3083a92d171b8b3d331f3643f8cd80ede) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Load the tag registry during app init so session-row tag chips render with their colours immediately instead of grey until the tag popover is opened.

- Updated dependencies [[`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858), [`5f200b4`](https://github.com/qlan-ro/mainframe/commit/5f200b448259111723d422ce9fc7f1aba3252ad0), [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0), [`9f43958`](https://github.com/qlan-ro/mainframe/commit/9f439584fde42f4604bb86410b0b52adb594cc6e), [`d485b18`](https://github.com/qlan-ro/mainframe/commit/d485b18a9a05e7ba3eea9b20dc29b875c7f2455f), [`dcf0eb2`](https://github.com/qlan-ro/mainframe/commit/dcf0eb28efdfc75714894a8c4c16e62d00201205), [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7), [`98ea740`](https://github.com/qlan-ro/mainframe/commit/98ea740e9725571207bacbd822251273bfdfd2e3), [`e49b5c8`](https://github.com/qlan-ro/mainframe/commit/e49b5c84fe00d3a85b787ba5fbd9f369a9b655d1), [`f2b5e78`](https://github.com/qlan-ro/mainframe/commit/f2b5e7896c6923a9ecbdf4417542c68bbb434dd2), [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1)]:
  - @qlan-ro/mainframe-core@0.19.0
  - @qlan-ro/mainframe-types@0.19.0
