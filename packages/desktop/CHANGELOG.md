# @qlan-ro/mainframe-desktop

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

- [#333](https://github.com/qlan-ro/mainframe/pull/333) [`4140ed3`](https://github.com/qlan-ro/mainframe/commit/4140ed3b41c06f369c48c557b68c79ce4dbb620c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sandbox selection captures ("Submit all") now send directly without a composer round-trip; sandbox capture context renders as a chevron-breadcrumb component in the composer capture area and in the sent message.

- [#324](https://github.com/qlan-ro/mainframe/pull/324) [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Truncate oversized tool_result content in the display pipeline; fetch full output on demand from the session JSONL via a new expand endpoint.

### Patch Changes

- [#339](https://github.com/qlan-ro/mainframe/pull/339) [`7de5998`](https://github.com/qlan-ro/mainframe/commit/7de5998d531edecec28c36780b5f4ced98597d24) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Preserve `askUserQuestion` on AskUserQuestion tool-call results when bridging to assistant-ui. The desktop converter was flattening the result to its raw `content` string, which left the renderer with `answered=false` — the card stayed collapsed and non-clickable, hiding all questions and answers from the user even though the daemon parsed them correctly.

- [#317](https://github.com/qlan-ro/mainframe/pull/317) [`5f200b4`](https://github.com/qlan-ro/mainframe/commit/5f200b448259111723d422ce9fc7f1aba3252ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Branch popover horizontal resize, branch-name tooltip, friendly error when deleting the current branch.

- [#350](https://github.com/qlan-ro/mainframe/pull/350) [`d8e0519`](https://github.com/qlan-ro/mainframe/commit/d8e05193129f7cebd48af5989ad776f22c57b0af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(codex): stop "Duplicate key toolCallId-default" crash when two subagents share a description

  TaskGroup `agentId` now derives from the unique tool_use id instead of `taskArgs.description`, so two CollabAgent spawns in the same turn that resolve to the same role/description label no longer collide on assistant-ui's per-part React key. A defensive dedup pass in `convertMessage` guards the renderer against any future regression that lets repeated or empty toolCallIds through.

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

- [#343](https://github.com/qlan-ro/mainframe/pull/343) [`ae53175`](https://github.com/qlan-ro/mainframe/commit/ae53175963de67994ed5b2fe4fde3b7eb69f4f6b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the executable-path browse dialog in Settings showing "Select Project Directory". `DirectoryPickerModal` now accepts a `title` prop and defaults to "Select File" in file mode; the provider executable picker passes "Select &lt;Provider&gt; Executable".

- [#330](https://github.com/qlan-ro/mainframe/pull/330) [`20acaa3`](https://github.com/qlan-ro/mainframe/commit/20acaa3bea1b71044cd57a56176ebfea145b9a98) Thanks [@dependabot](https://github.com/apps/dependabot)! - Restore Electron binary download on clean install. Electron 42 removed its `postinstall` script, so `pnpm install --frozen-lockfile` no longer fetched `Electron.app`. A root `postinstall` now invokes Electron's own (idempotent) `install.js`.

- [#336](https://github.com/qlan-ro/mainframe/pull/336) [`684f104`](https://github.com/qlan-ro/mainframe/commit/684f1047ab5978ff55e2cf7a87e10ce24a04729f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer image attachments silently failing after the assistant-ui 0.14 upgrade. The library's new `fileMatchesAccept` only treats the literal `*` as a universal wildcard, so the adapter's `*/*` accept string rejected every file and nothing appeared in the composer for both the paperclip button and paste.

  Attachment rejections (file too large, unreadable, unsupported type) now surface as an error toast instead of failing silently.

- [#349](https://github.com/qlan-ro/mainframe/pull/349) [`5923774`](https://github.com/qlan-ro/mainframe/commit/5923774565dec539e867069410b7c1e5827bbfec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(sessions): renaming a session no longer exits editor mode when a new message arrives ([#185](https://github.com/qlan-ro/mainframe/issues/185)). The rename input now survives the list re-sort that follows an `updatedAt` bump, commits on outside pointerdown instead of blur, and is no longer nested inside a `<button>` (invalid HTML).

- [#345](https://github.com/qlan-ro/mainframe/pull/345) [`49cecfa`](https://github.com/qlan-ro/mainframe/commit/49cecfa4326b14687e6d01e2c7508b5dd217a355) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Import External Sessions: surface sessions from deleted worktrees and project subdirectories by scanning every encoded `~/.claude/projects/` directory whose prefix matches the project, then filtering by the session's own `cwd`. Drop the `new Date()` timestamp fallback that silently labelled missing-timestamp sessions as "Today"; use the JSONL file's `stat().mtime` as the always-real anchor. The popover now also displays the worktree (or subdirectory) the session ran in, and the relative-time formatter uses a single millisecond basis so "Yesterday" never appears before "Today" anymore.

- [#319](https://github.com/qlan-ro/mainframe/pull/319) [`98ea740`](https://github.com/qlan-ro/mainframe/commit/98ea740e9725571207bacbd822251273bfdfd2e3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Memory leak fixes: webview destroy, Monaco model dispose, trimmed Shiki languages, Claude CLI idle eviction (2h), renderer memory baseline logging (read via `app.getAppMetrics()` from the main process — the renderer has no `process`). Also fixes the preview webview hanging on "Waiting for localhost…" when the first navigation loses the race with the dev server: `loadURL` now retries with backoff instead of swallowing the error.

- [#325](https://github.com/qlan-ro/mainframe/pull/325) [`5fb7c25`](https://github.com/qlan-ro/mainframe/commit/5fb7c258f9fe4f796b24145359f7e1c68cacc588) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope assistant-ui tapClientLookup index-race crashes to a single message via a reusable per-message render boundary.

- [#338](https://github.com/qlan-ro/mainframe/pull/338) [`3664573`](https://github.com/qlan-ro/mainframe/commit/36645730f54210000fe7e973c8a7f5a22001b748) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild `better-sqlite3` against Electron's ABI when packaging. The `package` script only ran `electron-rebuild -o node-pty`, so the bundled `better-sqlite3` kept its Node-ABI prebuild and the packaged app crashed on launch with `NODE_MODULE_VERSION 137 ... requires 145`. It is now rebuilt with the module dir pointed at `@qlan-ro/mainframe-core` (where it is a declared dependency, since pnpm hoists it out of the desktop package) and `-f` to bypass a stale `.forge-meta` cache that was silently skipping the build.

- [#320](https://github.com/qlan-ro/mainframe/pull/320) [`f2b5e78`](https://github.com/qlan-ro/mainframe/commit/f2b5e7896c6923a9ecbdf4417542c68bbb434dd2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove Claude Agent SDK adapter (migration converts existing claude-sdk chats to claude); rename Claude CLI display label to Claude Code.

- [#314](https://github.com/qlan-ro/mainframe/pull/314) [`af96120`](https://github.com/qlan-ro/mainframe/commit/af96120253af8cfe262a6beddd3cf5a45adc1889) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): enrich `render-process-gone` log payload

  When the renderer crashes, the main-process log now also records the
  URL, renderer OS PID, app uptime, RSS, and crashpad dumps directory.
  The renderer PID matches the `pid` field in
  `~/Library/Logs/DiagnosticReports/*.ips` so a crash log entry can be
  matched to its system crash report without guessing by timestamp.

- [#335](https://github.com/qlan-ro/mainframe/pull/335) [`a62633b`](https://github.com/qlan-ro/mainframe/commit/a62633b81d1e75d8ae09ef5af2dab9475c5d10a4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Revert Electron to ^41.0.3. The dependency bump in [#330](https://github.com/qlan-ro/mainframe/issues/330) raised Electron
  to ^42.1.0, but better-sqlite3@12.10.0 (the latest published version)
  cannot compile against Electron 42's V8: `v8::External::New` now requires
  a third `ExternalPointerTypeTag` argument. `electron-builder` rebuilds
  better-sqlite3 from source during macOS packaging, so the release
  workflow would fail. CI never caught this because `ci.yml` does not run
  `electron-builder` packaging — only the release workflow does, and no
  release has shipped since [#330](https://github.com/qlan-ro/mainframe/issues/330). Pinning back to Electron 41 (the version
  v0.18.2 shipped green with) unblocks releases until better-sqlite3 ships
  an Electron-42-compatible build.

- [#333](https://github.com/qlan-ro/mainframe/pull/333) [`4140ed3`](https://github.com/qlan-ro/mainframe/commit/4140ed3b41c06f369c48c557b68c79ce4dbb620c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sandbox captures now render through the standard attachment renderers (composer thumb + user-bubble `ImageThumbs`) with a name caption beneath each thumbnail. `SandboxCaptureContext` is reduced to a consolidated metadata sidecar (name → selector breadcrumb → annotation), and `SelectorBreadcrumb`'s chevron seams are now visible via a last-segment-primary contrast (`bg-mf-accent` target, `bg-mf-hover` ancestors).

- [#326](https://github.com/qlan-ro/mainframe/pull/326) [`c5eb04d`](https://github.com/qlan-ro/mainframe/commit/c5eb04d3083a92d171b8b3d331f3643f8cd80ede) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Load the tag registry during app init so session-row tag chips render with their colours immediately instead of grey until the tag popover is opened.

- Updated dependencies [[`65db4a6`](https://github.com/qlan-ro/mainframe/commit/65db4a631bb8836a18e9df689c7ac4d1ea659858), [`a6897b2`](https://github.com/qlan-ro/mainframe/commit/a6897b26f6f9184f991c8030241c6fc03f27a4ca), [`5f200b4`](https://github.com/qlan-ro/mainframe/commit/5f200b448259111723d422ce9fc7f1aba3252ad0), [`a592c07`](https://github.com/qlan-ro/mainframe/commit/a592c07438e2d35fea6bf8adaef6055ccb3ee3e0), [`d8e0519`](https://github.com/qlan-ro/mainframe/commit/d8e05193129f7cebd48af5989ad776f22c57b0af), [`d006ab4`](https://github.com/qlan-ro/mainframe/commit/d006ab43acecbe0b51325d156be4f0742ea9c48d), [`9f43958`](https://github.com/qlan-ro/mainframe/commit/9f439584fde42f4604bb86410b0b52adb594cc6e), [`d485b18`](https://github.com/qlan-ro/mainframe/commit/d485b18a9a05e7ba3eea9b20dc29b875c7f2455f), [`dcf0eb2`](https://github.com/qlan-ro/mainframe/commit/dcf0eb28efdfc75714894a8c4c16e62d00201205), [`49cecfa`](https://github.com/qlan-ro/mainframe/commit/49cecfa4326b14687e6d01e2c7508b5dd217a355), [`080aae5`](https://github.com/qlan-ro/mainframe/commit/080aae5d396fc37b7bda43b8207327b8725bdfe7), [`98ea740`](https://github.com/qlan-ro/mainframe/commit/98ea740e9725571207bacbd822251273bfdfd2e3), [`e49b5c8`](https://github.com/qlan-ro/mainframe/commit/e49b5c84fe00d3a85b787ba5fbd9f369a9b655d1), [`d0f2442`](https://github.com/qlan-ro/mainframe/commit/d0f244234a38c97acf4e6c34e13877ba09b210c3), [`f2b5e78`](https://github.com/qlan-ro/mainframe/commit/f2b5e7896c6923a9ecbdf4417542c68bbb434dd2), [`c47b7c1`](https://github.com/qlan-ro/mainframe/commit/c47b7c154e2556570b2e37a48895c1069cf2f42b), [`8e125e9`](https://github.com/qlan-ro/mainframe/commit/8e125e9926c83e062e314de068718562315b77db), [`1859604`](https://github.com/qlan-ro/mainframe/commit/1859604708ecea42eb5fb6ee78a9ceab7dd4b33d), [`4a18fdf`](https://github.com/qlan-ro/mainframe/commit/4a18fdf0fc2eed9853b6654c2659137e983b9ab1)]:
  - @qlan-ro/mainframe-core@0.19.0
  - @qlan-ro/mainframe-types@0.19.0
