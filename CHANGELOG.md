# Changelog

## 2.0.0-rc.13


### Patch Changes

- Updated dependencies [[`f2b0314`](https://github.com/qlan-ro/mainframe/commit/f2b0314f0586174d098b058c242be60a1e19f61b)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.13


### Patch Changes

- [#502](https://github.com/qlan-ro/mainframe/pull/502) [`f202afd`](https://github.com/qlan-ro/mainframe/commit/f202afd5f72c5da542eb81cc8b40792f9d82c4eb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions whose transcript failed to load in the Rust daemon. When a session's `thread/read` history contained an item type this port didn't know — `contextCompaction` (emitted after a context compaction) or `subAgentActivity` (multi-agent) — the whole payload failed to deserialize and the transcript rendered empty. Unrecognized items are now skipped on reload, matching the Node daemon, so the rest of the history still loads.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.13


### Patch Changes

- [#492](https://github.com/qlan-ro/mainframe/pull/492) [`f2b0314`](https://github.com/qlan-ro/mainframe/commit/f2b0314f0586174d098b058c242be60a1e19f61b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Capture full diagnostics when a render error is caught. The error boundary now
  logs the error stack and React component stack durably through the host (so
  packaged builds record crashes without devtools), and "Copy details" copies the
  full stack bundle instead of just the one-line message.


## 2.0.0-rc.12


### Patch Changes

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).

- Updated dependencies [[`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.12
  - @qlan-ro/mainframe-core@2.0.0-rc.12


### Patch Changes

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).

- Updated dependencies [[`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.12


### Patch Changes

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).


## 2.0.0-rc.11


### Patch Changes

- Updated dependencies [[`4b6c048`](https://github.com/qlan-ro/mainframe/commit/4b6c048a9fdfac3eafee8d8beb76eb4bc59d0417)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.11
  - @qlan-ro/mainframe-types@2.0.0-rc.11


### Patch Changes

- Updated dependencies [[`cc4a2ad`](https://github.com/qlan-ro/mainframe/commit/cc4a2ad3ab43f6aff608b2a5860881b584397b5d), [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359), [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579), [`219ace1`](https://github.com/qlan-ro/mainframe/commit/219ace16e7be524b8282307dcd13e5b8f185e402), [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.11


### Patch Changes

- [#486](https://github.com/qlan-ro/mainframe/pull/486) [`4b6c048`](https://github.com/qlan-ro/mainframe/commit/4b6c048a9fdfac3eafee8d8beb76eb4bc59d0417) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex quota now warms up with one automatic pull at daemon boot (both Node and Rust daemons), so the ambient indicator is populated on app start instead of waiting for a manual refresh. Codex still has no polling timer — beyond boot it stays manual refresh + session pushes.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.11


### Minor Changes

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.

### Patch Changes

- [#476](https://github.com/qlan-ro/mainframe/pull/476) [`cc4a2ad`](https://github.com/qlan-ro/mainframe/commit/cc4a2ad3ab43f6aff608b2a5860881b584397b5d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session archive flow. Archiving a session with no git worktree no longer raises a confirm dialog — there was nothing to decide, since the dialog exists only to ask what should happen to the worktree.

  Sessions with a worktree are now asked before anything moves, not after. assistant-ui switches the active thread away the moment `archive()` is called, so prompting from inside the adapter changed the selected session while the dialog was still open, and cancelling stranded the user on an empty draft instead of returning them to the session they had just chosen to keep. The row now settles the question first and only then archives, so a cancel leaves both the session and the selection untouched.

  Project rows offer a remove button on hover, alongside the existing right-click menu item. The session row's archive action uses an archive icon instead of an X.

- [#477](https://github.com/qlan-ro/mainframe/pull/477) [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix picking a project in the "All projects" view doing nothing. The picker read the draft thread's id before anything had created one — assistant-ui only mints that id inside `switchToNewThread`, and clears it again every time a draft is committed on first send — so the handler hit its null guard and returned silently. It now creates the draft first and seeds it afterwards.

  A new session started from the picker also honors the configured default adapter, matching the path taken when a project is already selected; it previously always started on Claude.

- [#475](https://github.com/qlan-ro/mainframe/pull/475) [`219ace1`](https://github.com/qlan-ro/mainframe/commit/219ace16e7be524b8282307dcd13e5b8f185e402) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The sessions list no longer reserves layout width for a scrollbar that is invisible at rest. A global `scrollbar-width: thin` made WebKit render a classic, space-reserving bar, shrinking every row by 13px to line a gutter whose thumb is transparent until hover; the list now uses a Radix ScrollArea, whose absolutely-positioned thumb overlays the rows at no layout cost.

  Fixes a latent bug in the shared `ScrollArea`: its `[&>div]:!block` rule used Tailwind v3's important-prefix syntax, which compiles to nothing under Tailwind v4, so the rule had never taken effect. Radix's `display: table` viewport wrapper now gets a viewport-bounded width as intended, restoring `truncate` on flex rows in every ScrollArea.

  The Tasks section now shows at most five tasks with a "View all N tasks" row, and sits in the bottom cluster below the flexible spacer. Project rows reserve full-strength foreground for the unread signal instead of using it at rest, matching the session-row convention.

- [#477](https://github.com/qlan-ro/mainframe/pull/477) [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Initialize new session composers with the same snapshotted defaults used on first send.

- Updated dependencies [[`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.10


## 2.0.0-rc.10


### Patch Changes

- Updated dependencies [[`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579), [`d428031`](https://github.com/qlan-ro/mainframe/commit/d428031ac7cc14c5cd0295632db3b4990c3a0691), [`12a4d83`](https://github.com/qlan-ro/mainframe/commit/12a4d83a2fdb9ca688c37fc07c264bb5e1335a9c)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.10
  - @qlan-ro/mainframe-core@2.0.0-rc.10


### Minor Changes

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.

### Patch Changes

- [#479](https://github.com/qlan-ro/mainframe/pull/479) [`d428031`](https://github.com/qlan-ro/mainframe/commit/d428031ac7cc14c5cd0295632db3b4990c3a0691) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show context usage percentages for Codex sessions.

- [#481](https://github.com/qlan-ro/mainframe/pull/481) [`12a4d83`](https://github.com/qlan-ro/mainframe/commit/12a4d83a2fdb9ca688c37fc07c264bb5e1335a9c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add GitHub sync fields to the todos plugin schema so issue creation/sync has somewhere to write closed_at, state_reason, author, and remote linkage.

- Updated dependencies [[`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.10


### Minor Changes

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.


## 2.0.0-rc.9


### Patch Changes

- Updated dependencies [[`1191d5a`](https://github.com/qlan-ro/mainframe/commit/1191d5a38d014e25fc86bc0d5731ca62aabe3f6c), [`79280c6`](https://github.com/qlan-ro/mainframe/commit/79280c665fc7165ed545980ba279ef398b1cc319)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.9
  - @qlan-ro/mainframe-types@2.0.0-rc.9


### Patch Changes

- [#462](https://github.com/qlan-ro/mainframe/pull/462) [`c213f85`](https://github.com/qlan-ro/mainframe/commit/c213f851c2790a391ec576f2e319c9ff32fb98ac) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix drag-and-drop not working on the Tasks kanban board, and add drag visual feedback.

  Tauri's native window-level drag/drop interceptor is enabled by default (`dragDropEnabled`), which swallows a drag session before the page's HTML5 `dragstart`/`dragover`/`drop` listeners ever fire. The kanban board (`TaskCard`/`TaskColumn`) and the composer's file-attachment dropzone both use plain HTML5 DnD (no native Tauri file-drop API is used anywhere), so setting `"dragDropEnabled": false` on the main window unblocks both without touching any OS-level file-drop feature.

  While fixing this, `TaskCard` now dims to 50% opacity while being dragged, and `TaskColumn` highlights with a tinted background and ring while a drag hovers over it — feedback that was previously invisible because the drag never reached the page at all.

- Updated dependencies [[`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`bbd080f`](https://github.com/qlan-ro/mainframe/commit/bbd080fb33cff1bbe1bcba417e5b09ab85486549), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af), [`c8db301`](https://github.com/qlan-ro/mainframe/commit/c8db301b70304c5936444327565591ff4412eabf), [`c213f85`](https://github.com/qlan-ro/mainframe/commit/c213f851c2790a391ec576f2e319c9ff32fb98ac)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.9


### Patch Changes

- [#468](https://github.com/qlan-ro/mainframe/pull/468) [`1191d5a`](https://github.com/qlan-ro/mainframe/commit/1191d5a38d014e25fc86bc0d5731ca62aabe3f6c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `mainframe update` self-update gaps: unrecognized CLI subcommands now print an error instead of silently falling through to booting the daemon (previously crashed with a confusing `EADDRINUSE`), add `mainframe help`/`-h`/`--help`, and `mainframe update` now refuses to install a release that isn't newer than the running version unless `--force` is passed.

- [#471](https://github.com/qlan-ro/mainframe/pull/471) [`79280c6`](https://github.com/qlan-ro/mainframe/commit/79280c665fc7165ed545980ba279ef398b1cc319) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix new chats getting created with no model when an adapter has no saved default-model setting (e.g. automation-created Codex chats), which made Codex's app-server reject the session with `Invalid request: missing field \`model\``. Chat creation now falls back to the adapter's own catalog default model, the same fallback already used for tuning resolution.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.9


### Minor Changes

- [#465](https://github.com/qlan-ro/mainframe/pull/465) [`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations: add a read-only details view (Overview/Runs tabs, reached by clicking a library row) and make project scoping real. Automations now save non-configurably to the session's active project — the scope toggle is gone, the library filters to it, and Agent steps inherit it automatically with a real branch picker for their worktree's base branch. Also: removed the non-functional per-tool auto-approve chips (permission mode already covers this), added a short inline explanation for the agent step's "Result" token, and replaced the hardcoded model list with the live provider/model catalog.

- [#466](https://github.com/qlan-ro/mainframe/pull/466) [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Hide automation-created chats from the default sessions list. `ask_agent` steps now stamp the new chat with `automationRunId`, and the daemon excludes those chats from the default `/api/chats` list — they remain reachable directly (e.g. "Open agent chat" from a workflow run).

- [#464](https://github.com/qlan-ro/mainframe/pull/464) [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a global "Default provider" setting (Settings → Providers) that picks which adapter seeds new chats, replacing the hardcoded Claude default. Also fix the top-level "Providers" nav item showing a blank pane until a specific provider was picked underneath it — it now auto-selects the first installed adapter.

- [#463](https://github.com/qlan-ro/mainframe/pull/463) [`c8db301`](https://github.com/qlan-ro/mainframe/commit/c8db301b70304c5936444327565591ff4412eabf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild the sessions sidebar: compact single-line rows, a hover detail card, a one-click project switcher list, and an opt-in "Sort by Project" grouping mode.

  Session rows collapse from two lines to one — the status indicator, title, and time now share a single row, with worktree/PR/tag info reduced to small trailing glyphs. Hovering a row raises a floating detail card with the full project, worktree/branch, PR, tag, and branch-safety information the row no longer shows inline. The Projects filter bar becomes a vertical switcher list ("All projects" plus one row per project with a colored initial avatar and attention badge) instead of a wrapping pill cloud, and selecting a project is now a plain single-select switch rather than a toggle. The sessions Sort By menu gains a "Project" option that groups the list into one section per project; the time-based default is unchanged. Relative timestamps for same-day sessions now read as a short duration ("5m", "2h") instead of a clock time. The worktree glyph switches from `GitFork` to `FolderGit2` everywhere it represents a worktree (composer, toolbar, git panel, session rows), leaving the unrelated branch glyph untouched.

### Patch Changes

- [#460](https://github.com/qlan-ro/mainframe/pull/460) [`bbd080f`](https://github.com/qlan-ro/mainframe/commit/bbd080fb33cff1bbe1bcba417e5b09ab85486549) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix three chat/composer bugs: a flaky EditorTab LSP test that raced neighbor suites in full-run CI, the copy-link context-menu item giving no feedback on select, and the composer pre-send display ignoring the user's configured provider default model and permission mode.

- [#462](https://github.com/qlan-ro/mainframe/pull/462) [`c213f85`](https://github.com/qlan-ro/mainframe/commit/c213f851c2790a391ec576f2e319c9ff32fb98ac) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix drag-and-drop not working on the Tasks kanban board, and add drag visual feedback.

  Tauri's native window-level drag/drop interceptor is enabled by default (`dragDropEnabled`), which swallows a drag session before the page's HTML5 `dragstart`/`dragover`/`drop` listeners ever fire. The kanban board (`TaskCard`/`TaskColumn`) and the composer's file-attachment dropzone both use plain HTML5 DnD (no native Tauri file-drop API is used anywhere), so setting `"dragDropEnabled": false` on the main window unblocks both without touching any OS-level file-drop feature.

  While fixing this, `TaskCard` now dims to 50% opacity while being dragged, and `TaskColumn` highlights with a tinted background and ring while a drag hovers over it — feedback that was previously invisible because the drag never reached the page at all.

- Updated dependencies [[`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.8


## 2.0.0-rc.8


### Patch Changes

- Updated dependencies [[`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.8
  - @qlan-ro/mainframe-core@2.0.0-rc.8


### Minor Changes

- [#465](https://github.com/qlan-ro/mainframe/pull/465) [`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations: add a read-only details view (Overview/Runs tabs, reached by clicking a library row) and make project scoping real. Automations now save non-configurably to the session's active project — the scope toggle is gone, the library filters to it, and Agent steps inherit it automatically with a real branch picker for their worktree's base branch. Also: removed the non-functional per-tool auto-approve chips (permission mode already covers this), added a short inline explanation for the agent step's "Result" token, and replaced the hardcoded model list with the live provider/model catalog.

- [#466](https://github.com/qlan-ro/mainframe/pull/466) [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Hide automation-created chats from the default sessions list. `ask_agent` steps now stamp the new chat with `automationRunId`, and the daemon excludes those chats from the default `/api/chats` list — they remain reachable directly (e.g. "Open agent chat" from a workflow run).

- [#464](https://github.com/qlan-ro/mainframe/pull/464) [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a global "Default provider" setting (Settings → Providers) that picks which adapter seeds new chats, replacing the hardcoded Claude default. Also fix the top-level "Providers" nav item showing a blank pane until a specific provider was picked underneath it — it now auto-selects the first installed adapter.

### Patch Changes

- Updated dependencies [[`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.8


### Minor Changes

- [#465](https://github.com/qlan-ro/mainframe/pull/465) [`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations: add a read-only details view (Overview/Runs tabs, reached by clicking a library row) and make project scoping real. Automations now save non-configurably to the session's active project — the scope toggle is gone, the library filters to it, and Agent steps inherit it automatically with a real branch picker for their worktree's base branch. Also: removed the non-functional per-tool auto-approve chips (permission mode already covers this), added a short inline explanation for the agent step's "Result" token, and replaced the hardcoded model list with the live provider/model catalog.

- [#466](https://github.com/qlan-ro/mainframe/pull/466) [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Hide automation-created chats from the default sessions list. `ask_agent` steps now stamp the new chat with `automationRunId`, and the daemon excludes those chats from the default `/api/chats` list — they remain reachable directly (e.g. "Open agent chat" from a workflow run).

- [#464](https://github.com/qlan-ro/mainframe/pull/464) [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a global "Default provider" setting (Settings → Providers) that picks which adapter seeds new chats, replacing the hardcoded Claude default. Also fix the top-level "Providers" nav item showing a blank pane until a specific provider was picked underneath it — it now auto-selects the first installed adapter.


## 2.0.0-rc.7


### Minor Changes

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.

### Patch Changes

- Updated dependencies [[`09debb6`](https://github.com/qlan-ro/mainframe/commit/09debb6ee884b41836c8e06b40859c3a08b126c8), [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.7
  - @qlan-ro/mainframe-types@2.0.0-rc.7


### Patch Changes

- [#450](https://github.com/qlan-ro/mainframe/pull/450) [`acf8aa1`](https://github.com/qlan-ro/mainframe/commit/acf8aa1b2fb43467286c56395a921c7513402db7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Automations panel popovers (add trigger, add step, token picker) rendering invisibly behind the panel's own backdrop. `AutomationsHost`'s overlay used `z-[4600]`, well above the `z-50` tier every Radix popover/dropdown in the app defaults to — so clicking "+ Add a trigger" or "+ Add step" opened the menu, just painted underneath the modal. Overlay now uses `z-50`, matching every other full-screen dialog in the app.

- [#453](https://github.com/qlan-ro/mainframe/pull/453) [`cbb7673`](https://github.com/qlan-ro/mainframe/commit/cbb76730cadc6b1437e556e9698f5382fe9fa415) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix stale frontend assets surviving app updates (root cause behind the "still broken" scrollbar reports on [#438](https://github.com/qlan-ro/mainframe/issues/438)/[#443](https://github.com/qlan-ro/mainframe/issues/443)/[#446](https://github.com/qlan-ro/mainframe/issues/446)).

  Tauri's asset protocol sends no `Cache-Control`/`ETag`/`Last-Modified` headers, and since the `tauri://` origin never changes between app versions, WKWebView's disk cache could keep serving `index.html` and its referenced JS/CSS from a pre-update session after an in-place update — with no way to tell it was stale. Three separate scrollbar-CSS fixes shipped correctly but kept getting masked by this. The main window is now built manually (`"create": false` in config) with `on_web_resource_request` attaching `Cache-Control: no-store` to every asset response, so each request always hits the current bundle.

- Updated dependencies [[`f4c77d4`](https://github.com/qlan-ro/mainframe/commit/f4c77d47241645b41c70c32dcb0f1b9b0727d886)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.7


### Minor Changes

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.

### Patch Changes

- [#455](https://github.com/qlan-ro/mainframe/pull/455) [`09debb6`](https://github.com/qlan-ro/mainframe/commit/09debb6ee884b41836c8e06b40859c3a08b126c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions failing to start when a configured MCP server needs authentication.

  The codex binary writes tracing logs to stderr as normal operation, and the adapter escalated
  every stderr line to a fatal run error. An unauthenticated remote MCP server makes codex log an
  `rmcp` ERROR on every startup, so each Codex session died instantly with "Agent run failed"
  while the underlying run was healthy.

  stderr is now treated as a log stream. Real failures still surface: an unexpected non-zero exit
  reports its code along with the tail of recent stderr, so genuine startup crashes keep their
  diagnostics.

- Updated dependencies [[`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.7


### Minor Changes

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.


### Minor Changes

- [#452](https://github.com/qlan-ro/mainframe/pull/452) [`f4c77d4`](https://github.com/qlan-ro/mainframe/commit/f4c77d47241645b41c70c32dcb0f1b9b0727d886) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Overhaul UI typography and text-color legibility. Re-tint the tertiary/semantic ink tokens (mf-text-3, mf-success, mf-warning) across all six themes so they clear WCAG 4.5:1, reclassify mf-text-4 as ornament-only, and add a globals.css contrast guardrail test. Re-anchor the UI scale factors (compact 0.92 / normal 1.0 / large 1.15) so normal mode renders crisp un-zoomed 13px text and compact is legible. Repair shared primitives (button icon default, menu/dropdown/command eyebrows, tooltip size) and add CountBadge + SectionHeader. Sweep every surface to promote must-read text off 10–11px, move semantic hues off text onto icons/tints, replace the invisible white-on-accent count badges with capsule-less counts, and give session-row selection a macOS-style neutral fill. Fixes hundreds of contrast and small-text findings from the 2026-07-11 legibility audit.


## 2.0.0-rc.6


### Patch Changes

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911), [`d83749e`](https://github.com/qlan-ro/mainframe/commit/d83749e76ac48d5e87fbe1eaf539dea2908b084d)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.6
  - @qlan-ro/mainframe-core@2.0.0-rc.6


### Patch Changes

- [#445](https://github.com/qlan-ro/mainframe/pull/445) [`d83749e`](https://github.com/qlan-ro/mainframe/commit/d83749e76ac48d5e87fbe1eaf539dea2908b084d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tauri shell gains the `MAINFRAME_DAEMON_IMPL` canary flag: `rust` spawns the ported Rust daemon as an externalBin sidecar (with login-shell PATH, bundled-LSP env, identical supervision); `node` (default) keeps the existing Node sidecar untouched. The Rust binary is opt-in at build time — default `bundle`/`tauri:build` stays Node-only, and `bundle:canary`/`tauri:build:canary` (via the `tauri.rust-canary.conf.json` overlay) produces the dual-daemon build. See `docs/rust-port/CUTOVER.md` for the signing/notarization gate before shipping the canary publicly.

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911), [`aa2dce6`](https://github.com/qlan-ro/mainframe/commit/aa2dce69b38621395466777eabb5e9d0088fd17a)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.6


### Minor Changes

- [#448](https://github.com/qlan-ro/mainframe/pull/448) [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed).

### Patch Changes

- [#445](https://github.com/qlan-ro/mainframe/pull/445) [`d83749e`](https://github.com/qlan-ro/mainframe/commit/d83749e76ac48d5e87fbe1eaf539dea2908b084d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pre-port hardening for the daemon Rust migration: GitService now runs raw `git` subprocesses with in-repo porcelain parsers (simple-git removed), SQLite schema evolution moved to numbered `PRAGMA user_version` migrations, black-box HTTP oracle tests added for settings/launch/attachments/tags/todos, and the wire contract frozen as generated snapshots under `docs/rust-port/`.

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.6


### Minor Changes

- [#448](https://github.com/qlan-ro/mainframe/pull/448) [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed).


### Minor Changes

- [#448](https://github.com/qlan-ro/mainframe/pull/448) [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed).

### Patch Changes

- [#446](https://github.com/qlan-ro/mainframe/pull/446) [`aa2dce6`](https://github.com/qlan-ro/mainframe/commit/aa2dce69b38621395466777eabb5e9d0088fd17a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Style scrollbars globally instead of per-element. The warm thin scrollbar was an opt-in class covering 9 of 66 scroll containers; every other surface (markdown preview, diff viewers, workflows, tab panels, …) painted the native track — near-white under light themes and permanently visible with a mouse attached. Two @layer base rules now give every scroller the thin, hover-revealed, transparent-track treatment across all themes and schemes; [scrollbar-width:none] opt-outs still win, and the mf-thin-scrollbar class is removed.

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.6


## 2.0.0-rc.5


### Patch Changes

- Updated dependencies [[`4eab7ed`](https://github.com/qlan-ro/mainframe/commit/4eab7ed094a70d8c39087fb0590ca65067783ae1)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.5
  - @qlan-ro/mainframe-types@2.0.0-rc.5


### Patch Changes

- [#442](https://github.com/qlan-ro/mainframe/pull/442) [`4eab7ed`](https://github.com/qlan-ro/mainframe/commit/4eab7ed094a70d8c39087fb0590ca65067783ae1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop leaking the daemon on quit and fail loudly on port collisions. macOS quit paths (Cmd+Q, updater relaunch) end the run loop without destroying windows, so the window-Destroyed handler never killed the daemon — the orphan kept the port and the next launch's daemon died on EADDRINUSE with no log line, leaving the UI silently talking to an old, contract-skewed daemon. The Tauri shell now also kills the daemon on RunEvent::Exit, reaps the child (no zombie), and watches for unexpected daemon exits, surfacing them through daemon:status. The daemon surfaces bind failures as logged fatal errors and reports its pid via /health so a stale port owner can be identified with one curl.

- Updated dependencies [[`8189745`](https://github.com/qlan-ro/mainframe/commit/8189745d8deb596a8f9fc5480c88bb378f73ce51)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.5


### Patch Changes

- [#442](https://github.com/qlan-ro/mainframe/pull/442) [`4eab7ed`](https://github.com/qlan-ro/mainframe/commit/4eab7ed094a70d8c39087fb0590ca65067783ae1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop leaking the daemon on quit and fail loudly on port collisions. macOS quit paths (Cmd+Q, updater relaunch) end the run loop without destroying windows, so the window-Destroyed handler never killed the daemon — the orphan kept the port and the next launch's daemon died on EADDRINUSE with no log line, leaving the UI silently talking to an old, contract-skewed daemon. The Tauri shell now also kills the daemon on RunEvent::Exit, reaps the child (no zombie), and watches for unexpected daemon exits, surfacing them through daemon:status. The daemon surfaces bind failures as logged fatal errors and reports its pid via /health so a stale port owner can be identified with one curl.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.5


### Patch Changes

- [#443](https://github.com/qlan-ro/mainframe/pull/443) [`8189745`](https://github.com/qlan-ro/mainframe/commit/8189745d8deb596a8f9fc5480c88bb378f73ce51) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the sessions-list scrollbar and pinned group headers. The mf-thin-scrollbar class mixed the standards scrollbar properties with ::-webkit-scrollbar rules; engines that honor the standard properties ignore the webkit rules, letting the native white classic scrollbar paint on warm panels — the class now uses the standards path only (thin, transparent, thumb on hover). Pinned group headers no longer show row content through them: the scroller's top padding opened a see-through band above the sticky header, and WKWebView's backdrop-filter does not reliably blur sibling rows scrolled beneath it — the pinned host now composites the glass tint over an opaque base. Also restores the sessions-list-scroll test hook that Virtuoso's own data-testid was overriding.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.5


## 2.0.0-rc.4


### Patch Changes

- Updated dependencies [[`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52), [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385), [`a38f85f`](https://github.com/qlan-ro/mainframe/commit/a38f85fde5382c0e2c34543abaab08941fc470cd), [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa), [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f), [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b), [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f), [`48de6cd`](https://github.com/qlan-ro/mainframe/commit/48de6cdc1217e2641d38ba85e612d73c8430382a), [`84a3788`](https://github.com/qlan-ro/mainframe/commit/84a37888837a52096d8e6efb581ed1683332a3e4), [`f2fa02c`](https://github.com/qlan-ro/mainframe/commit/f2fa02c9312719951eef2f2a7384deb1476f98ef)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.4
  - @qlan-ro/mainframe-core@2.0.0-rc.4


### Patch Changes

- [#440](https://github.com/qlan-ro/mainframe/pull/440) [`7164eb1`](https://github.com/qlan-ro/mainframe/commit/7164eb161e7a0d295bf61aef8f894e9b8c4bc237) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix chat-transcript links doing nothing in the Tauri shell. The `opener:allow-open-url` capability was a bare permission string, which enables the command but grants no URL scope, so tauri-plugin-opener rejected every click. Scope it to http/https/mailto/tel plus the app schemes the markdown renderer linkifies (slack, vscode, cursor, zed, figma, linear, notion, …), and add a release-safety test that fails if the scope regresses to the bare string.

- [#426](https://github.com/qlan-ro/mainframe/pull/426) [`1afe5a6`](https://github.com/qlan-ro/mainframe/commit/1afe5a6dd5310e633125a6e7e694eb673bff3765) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix remote-daemon pairing: auth tokens now actually persist. `keyring 3.x` needs an explicit backend feature — without one it silently uses an in-memory mock store, so `daemon_token_get` always returned `None` and the renderer opened the daemon WebSocket with no `?token=`, getting rejected ("invalid or missing token"). The app looked "connected" (HTTP/health work) but never loaded projects/chats. Enable the real OS credential stores (`apple-native`, `windows-native`, `sync-secret-service`). No entitlement change needed — a signed, non-sandboxed macOS app accesses its own login-keychain items without `keychain-access-groups`.

  Also make token storage fail loudly: `daemon_token_set` now returns a `Result` instead of swallowing keyring write failures, and the Add-remote dialog surfaces a distinct "couldn't save the credential" error instead of reporting a paired-but-tokenless connection as success.

- [#436](https://github.com/qlan-ro/mainframe/pull/436) [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview and external-file surfaces: out-of-project chat file paths now open read-only instead of erroring, reopened external files stay read-only, and the Tauri preview child-webview no longer races or leaks orphans on rapid create/destroy or device-toggle remounts.

- Updated dependencies [[`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385), [`7164eb1`](https://github.com/qlan-ro/mainframe/commit/7164eb161e7a0d295bf61aef8f894e9b8c4bc237), [`31746db`](https://github.com/qlan-ro/mainframe/commit/31746db8e4bcc7cd2a9188077e2ec8bcb0b87a78), [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f), [`107cff9`](https://github.com/qlan-ro/mainframe/commit/107cff978b41e8ffe0ec0eeebefd0577368e047e), [`2b65fc4`](https://github.com/qlan-ro/mainframe/commit/2b65fc440997fb91bcc901e45734e185ac2a4151), [`8c3c4b1`](https://github.com/qlan-ro/mainframe/commit/8c3c4b1cd1abdc012eaebfa41ad56180d3a9d56f), [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b), [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f), [`b1e1798`](https://github.com/qlan-ro/mainframe/commit/b1e179861f28e988a5a666252534c5110de88392), [`761367d`](https://github.com/qlan-ro/mainframe/commit/761367db526cc999dd8488ad24148ebe7a073bff), [`f6b4b36`](https://github.com/qlan-ro/mainframe/commit/f6b4b36d2a330b8da39dd27acc1f5894b1005613), [`ec7cca7`](https://github.com/qlan-ro/mainframe/commit/ec7cca73c60c238cec57f5e1606377a21751314b), [`7127094`](https://github.com/qlan-ro/mainframe/commit/7127094834d0d13a3920ccaf8fa9cac4de0018ee), [`db6a25d`](https://github.com/qlan-ro/mainframe/commit/db6a25d4f1725447842b5ad35df152d6854caeda), [`f2fa02c`](https://github.com/qlan-ro/mainframe/commit/f2fa02c9312719951eef2f2a7384deb1476f98ef)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.4


### Minor Changes

- [#425](https://github.com/qlan-ro/mainframe/pull/425) [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface background work (subagents, background bash tasks, workflows) in the working indicator: the tracker registers every CLI task kind, `enrichChat` broadens the sidebar 'working' state and attaches a `backgroundActivity` payload, drain turns re-enter 'working', and a new BackgroundActivityBar chip above the composer lists live tasks.

- [#430](https://github.com/qlan-ro/mainframe/pull/430) [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make chat title generation adapter-aware and import Codex sessions from disk. Title generation now runs behind an optional `Adapter.generateTitle` (Claude implements it; Codex keeps its deterministic first-message title instead of cross-spawning the `claude` binary). Codex external-session import scans the rollout JSONL files under `~/.codex/sessions` — matching a session to a project by its recorded `cwd` — so sessions started outside Mainframe show up too.

- [#424](https://github.com/qlan-ro/mainframe/pull/424) [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect deleted CLI transcripts and unify degraded-chat recovery: a persisted `transcriptMissing` flag (new `transcript_missing` column) reconciled on history load and on the periodic scan, a typed `{ messages, transcriptMissing }` history payload, recovery routes (recreate-worktree, continue-here, continue-in-project-root), and one degraded-chat card in the thread replacing the composer worktree banner, with a unified sidebar marker.

### Patch Changes

- [#441](https://github.com/qlan-ro/mainframe/pull/441) [`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep adapter model catalogs aligned with installed CLIs: Codex discovery now uses the configured executable, unset Codex models inherit the account default, Claude removes the explicit alias that duplicates its semantic default, and stale saved provider defaults no longer leak raw model ids into new chats.

- [#431](https://github.com/qlan-ro/mainframe/pull/431) [`a38f85f`](https://github.com/qlan-ro/mainframe/commit/a38f85fde5382c0e2c34543abaab08941fc470cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reap orphaned child processes on daemon startup and crash so neither a quick-tunnel child nor a launch-config dev server (and its process tree) keeps running after the daemon that spawned it dies. Tunnel and launch pids share one pidfile registry; the startup sweep only kills a live pid whose recorded command and cwd still match, and kills launch children by their process group so wrapper grandchildren (pnpm → vite → esbuild) die too. A launch child's identity is its live `ps` command line captured at spawn — the kernel rewrites argv for a `#!` script (`pnpm` shows as `node .../pnpm run dev`), so recording the bare executable would never match and leak the tree. Delivery escalates SIGTERM → grace → SIGKILL for orphans that ignore the term.

- [#423](https://github.com/qlan-ro/mainframe/pull/423) [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the context meter over-reporting (stuck near 100%): persist the CLI-reported context totals on the chat row and prefer them over the catalog-window estimate; resolve probed model windows via each entry's own resolvedModel; stop subagent, synthetic zero-usage, and cumulative result usage from corrupting the stored context size.

- [#436](https://github.com/qlan-ro/mainframe/pull/436) [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview and external-file surfaces: out-of-project chat file paths now open read-only instead of erroring, reopened external files stay read-only, and the Tauri preview child-webview no longer races or leaks orphans on rapid create/destroy or device-toggle remounts.

- [#432](https://github.com/qlan-ro/mainframe/pull/432) [`48de6cd`](https://github.com/qlan-ro/mainframe/commit/48de6cdc1217e2641d38ba85e612d73c8430382a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session Context panel: report global CLAUDE.md/AGENTS.md with their real openable ~/.claude path, and stop listing duplicate skills and CLAUDE.md entries.

- [#419](https://github.com/qlan-ro/mainframe/pull/419) [`84a3788`](https://github.com/qlan-ro/mainframe/commit/84a37888837a52096d8e6efb581ed1683332a3e4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix subagent messages leaking into the main chat: partition task children by parentToolUseId (parallel and non-contiguous Tasks group correctly), end explore/progress grouping at subagent boundaries, surface in-content child tool_results, and suppress empty signature-only thinking blocks.

- [#433](https://github.com/qlan-ro/mainframe/pull/433) [`f2fa02c`](https://github.com/qlan-ro/mainframe/commit/f2fa02c9312719951eef2f2a7384deb1476f98ef) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep live file-watching reliable and stop a spurious boot-time CSP error. The editor now re-subscribes its file watches on every WebSocket reconnect and the daemon re-arms watchers after inode-replacing (atomic) saves, so external edits keep reaching the open editor and the disk-conflict banner now also shows for markdown files. The client no longer opens a doomed `ws://127.0.0.1:0` connection before the daemon target is seeded.

- Updated dependencies [[`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52), [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385), [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa), [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f), [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b), [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.4


### Minor Changes

- [#425](https://github.com/qlan-ro/mainframe/pull/425) [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface background work (subagents, background bash tasks, workflows) in the working indicator: the tracker registers every CLI task kind, `enrichChat` broadens the sidebar 'working' state and attaches a `backgroundActivity` payload, drain turns re-enter 'working', and a new BackgroundActivityBar chip above the composer lists live tasks.

- [#430](https://github.com/qlan-ro/mainframe/pull/430) [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make chat title generation adapter-aware and import Codex sessions from disk. Title generation now runs behind an optional `Adapter.generateTitle` (Claude implements it; Codex keeps its deterministic first-message title instead of cross-spawning the `claude` binary). Codex external-session import scans the rollout JSONL files under `~/.codex/sessions` — matching a session to a project by its recorded `cwd` — so sessions started outside Mainframe show up too.

- [#424](https://github.com/qlan-ro/mainframe/pull/424) [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect deleted CLI transcripts and unify degraded-chat recovery: a persisted `transcriptMissing` flag (new `transcript_missing` column) reconciled on history load and on the periodic scan, a typed `{ messages, transcriptMissing }` history payload, recovery routes (recreate-worktree, continue-here, continue-in-project-root), and one degraded-chat card in the thread replacing the composer worktree banner, with a unified sidebar marker.

### Patch Changes

- [#441](https://github.com/qlan-ro/mainframe/pull/441) [`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep adapter model catalogs aligned with installed CLIs: Codex discovery now uses the configured executable, unset Codex models inherit the account default, Claude removes the explicit alias that duplicates its semantic default, and stale saved provider defaults no longer leak raw model ids into new chats.

- [#423](https://github.com/qlan-ro/mainframe/pull/423) [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the context meter over-reporting (stuck near 100%): persist the CLI-reported context totals on the chat row and prefer them over the catalog-window estimate; resolve probed model windows via each entry's own resolvedModel; stop subagent, synthetic zero-usage, and cumulative result usage from corrupting the stored context size.

- [#436](https://github.com/qlan-ro/mainframe/pull/436) [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview and external-file surfaces: out-of-project chat file paths now open read-only instead of erroring, reopened external files stay read-only, and the Tauri preview child-webview no longer races or leaks orphans on rapid create/destroy or device-toggle remounts.


### Minor Changes

- [#425](https://github.com/qlan-ro/mainframe/pull/425) [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface background work (subagents, background bash tasks, workflows) in the working indicator: the tracker registers every CLI task kind, `enrichChat` broadens the sidebar 'working' state and attaches a `backgroundActivity` payload, drain turns re-enter 'working', and a new BackgroundActivityBar chip above the composer lists live tasks.

- [#424](https://github.com/qlan-ro/mainframe/pull/424) [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect deleted CLI transcripts and unify degraded-chat recovery: a persisted `transcriptMissing` flag (new `transcript_missing` column) reconciled on history load and on the periodic scan, a typed `{ messages, transcriptMissing }` history payload, recovery routes (recreate-worktree, continue-here, continue-in-project-root), and one degraded-chat card in the thread replacing the composer worktree banner, with a unified sidebar marker.

### Patch Changes

- [#440](https://github.com/qlan-ro/mainframe/pull/440) [`7164eb1`](https://github.com/qlan-ro/mainframe/commit/7164eb161e7a0d295bf61aef8f894e9b8c4bc237) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix chat-transcript links doing nothing in the Tauri shell. The `opener:allow-open-url` capability was a bare permission string, which enables the command but grants no URL scope, so tauri-plugin-opener rejected every click. Scope it to http/https/mailto/tel plus the app schemes the markdown renderer linkifies (slack, vscode, cursor, zed, figma, linear, notion, …), and add a release-safety test that fails if the scope regresses to the bare string.

- [#439](https://github.com/qlan-ro/mainframe/pull/439) [`31746db`](https://github.com/qlan-ro/mainframe/commit/31746db8e4bcc7cd2a9188077e2ec8bcb0b87a78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Console launch tabs use the SquareTerminal glyph (CLI console) instead of ScrollText

- [#429](https://github.com/qlan-ro/mainframe/pull/429) [`107cff9`](https://github.com/qlan-ro/mainframe/commit/107cff978b41e8ffe0ec0eeebefd0577368e047e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the double vertical scrollbar on chat tool cards: Bash, Read, Edit, Write, Plan, Search, Skill, and Schedule cards no longer nest their own `overflow-y-auto` region inside the thread viewport, so only the thread scrolls vertically while wide code and terminal lines still scroll horizontally.

- [#435](https://github.com/qlan-ro/mainframe/pull/435) [`2b65fc4`](https://github.com/qlan-ro/mainframe/commit/2b65fc440997fb91bcc901e45734e185ac2a4151) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reflect a new session's worktree and branch choice before the first message is sent.

  A new-session draft has no daemon chat yet, so the titlebar branch chip, worktree popover, and file tree used to fall back to the project root while you composed — hiding the branch you picked. The active identity now resolves from the seeded draft config, so those surfaces show the chosen branch and worktree pre-send, and the choice carries into chat creation on first send: an existing worktree attaches with the new chat, and a new worktree is created before the CLI spawns.

- [#420](https://github.com/qlan-ro/mainframe/pull/420) [`8c3c4b1`](https://github.com/qlan-ro/mainframe/commit/8c3c4b1cd1abdc012eaebfa41ad56180d3a9d56f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the editor jumping to the top when an open file is refreshed after an external change: applyValueUpdate now dispatches a minimal diff instead of replacing the whole document, so CodeMirror's scroll anchoring and selection mapping survive the reload.

- [#423](https://github.com/qlan-ro/mainframe/pull/423) [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the context meter over-reporting (stuck near 100%): persist the CLI-reported context totals on the chat row and prefer them over the catalog-window estimate; resolve probed model windows via each entry's own resolvedModel; stop subagent, synthetic zero-usage, and cumulative result usage from corrupting the stored context size.

- [#436](https://github.com/qlan-ro/mainframe/pull/436) [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview and external-file surfaces: out-of-project chat file paths now open read-only instead of erroring, reopened external files stay read-only, and the Tauri preview child-webview no longer races or leaks orphans on rapid create/destroy or device-toggle remounts.

- [#421](https://github.com/qlan-ro/mainframe/pull/421) [`b1e1798`](https://github.com/qlan-ro/mainframe/commit/b1e179861f28e988a5a666252534c5110de88392) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the empty preview surface after starting a New Session: the first send now selects the newly created session automatically, so a running preview on the same project/branch re-attaches without a manual sidebar click.

- [#438](https://github.com/qlan-ro/mainframe/pull/438) [`761367d`](https://github.com/qlan-ro/mainframe/commit/761367db526cc999dd8488ad24148ebe7a073bff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix dark-theme scrollbars: declare color-scheme and repair the mf-thin-scrollbar styling so surfaces no longer paint a white native track.

- [#434](https://github.com/qlan-ro/mainframe/pull/434) [`f6b4b36`](https://github.com/qlan-ro/mainframe/commit/f6b4b36d2a330b8da39dd27acc1f5894b1005613) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface a Stop in the toolbar for any running launch config, even one started outside the toolbar.

- [#437](https://github.com/qlan-ro/mainframe/pull/437) [`ec7cca7`](https://github.com/qlan-ro/mainframe/commit/ec7cca73c60c238cec57f5e1606377a21751314b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Refetch todos when the Tasks modal or quick-add opens so it shows current data instead of boot-time statuses.

- [#428](https://github.com/qlan-ro/mainframe/pull/428) [`7127094`](https://github.com/qlan-ro/mainframe/commit/7127094834d0d13a3920ccaf8fa9cac4de0018ee) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Batch of chat and editor fixes: make console log output selectable, keep the thinking indicator inline after the last message, allow expanding in-progress bash tool cards, prefill the composer when running a todo in a session, and add an agent-annotation comment gutter to the diff viewer.

- [#422](https://github.com/qlan-ro/mainframe/pull/422) [`db6a25d`](https://github.com/qlan-ro/mainframe/commit/db6a25d4f1725447842b5ad35df152d6854caeda) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the worktree chip icons staying stale after joining or creating a worktree: the composer config mirror now adopts chat updates that change only worktreePath/branchName, and the shell identity (titlebar branch chip, chat header, branch popover) re-derives custom from the remoteId-keyed thread entry so sessions created in the current app run update too.

- [#433](https://github.com/qlan-ro/mainframe/pull/433) [`f2fa02c`](https://github.com/qlan-ro/mainframe/commit/f2fa02c9312719951eef2f2a7384deb1476f98ef) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep live file-watching reliable and stop a spurious boot-time CSP error. The editor now re-subscribes its file watches on every WebSocket reconnect and the daemon re-arms watchers after inode-replacing (atomic) saves, so external edits keep reaching the open editor and the disk-conflict banner now also shows for markdown files. The client no longer opens a doomed `ws://127.0.0.1:0` connection before the daemon target is seeded.

- Updated dependencies [[`b717a3f`](https://github.com/qlan-ro/mainframe/commit/b717a3fe7313ec68efff25cdf6b1fe5c7eca9d52), [`0e747c2`](https://github.com/qlan-ro/mainframe/commit/0e747c29e5c69b915df5157812c3841318d74385), [`08c03b1`](https://github.com/qlan-ro/mainframe/commit/08c03b1686ed860c340629975b9bdcd7d324c9aa), [`280edfc`](https://github.com/qlan-ro/mainframe/commit/280edfca572c06095b89d775cf866c76a81f280f), [`9c724e6`](https://github.com/qlan-ro/mainframe/commit/9c724e6d3a87433b5e59ccab2b7064dde602772b), [`a5afda5`](https://github.com/qlan-ro/mainframe/commit/a5afda52bf5d0951f3efb7e19e1f7f4c8307b77f)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.4


## 2.0.0-rc.3


### Patch Changes

- Updated dependencies [[`f3754e6`](https://github.com/qlan-ro/mainframe/commit/f3754e69e123930d4ec78604f6332632e81117f0)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.3
  - @qlan-ro/mainframe-types@2.0.0-rc.3


### Patch Changes

- [#411](https://github.com/qlan-ro/mainframe/pull/411) [`f3754e6`](https://github.com/qlan-ro/mainframe/commit/f3754e69e123930d4ec78604f6332632e81117f0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix packaged Tauri daemon launch defaults so clean app launches use port 31415 and the default Mainframe data directory unless explicitly overridden.

- [#412](https://github.com/qlan-ro/mainframe/pull/412) [`704799b`](https://github.com/qlan-ro/mainframe/commit/704799b92dcd3341b729e3e6e06d761314af2312) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview capture toolbar in the Tauri app. Inspect-element and region-capture never worked: the preview child webview loads a remote origin, so Tauri's ACL silently denied every callback it invoked (picker results, navigation tracking, external-link opening). Those four callbacks now live in an inlined `preview-bridge` plugin granted to `preview-*` webviews via a remote capability. Screenshot annotation showed a blank preview in packaged builds: the production CSP blocked `data:` images, hiding the freeze-frame backdrop and capture thumbnails — `img-src` now allows `data:`. The annotation dialog also rendered _behind_ the live preview: a recreated webview is shown by default, but the visibility hook's dedup cache still held the old webview's state and suppressed the `setVisible(false)` that hides it — so the native webview composited over the annotation UI until a reload. The cache now resets whenever the webview is recreated.

  The capture toolbar's inspect/region/screenshot state is also cleaned up: inspect and region are now mutually exclusive toggles (selecting one cancels the other, clicking the active one turns it off, and a completed pick clears it), and the Restart glyph no longer duplicates the URL-bar reload icon. "Open in browser" now opens the current preview URL in the OS browser instead of silently re-navigating the embedded webview, and "Clear cache" clears the webview's Cache-API/storage entries and reloads instead of doing a plain navigate. The toggle-off teardown and "Clear cache" are implemented on both hosts (Tauri and Electron); on Electron, Clear cache also reloads bypassing the HTTP cache. Separately, an empty Run surface now keeps its split/close controls instead of hiding them behind the picker.

- Updated dependencies [[`1e376ba`](https://github.com/qlan-ro/mainframe/commit/1e376babf480d38b43d723cfbe32c18b78c226b3), [`704799b`](https://github.com/qlan-ro/mainframe/commit/704799b92dcd3341b729e3e6e06d761314af2312), [`48218b7`](https://github.com/qlan-ro/mainframe/commit/48218b7e4654ad592ad361b0c5c67fe27e57cf7f)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.3


### Patch Changes

- [#411](https://github.com/qlan-ro/mainframe/pull/411) [`f3754e6`](https://github.com/qlan-ro/mainframe/commit/f3754e69e123930d4ec78604f6332632e81117f0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the packaged Tauri app hanging on "waiting for daemon". The daemon's CORS
  allowlist only accepted `http(s)://localhost|127.0.0.1` origins, so it never
  returned `Access-Control-Allow-Origin` for the packaged Tauri webview, whose
  page is served from the `tauri://localhost` custom scheme (`http://tauri.localhost`
  on Windows). WKWebView then blocked every daemon response as a CORS error and the
  renderer's `/health` poll could never succeed — even though the daemon was healthy.
  The allowlist now includes the Tauri webview origins.
- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.3


### Patch Changes

- [#418](https://github.com/qlan-ro/mainframe/pull/418) [`1e376ba`](https://github.com/qlan-ro/mainframe/commit/1e376babf480d38b43d723cfbe32c18b78c226b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Always show the branch chip in the titlebar, for main-repo sessions too.

  The toolbar branch chip used to render only for worktree sessions, because it derived its label from the persisted `chat.branchName`, which is set only when a session runs in a worktree. It now reads the live current branch from git on mount, so a session on the shared main repo shows and can switch its branch as well. Matching the Workspace Surfaces artboard, a worktree session gets an accent-tinted chip with a fork glyph and a "WT" badge, while a main-repo session stays neutral; the tooltip names which.

- [#412](https://github.com/qlan-ro/mainframe/pull/412) [`704799b`](https://github.com/qlan-ro/mainframe/commit/704799b92dcd3341b729e3e6e06d761314af2312) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the preview capture toolbar in the Tauri app. Inspect-element and region-capture never worked: the preview child webview loads a remote origin, so Tauri's ACL silently denied every callback it invoked (picker results, navigation tracking, external-link opening). Those four callbacks now live in an inlined `preview-bridge` plugin granted to `preview-*` webviews via a remote capability. Screenshot annotation showed a blank preview in packaged builds: the production CSP blocked `data:` images, hiding the freeze-frame backdrop and capture thumbnails — `img-src` now allows `data:`. The annotation dialog also rendered _behind_ the live preview: a recreated webview is shown by default, but the visibility hook's dedup cache still held the old webview's state and suppressed the `setVisible(false)` that hides it — so the native webview composited over the annotation UI until a reload. The cache now resets whenever the webview is recreated.

  The capture toolbar's inspect/region/screenshot state is also cleaned up: inspect and region are now mutually exclusive toggles (selecting one cancels the other, clicking the active one turns it off, and a completed pick clears it), and the Restart glyph no longer duplicates the URL-bar reload icon. "Open in browser" now opens the current preview URL in the OS browser instead of silently re-navigating the embedded webview, and "Clear cache" clears the webview's Cache-API/storage entries and reloads instead of doing a plain navigate. The toggle-off teardown and "Clear cache" are implemented on both hosts (Tauri and Electron); on Electron, Clear cache also reloads bypassing the HTTP cache. Separately, an empty Run surface now keeps its split/close controls instead of hiding them behind the picker.

- [#416](https://github.com/qlan-ro/mainframe/pull/416) [`48218b7`](https://github.com/qlan-ro/mainframe/commit/48218b7e4654ad592ad361b0c5c67fe27e57cf7f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace session status dots with provider logos and keep unread attention state independent of notification preferences.

  Session rows now show provider-specific logos, use full-color/animated states for working and waiting sessions, and keep unread styling keyed to both stable thread ids and daemon chat ids. Pending permissions, waiting sessions, and completed/error lifecycle updates now mark background sessions unread even when OS notifications are disabled. Read session titles use normal foreground styling, while unread titles use a heavier weight.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.3


## 2.0.0-rc.2


### Patch Changes

- Updated dependencies [[`f3e63b6`](https://github.com/qlan-ro/mainframe/commit/f3e63b6e3151b2dcd76b0ed737a1e3734677369f)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.2
  - @qlan-ro/mainframe-types@2.0.0-rc.2


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-ui@2.0.0-rc.2


### Minor Changes

- [#408](https://github.com/qlan-ro/mainframe/pull/408) [`f3e63b6`](https://github.com/qlan-ro/mainframe/commit/f3e63b6e3151b2dcd76b0ed737a1e3734677369f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface the daemon version. `mainframe --version` (also `-v` / `version`) prints
  the installed binary's version, `mainframe status` shows the **running** daemon's
  version, and `GET /health` now returns a `version` field. The version is inlined
  into the bundle at build time (esbuild `define`), with a `package.json` fallback
  for dev and unbundled runs.

### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.2


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.2


## 2.0.0-rc.1


### Patch Changes

- Updated dependencies [[`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f), [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f)]:
  - @qlan-ro/mainframe-core@2.0.0-rc.1
  - @qlan-ro/mainframe-types@2.0.0-rc.1


### Patch Changes

- Updated dependencies [[`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d), [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d), [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.1


### Minor Changes

- [#405](https://github.com/qlan-ro/mainframe/pull/405) [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename the daemon CLI to `mainframe` and add a `mainframe update` command.

  The standalone binary is now `mainframe` (the old `mainframe-daemon` name still
  ships as an alias, so existing systemd units keep working). `mainframe update`
  upgrades a standalone install in place: it downloads the matching release tarball
  for the host platform and unpacks it over `~/.mainframe/bin`. Supports
  `--pre` (include pre-releases), `--version <tag>`, and `--dir <path>`; the daemon
  keeps serving until you restart it.

### Patch Changes

- [#405](https://github.com/qlan-ro/mainframe/pull/405) [`9ca92ef`](https://github.com/qlan-ro/mainframe/commit/9ca92ef6fa1823f3466a9402c05152c60541b10f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the standalone daemon tarball (the `linux`/`darwin` release artifacts installed
  via `scripts/install.sh`) so it ships a complete `node_modules` sibling to
  `daemon.cjs`. Previously `build-standalone.sh` only copied better-sqlite3's raw
  `.node` binary, so the bundled daemon's `require('better-sqlite3')` (and the LSP
  servers + ripgrep) could not resolve and the daemon failed to start with
  `Cannot find module 'better-sqlite3'`. The standalone build now uses the same
  dependency collector as the Tauri sidecar bundler.
- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.1


### Patch Changes

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix archiving the active session dumping you on the empty new-session screen.

  assistant-ui's remote thread list calls `switchToNewThread()` off the archived
  thread _before_ marking it archived, so `mainThreadId` becomes a fresh
  `__LOCALID_*` draft and the existing archived-active fallback (which keyed on the
  active thread still being archived) never fired. The session router now remembers
  the last real (non-draft) thread and, when an archive bumps you onto an empty
  draft, redirects to a fallback session — the last-used one if still live, else
  the most-recently-updated non-archived session, respecting the active project
  filter. A deliberate "New" leaves the previous session regular, so it is not
  redirected.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix background sessions losing messages while another chat is open.

  A chat's live WS subscription is gated to the active thread, so a backgrounded
  chat receives no message events while dormant — the daemon still persists them,
  but the transcript stayed frozen at the pre-dormancy snapshot. On `subscribe:ack`
  the catch-up re-seed only fired for a socket reconnect or an unreconciled
  optimistic send, so simply switching back to a chat never healed the gap and the
  messages that arrived while it was backgrounded stayed invisible until a full
  reconnect.

  The controller now tracks when a live sub is torn down and treats the next
  attach as a post-dormancy reattach, re-seeding history from REST on the reattach
  ack (like a reconnect). Row-level unread notifications were unaffected — they run
  on a separate always-on session-list subscription — so this only restores the
  missed transcript content on switch-back.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix two session/editor UX bugs:
  - Selecting a project filter with no sessions now opens a new-session draft
    instead of stranding the previously-selected session from another project.
  - The Markdown preview is now selectable, so its prose can be copied — the
    `mf-editor-selectable` opt-in class was referenced by the editor surfaces but
    never defined in the selection whitelist.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.1


## 1.0.0


### Major Changes

- [#389](https://github.com/qlan-ro/mainframe/pull/389) [`d1dff85`](https://github.com/qlan-ro/mainframe/commit/d1dff8583876f611e2d9399359b7eeb685e11927) Thanks [@doruchiulan](https://github.com/doruchiulan)! - First stable release: graduate the desktop app, core, and types from 0.x to 1.0.0. This marks the Electron desktop line as stable ahead of the 2.0 Tauri major.

### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@1.0.0


### Patch Changes

- Updated dependencies [[`d1dff85`](https://github.com/qlan-ro/mainframe/commit/d1dff8583876f611e2d9399359b7eeb685e11927)]:
  - @qlan-ro/mainframe-core@1.0.0
  - @qlan-ro/mainframe-types@1.0.0


## 0.22.2


### Patch Changes

- [#385](https://github.com/qlan-ro/mainframe/pull/385) [`193663d`](https://github.com/qlan-ro/mainframe/commit/193663df57881320dd264dccce26ae3df0f14d39) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Start the daemon before reconciling recovered Claude background tasks, and broadcast recovered tasks to connected clients once reconciliation completes.

- [#384](https://github.com/qlan-ro/mainframe/pull/384) [`6479309`](https://github.com/qlan-ro/mainframe/commit/6479309395716d1844e3ea3562148612b612d2b4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Handle Codex app-server JSON-RPC messages that include trailing stdout bytes on the same line instead of dropping the notification as malformed.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.22.2


### Patch Changes

- Updated dependencies [[`193663d`](https://github.com/qlan-ro/mainframe/commit/193663df57881320dd264dccce26ae3df0f14d39), [`6479309`](https://github.com/qlan-ro/mainframe/commit/6479309395716d1844e3ea3562148612b612d2b4)]:
  - @qlan-ro/mainframe-core@0.22.2
  - @qlan-ro/mainframe-types@0.22.2


## 0.22.1


### Patch Changes

- [#380](https://github.com/qlan-ro/mainframe/pull/380) [`c3136b3`](https://github.com/qlan-ro/mainframe/commit/c3136b30c423c6b0bb147bfa0555d511256c31ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions failing immediately with "Session ended unexpectedly". Non-fast turns were sending `serviceTier: 'flex'`, which models like gpt-5.5 reject with `400 Unsupported service_tier: flex`. The fast toggle now sends `serviceTier: 'fast'` only when on, and omits the field otherwise so Codex uses the account default tier. The failure reason from a failed Codex turn is now logged and surfaced in the error card instead of the generic message.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.22.1


### Patch Changes

- Updated dependencies [[`c3136b3`](https://github.com/qlan-ro/mainframe/commit/c3136b30c423c6b0bb147bfa0555d511256c31ca)]:
  - @qlan-ro/mainframe-core@0.22.1
  - @qlan-ro/mainframe-types@0.22.1


## 0.22.0


### Minor Changes

- [#378](https://github.com/qlan-ro/mainframe/pull/378) [`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dynamic per-model effort levels + fast/ultracode/adaptive-thinking flags (composer) and Codex personality/reasoning-summary (provider settings), driven by each adapter's advertised capabilities instead of hardcoded lists. Claude applies tuning via `apply_flag_settings` (no `--effort`, which would install a masking permission layer); Codex via `turn/start`. Per-chat knobs inherit provider defaults (null = inherit, resolved once at spawn/apply).

### Patch Changes

- Updated dependencies [[`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0)]:
  - @qlan-ro/mainframe-types@0.22.0


### Minor Changes

- [#378](https://github.com/qlan-ro/mainframe/pull/378) [`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dynamic per-model effort levels + fast/ultracode/adaptive-thinking flags (composer) and Codex personality/reasoning-summary (provider settings), driven by each adapter's advertised capabilities instead of hardcoded lists. Claude applies tuning via `apply_flag_settings` (no `--effort`, which would install a masking permission layer); Codex via `turn/start`. Per-chat knobs inherit provider defaults (null = inherit, resolved once at spawn/apply).

### Patch Changes

- Updated dependencies [[`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0)]:
  - @qlan-ro/mainframe-types@0.22.0
  - @qlan-ro/mainframe-core@0.22.0


### Minor Changes

- [#378](https://github.com/qlan-ro/mainframe/pull/378) [`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dynamic per-model effort levels + fast/ultracode/adaptive-thinking flags (composer) and Codex personality/reasoning-summary (provider settings), driven by each adapter's advertised capabilities instead of hardcoded lists. Claude applies tuning via `apply_flag_settings` (no `--effort`, which would install a masking permission layer); Codex via `turn/start`. Per-chat knobs inherit provider defaults (null = inherit, resolved once at spawn/apply).


## 0.21.0


### Minor Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Migrate the stateless chat commands from WebSocket to REST. `chat.create`, `chat.updateConfig`, `chat.interrupt`, `chat.resume`, and the queued-message edit/cancel are now REST endpoints (`POST /api/chats`, `PATCH /api/chats/:id/config`, `POST /api/chats/:id/{interrupt,resume}`, `PATCH`/`DELETE /api/chats/:id/queue/:messageId`) returning the canonical envelope; the dead `chat.end` command is removed. The WebSocket is reserved for streaming and server-push — the 7 migrated inbound handlers and their `ClientEvent` variants are gone, so unsupported sends fail at compile time. A new `subscribe:ack` lets clients confirm a subscription is registered before resuming. `chat.created` is now a pure list-sync upsert (navigation is driven by the REST caller), and the `originClientId` attribution hack is removed. Hard cutover: the desktop client is migrated in this change; the mobile client ships the matching change in its own repo.

### Patch Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove the unused `chatId` parameter from `createWorktree`. The argument was never read by the function body; callers in `config-manager` and the worktree tests are updated to the four-argument signature.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove the unused `getPreviewUrl` export from the launch module. It had no production callers — preview URLs are derived independently by the status handler — so the function, its barrel export, and its tests are deleted.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Extract PR/MR URL detection out of the Claude adapter's `events.ts` into a dedicated `pr-detection.ts` module. The regexes, command matchers, and URL parsers (`parsePrUrl`, `extractPrFromToolResult`, `isPrMutationCommand`, etc.) are a self-contained concern from event dispatch and already have their own test coverage; `events.ts` now imports them back. No behavior change.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Extract the shared subagent block-flattening loop in the Claude history reconstruction into one `appendAssistantBlocks` helper. `collectAgentProgressTools` and `collectSubagentAssistantBlocks` derive their parentId/content differently but appended the tool_use/text/thinking blocks with byte-for-byte identical code; that logic now lives in one place. No behavior change.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Collapse the four copy-pasted capability-guard Proxy blocks in `buildPluginContext` (db, attachments, events, ui) into a single `gated(enabled, capLabel, build)` helper. Same gating behavior — the real subsystem when its capability is declared, otherwise a Proxy whose methods throw the capability error.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Copy-paste consolidation in core (behavior-preserving):
  - `PluginManager`: extract the shared router-mount + `buildPluginContext` block from `loadBuiltin` and `loadPlugin` into a private `buildPluginRuntime` helper. The two paths still differ only in how they obtain the manifest and activate function; ordering and side effects are unchanged.
  - `ChatConfigManager`: extract `requireActiveChat` (getActiveChat + throw), `detachSession` (kill spawned session + null), and `applyWorktreeUpdate` (set path/branch + db update + emit) helpers, removing the same blocks copy-pasted across `updateChatConfig`/`enableWorktree`/`attachWorktree`/`disableWorktree`.
  - `ClaudeSession`: extract a `buildControlRequest` helper that owns the control_request envelope and a single `nanoid` request-id generator, replacing seven hand-rolled payloads that mixed `crypto.randomUUID` and `nanoid`.
  - Routes: add `resolveReadablePath` to `path-utils` (project-validated path, falling back to `~/.claude/`) and use it from the project-files and session-file read handlers, which previously inlined the identical dual-resolution.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Decompose the Claude adapter's `events.ts` (618 lines) by lifting the two largest stream-event handlers into their own modules: `assistant-event.ts` (`handleAssistantEvent` + the V2 task accumulator) and `user-event.ts` (`handleUserEvent` + subagent-child handling + skill-injection parsing). `events.ts` keeps stream framing, the small system/control/result handlers, and the `handleEvent` dispatch, dropping to 233 lines. No behavior change; the externally imported `handleStdout`/`handleStderr`/`handleControlResponseEvent` stay in `events.ts`.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Core hygiene pass (behavior-preserving):
  - Codex plan-mode handler: drop the four `as unknown as { ... }` casts of `ctx.active.session` and use the typed `AdapterSession` directly, matching the castless Claude sibling.
  - `AttachmentStore.deleteChat`: log the swallowed error instead of discarding it silently (a failure there means an invalid chatId segment, not a missing dir).
  - `git-write` route: narrow the two `catch (err: any)` handlers to `unknown` and extract the message via the codebase's standard `err instanceof Error ? err.message : String(err)` guard.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the positional parameter lists of `createHttpServer` (11 params) and `createServerManager` (10 params) with a single `HttpServerDeps` options object (`ServerManagerDeps = Omit<HttpServerDeps, 'lspManager'>`). Call sites now name what they pass instead of relying on argument order. Behavior unchanged.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close two issues from external review: validate the `attachmentId` path segment in `AttachmentStore.get` (a decoded `..%2F` could otherwise read another chat's attachments), and fix `isWithinBase` for a filesystem-root base so it no longer appends a double separator (a project rooted at `/` was wrongly rejected).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Deep-review follow-up fixes for the tech-debt PR:
  - **Security (core):** the content-search JS fallback (used when ripgrep is unavailable) now re-resolves every enumerated file through `realpath` + project-boundary containment before reading it. Previously an in-repo symlink returned by `git ls-files` could escape the project and surface out-of-project file contents in search results.
  - **Regression (core):** todo attachment uploads accept zero-byte files again. WS10 tightened the schema to `data: z.string().min(1)`, which 400'd a legitimate empty file; relaxed to `z.string()` (length is carried by `sizeBytes`).
  - **Types:** add `ApiResponseEmpty` (`ApiOkEmpty | ApiErr`) for state-only routes that reply via `okEmpty`, and use it for the git stage/unstage/push desktop clients instead of `ApiResponse<never>`.
  - **Hygiene (core):** remove the dead, unreferenced `isGitRepo` helper from `workspace/worktree.ts`.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Address thermo-nuclear review of the tech-debt branch: remove the dangling `removeWithChats` test references left after the cascade collapse (a vacuous, type-erroring assertion); delete the now-unreachable `else` branch in the git diff handler (the Zod `source` enum already rejects non-git sources); route the git/tunnel handlers through the shared `validate()` helper instead of hand-rolling identical Zod error formatting; align the todos attachment 400 with the plugin's local convention; and import `ExecutionMode` at the top of the Claude session module instead of inline.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close path-traversal, command-name and shell-interpolation seams. Fix a prefix-boundary bug in `resolveAndValidatePath` (a sibling dir sharing the base name prefix was admitted), consolidate the three divergent within-base checks onto one predicate, validate the `chatId` path segment in `AttachmentStore`, constrain the WS `command.name` to the identifier charset, and stop interpolating the probed command into the LSP `command -v` shell call.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Validate 7 previously-unguarded endpoints with Zod schemas (WS10): PATCH /chats/:id/title, PUT /projects/:id/files, POST/DELETE tunnel, POST /todos/:id/attachments, GET/DELETE adapters agents and skills, GET /projects/:id/git/diff.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Collapse project deletion into one transactional cascade. `remove(id)` now detaches child projects (`parent_project_id` → NULL), deletes child chats, and deletes the project atomically in a single transaction, replacing the bare `remove`/`removeWithChats` pair that could orphan chats or fail under `foreign_keys = ON`. Also prune the background-task tracker's per-chat maps when a chat ends, is archived, or its project is removed, fixing an unbounded memory leak.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Log or annotate previously-silent catch blocks (WS9 tech-debt sweep).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `_TaskProgress` accumulation in `groupToolCallParts`. Adapters mark the V2 task tools (`TaskCreate`/`TaskUpdate`) as both `hidden` (never a raw tool card) and `progress` (surfaced as a single `_TaskProgress` entry), but grouping checked hidden-suppression before progress-collection in the main loop and the reverse in the explore look-ahead. The result was that progress tools were dropped outright in the main loop and surfaced only when wedged between explore tools — position-dependent. Progress now takes precedence over hidden in both paths, so `_TaskProgress` is emitted consistently regardless of position. Test fixtures now mirror the real adapter categories so this can't regress.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - refactor(core): replace grouping sentinel round-trip with passthrough entry (WS14b)

  `applyToolGrouping` flattened DisplayContent into a parallel PartEntry model that
  only modeled text and tool-calls, smuggling every other content kind
  (thinking/image/skill_loaded/…) through grouping as a magic `\0ng:N` text string
  indexed into a side array, then decoding it back in two places via a regex.

  Replaces that with a first-class `{ type: 'passthrough'; content }` PartEntry
  variant: non-groupable content rides through grouping carrying its own data and
  parentToolUseId, and decodes by returning `part.content` directly. Removes the
  `nonGroupable` side array, the `\0ng:` encoding, and `NG_SENTINEL_RE`.

  Pure refactor — output is byte-identical, guarded by the WS14b characterization
  suite (positional interleaving, run-breaking, \_TaskProgress splice, task_group
  nesting, [#184](https://github.com/qlan-ro/mainframe/issues/184) agentId). Core tests 1627 pass.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Represent grouped tool/task content as first-class typed `DisplayContent`/`PartEntry` variants (`tool_group`, `task_group`, `task_progress`) instead of sentinel tool-calls matched by name. `convertGroupedPartsToDisplay` is now an exhaustive typed switch with no `_ToolGroup`/`_TaskGroup`/`_TaskProgress` string-matching. Internal refactor with no behavioral change (scattered task-progress accumulation and dedup preserved).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Normalize the daemon HTTP API to a single response envelope. Every route now returns `{ success: true, data }` (or `{ success: true }` for state-only mutations) and `{ success: false, error }` on failure, replacing the previous mix of bare objects, bare arrays, and ad-hoc `{ tasks }` / `{ ok: true }` / `{ reason }` shapes. Git read endpoints keep their not-a-git-repo "soft errors" as successful empty payloads so the existing empty-state UX is unchanged. Desktop API consumers unwrap the envelope; the mobile client already tolerates both shapes. Internal-only change with no user-facing behavior difference.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - refactor(core): consolidate git layer - shared parsers, single base-branch detection, async worktree exec (WS5)

  The git route layer duplicated parsing and base-branch logic, and the worktree
  helper talked to git three different ways including blocking sync I/O on the
  daemon event loop.
  - Extract byte-identical `isNotGitRepo`, `parseDiffNameStatus`, `parseStatusLines`
    and the porcelain bucket parser (typo `parsePortcelainStatus` fixed to
    `parseStatusBuckets`) into one shared `git/git-parse.ts`, with direct unit tests.
  - Replace the three copies of the `['main','master']` merge-base loop with a single
    `GitService.detectBaseBranch()`; routes consume it. Response shapes unchanged.
  - Migrate `workspace/worktree.ts` off `execFileSync`/`mkdirSync` and its private
    `promisify(execFile)` onto the canonical async `execGit` + `fs/promises`;
    `createWorktree` and `getWorktrees` no longer block the event loop. Callers in
    `config-manager.ts` await accordingly.
  - Remove the dead, unexported `isGitRepo` helper (zero callers).

  Pure refactor; behavior preserved. Full build green, core tests 1611 pass.

- Updated dependencies [[`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57)]:
  - @qlan-ro/mainframe-types@0.21.0


### Minor Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Migrate the stateless chat commands from WebSocket to REST. `chat.create`, `chat.updateConfig`, `chat.interrupt`, `chat.resume`, and the queued-message edit/cancel are now REST endpoints (`POST /api/chats`, `PATCH /api/chats/:id/config`, `POST /api/chats/:id/{interrupt,resume}`, `PATCH`/`DELETE /api/chats/:id/queue/:messageId`) returning the canonical envelope; the dead `chat.end` command is removed. The WebSocket is reserved for streaming and server-push — the 7 migrated inbound handlers and their `ClientEvent` variants are gone, so unsupported sends fail at compile time. A new `subscribe:ack` lets clients confirm a subscription is registered before resuming. `chat.created` is now a pure list-sync upsert (navigation is driven by the REST caller), and the `originClientId` attribution hack is removed. Hard cutover: the desktop client is migrated in this change; the mobile client ships the matching change in its own repo.

### Patch Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Deep-review follow-up fixes for the tech-debt PR:
  - **Security (core):** the content-search JS fallback (used when ripgrep is unavailable) now re-resolves every enumerated file through `realpath` + project-boundary containment before reading it. Previously an in-repo symlink returned by `git ls-files` could escape the project and surface out-of-project file contents in search results.
  - **Regression (core):** todo attachment uploads accept zero-byte files again. WS10 tightened the schema to `data: z.string().min(1)`, which 400'd a legitimate empty file; relaxed to `z.string()` (length is carried by `sizeBytes`).
  - **Types:** add `ApiResponseEmpty` (`ApiOkEmpty | ApiErr`) for state-only routes that reply via `okEmpty`, and use it for the git stage/unstage/push desktop clients instead of `ApiResponse<never>`.
  - **Hygiene (core):** remove the dead, unreferenced `isGitRepo` helper from `workspace/worktree.ts`.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add stable scoped data-testids to notification toggles, skill editor save button, and capture annotation popover elements (WS12).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Factor the four byte-identical leaf variants shared by `MessageContent` and `DisplayContent` into a single `LeafContent` type so the transcript and display unions stay in lockstep. Tighten `DisplayContent.permission_request.request` from `unknown` to `ControlRequest`, removing the downstream `as never` casts the erased type forced. Reuse `ToolCallResult` for the tool-card structured-result guard instead of a duplicated local type.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Log or annotate previously-silent catch blocks (WS9 tech-debt sweep).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - refactor(desktop): carry error message directly instead of sentinel round-trip (WS14a)

  The renderer destroyed an `error` block's message into an opaque frozen text
  sentinel (`\0__MF_ERROR__`) at conversion, then string-compared that sentinel at
  render time and re-scanned every message via `getExternalStoreMessages` to recover
  the message it had already discarded. Now `convert-message` carries `block.message`
  directly in the text part, and `MainframeText` identifies an error part by checking
  the current message's own blocks (no cross-message scan, no magic string). Removes
  `ERROR_PLACEHOLDER` and `findErrorMessage`. The `permission_request` placeholder is
  left for the broader WS14b/c grouping refactor. No behavior change.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a WS14c rendering regression: explore-tool groups and progress feeds run by a subagent are nested as first-class `tool_group`/`task_progress` blocks inside `task_group.calls`, but `convertMessage`'s task-group child mapper dropped them (returned `null`), so a subagent's file reads/greps and progress vanished from the Task card. The mapper now re-encodes nested `tool_group`/`task_progress` as `_ToolGroup`/`_TaskProgress` tool children — matching the top-level encoding that `TaskGroupCard` already renders and summarizes — restoring the pre-WS14c behavior.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Represent grouped tool/task content as first-class typed `DisplayContent`/`PartEntry` variants (`tool_group`, `task_group`, `task_progress`) instead of sentinel tool-calls matched by name. `convertGroupedPartsToDisplay` is now an exhaustive typed switch with no `_ToolGroup`/`_TaskGroup`/`_TaskProgress` string-matching. Internal refactor with no behavioral change (scattered task-progress accumulation and dedup preserved).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Normalize the daemon HTTP API to a single response envelope. Every route now returns `{ success: true, data }` (or `{ success: true }` for state-only mutations) and `{ success: false, error }` on failure, replacing the previous mix of bare objects, bare arrays, and ad-hoc `{ tasks }` / `{ ok: true }` / `{ reason }` shapes. Git read endpoints keep their not-a-git-repo "soft errors" as successful empty payloads so the existing empty-state UX is unchanged. Desktop API consumers unwrap the envelope; the mobile client already tolerates both shapes. Internal-only change with no user-facing behavior difference.

- Updated dependencies [[`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57)]:
  - @qlan-ro/mainframe-core@0.21.0
  - @qlan-ro/mainframe-types@0.21.0


### Minor Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Migrate the stateless chat commands from WebSocket to REST. `chat.create`, `chat.updateConfig`, `chat.interrupt`, `chat.resume`, and the queued-message edit/cancel are now REST endpoints (`POST /api/chats`, `PATCH /api/chats/:id/config`, `POST /api/chats/:id/{interrupt,resume}`, `PATCH`/`DELETE /api/chats/:id/queue/:messageId`) returning the canonical envelope; the dead `chat.end` command is removed. The WebSocket is reserved for streaming and server-push — the 7 migrated inbound handlers and their `ClientEvent` variants are gone, so unsupported sends fail at compile time. A new `subscribe:ack` lets clients confirm a subscription is registered before resuming. `chat.created` is now a pure list-sync upsert (navigation is driven by the REST caller), and the `originClientId` attribution hack is removed. Hard cutover: the desktop client is migrated in this change; the mobile client ships the matching change in its own repo.

### Patch Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Deep-review follow-up fixes for the tech-debt PR:
  - **Security (core):** the content-search JS fallback (used when ripgrep is unavailable) now re-resolves every enumerated file through `realpath` + project-boundary containment before reading it. Previously an in-repo symlink returned by `git ls-files` could escape the project and surface out-of-project file contents in search results.
  - **Regression (core):** todo attachment uploads accept zero-byte files again. WS10 tightened the schema to `data: z.string().min(1)`, which 400'd a legitimate empty file; relaxed to `z.string()` (length is carried by `sizeBytes`).
  - **Types:** add `ApiResponseEmpty` (`ApiOkEmpty | ApiErr`) for state-only routes that reply via `okEmpty`, and use it for the git stage/unstage/push desktop clients instead of `ApiResponse<never>`.
  - **Hygiene (core):** remove the dead, unreferenced `isGitRepo` helper from `workspace/worktree.ts`.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Factor the four byte-identical leaf variants shared by `MessageContent` and `DisplayContent` into a single `LeafContent` type so the transcript and display unions stay in lockstep. Tighten `DisplayContent.permission_request.request` from `unknown` to `ControlRequest`, removing the downstream `as never` casts the erased type forced. Reuse `ToolCallResult` for the tool-card structured-result guard instead of a duplicated local type.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Represent grouped tool/task content as first-class typed `DisplayContent`/`PartEntry` variants (`tool_group`, `task_group`, `task_progress`) instead of sentinel tool-calls matched by name. `convertGroupedPartsToDisplay` is now an exhaustive typed switch with no `_ToolGroup`/`_TaskGroup`/`_TaskProgress` string-matching. Internal refactor with no behavioral change (scattered task-progress accumulation and dedup preserved).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Normalize the daemon HTTP API to a single response envelope. Every route now returns `{ success: true, data }` (or `{ success: true }` for state-only mutations) and `{ success: false, error }` on failure, replacing the previous mix of bare objects, bare arrays, and ad-hoc `{ tasks }` / `{ ok: true }` / `{ reason }` shapes. Git read endpoints keep their not-a-git-repo "soft errors" as successful empty payloads so the existing empty-state UX is unchanged. Desktop API consumers unwrap the envelope; the mobile client already tolerates both shapes. Internal-only change with no user-facing behavior difference.


## 0.20.1


### Patch Changes

- [#363](https://github.com/qlan-ro/mainframe/pull/363) [`00f722c`](https://github.com/qlan-ro/mainframe/commit/00f722c0af68286bab1cebe463a4652f5d56a2ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plugin discovery now honors `MAINFRAME_DATA_DIR` — the daemon scans `<dataDir>/plugins` instead of a hardcoded `~/.mainframe/plugins`, aligning user-plugin loading with the rest of the data-dir convention (the todos builtin already used `<dataDir>/plugins`). No change in the default install, where `<dataDir>` is `~/.mainframe`.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.20.1


### Patch Changes

- [#363](https://github.com/qlan-ro/mainframe/pull/363) [`00f722c`](https://github.com/qlan-ro/mainframe/commit/00f722c0af68286bab1cebe463a4652f5d56a2ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Skip the fixed 9222 Chrome DevTools port when running under e2e (`MF_E2E=1`). The harness launches Electron instances in quick succession; the fixed port collides between launches and makes suite runs flaky. Production and normal dev are unaffected (the port is still enabled when `MF_E2E` is not set).

- [#361](https://github.com/qlan-ro/mainframe/pull/361) [`bd7330a`](https://github.com/qlan-ro/mainframe/commit/bd7330a49111cbf023ac9223c885b3602ceccb20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the first-run tutorial highlighting the wrong elements — steps 1 and 2 now point at the add-project and new-session buttons — and stop the projects/chats stores from being clobbered when the websocket reconnects.

- Updated dependencies [[`00f722c`](https://github.com/qlan-ro/mainframe/commit/00f722c0af68286bab1cebe463a4652f5d56a2ec)]:
  - @qlan-ro/mainframe-core@0.20.1
  - @qlan-ro/mainframe-types@0.20.1


## 0.20.0


### Minor Changes

- [#357](https://github.com/qlan-ro/mainframe/pull/357) [`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(bg-tasks): reconciliation, liveness sweep, and auto-kill

  Background tasks now survive daemon restarts AND suspend/resume. On startup
  the daemon walks the Claude CLI spool directory, validates each `.output`
  file against the active chat's session ID and encoded cwd, and uses `lsof`
  (write-mode FDs only) to detect live writers. While the daemon is alive a
  60s liveness sweep watches for tasks the CLI lost track of (laptop sleep,
  missed signals, event-loop stalls); a wallclock-jump heuristic detects wake
  and skips the two-strike grace window. Recovered tasks appear in the pill
  with a `↻` marker and remain killable from the UI.

  On chat archive, chat end, project removal, and direct worktree deletion,
  a new `killTasksForChat` helper runs **before** the CLI is killed so
  `stop_task` has a live target. Any survivor is signaled via
  `lsofWriters → SIGTERM/SIGKILL`. A provenance-scoped sweep limited to spool
  files under the worktree's encoded prefix catches untracked stragglers
  without touching editors, language servers, or shells with cwd in the
  worktree.

  Fixes the bug where 7h-old phantom task rows could not be cleared after
  the CLI session lost track of them — the kill route now falls back to
  OS-level termination instead of returning 503.

### Patch Changes

- [#353](https://github.com/qlan-ro/mainframe/pull/353) [`ca461cd`](https://github.com/qlan-ro/mainframe/commit/ca461cdf58c712b6d7c5a960a50f8ea4c68f436f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Send `message.queued.snapshot` on `chat.resume` so the composer banner
  reconverges on the daemon's truth whenever the client re-opens a chat.

  Previously only the (rarely-used) `subscribe` WS handler emitted this
  snapshot; `chat.resume` (which the desktop fires every time a chat view
  mounts) just added the chat to the subscription set without seeding the
  queue state. The result: a queued message that the CLI processed while
  the client was unsubscribed (because the user had switched chats) would
  stay stranded in the composer banner forever, even though the daemon
  had already pruned the ref. The bubble's `metadata.queued` flag silently
  cleared on re-entry — `useChatSession` HTTP-refetches messages from
  JSONL, which never carries that transient flag — so the user saw a
  stuck composer entry alongside a clean message bubble.

  The two WS handlers now share a private `sendQueuedSnapshot` helper.

- Updated dependencies [[`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a)]:
  - @qlan-ro/mainframe-types@0.20.0


### Minor Changes

- [#357](https://github.com/qlan-ro/mainframe/pull/357) [`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(bg-tasks): reconciliation, liveness sweep, and auto-kill

  Background tasks now survive daemon restarts AND suspend/resume. On startup
  the daemon walks the Claude CLI spool directory, validates each `.output`
  file against the active chat's session ID and encoded cwd, and uses `lsof`
  (write-mode FDs only) to detect live writers. While the daemon is alive a
  60s liveness sweep watches for tasks the CLI lost track of (laptop sleep,
  missed signals, event-loop stalls); a wallclock-jump heuristic detects wake
  and skips the two-strike grace window. Recovered tasks appear in the pill
  with a `↻` marker and remain killable from the UI.

  On chat archive, chat end, project removal, and direct worktree deletion,
  a new `killTasksForChat` helper runs **before** the CLI is killed so
  `stop_task` has a live target. Any survivor is signaled via
  `lsofWriters → SIGTERM/SIGKILL`. A provenance-scoped sweep limited to spool
  files under the worktree's encoded prefix catches untracked stragglers
  without touching editors, language servers, or shells with cwd in the
  worktree.

  Fixes the bug where 7h-old phantom task rows could not be cleared after
  the CLI session lost track of them — the kill route now falls back to
  OS-level termination instead of returning 503.

- [#354](https://github.com/qlan-ro/mainframe/pull/354) [`f1e8b64`](https://github.com/qlan-ro/mainframe/commit/f1e8b64a1ea81bef5f87124d6521b768c5ac3dd2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: handle width-overflow across chat/status/panel/title-bar rows

  Adds two shared UI primitives, `<ScrollRow>` (horizontal scroll with
  fading-edge masks + focusin auto-scroll, LTR-only) and `<TruncatedLabel>`
  (truncate + min-w-0 + opt-in native title + forwardRef for Radix
  TooltipTrigger asChild), and refactors PR badges, the chat session bar,
  status bar, selector breadcrumb, tag filter row, context section title,
  project group names, task card header, schedule pill, context file
  items, the title bar, the skills panel, and the flat session row
  actions column to use them.

  Title bar layout was rewritten to a `[1fr_auto_1fr]` grid so the project
  name, centered search box, and launch picker can each truncate
  independently without overlapping at narrow widths.

  FlatSessionRow's time column was collapsed to one line and the hover
  actions now overlay absolutely so the actions slot doesn't reserve
  width when not hovered.

  Composer bottom row now wraps so Send/Stop stays inside the card at
  narrow widths. The deeper popover-portal port (so dropdown menus can
  live inside a `ScrollRow` without clipping) is still tracked as a
  follow-up.

  Fixes [#182](https://github.com/qlan-ro/mainframe/issues/182).

### Patch Changes

- Updated dependencies [[`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a), [`ca461cd`](https://github.com/qlan-ro/mainframe/commit/ca461cdf58c712b6d7c5a960a50f8ea4c68f436f)]:
  - @qlan-ro/mainframe-core@0.20.0
  - @qlan-ro/mainframe-types@0.20.0


### Minor Changes

- [#357](https://github.com/qlan-ro/mainframe/pull/357) [`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(bg-tasks): reconciliation, liveness sweep, and auto-kill

  Background tasks now survive daemon restarts AND suspend/resume. On startup
  the daemon walks the Claude CLI spool directory, validates each `.output`
  file against the active chat's session ID and encoded cwd, and uses `lsof`
  (write-mode FDs only) to detect live writers. While the daemon is alive a
  60s liveness sweep watches for tasks the CLI lost track of (laptop sleep,
  missed signals, event-loop stalls); a wallclock-jump heuristic detects wake
  and skips the two-strike grace window. Recovered tasks appear in the pill
  with a `↻` marker and remain killable from the UI.

  On chat archive, chat end, project removal, and direct worktree deletion,
  a new `killTasksForChat` helper runs **before** the CLI is killed so
  `stop_task` has a live target. Any survivor is signaled via
  `lsofWriters → SIGTERM/SIGKILL`. A provenance-scoped sweep limited to spool
  files under the worktree's encoded prefix catches untracked stragglers
  without touching editors, language servers, or shells with cwd in the
  worktree.

  Fixes the bug where 7h-old phantom task rows could not be cleared after
  the CLI session lost track of them — the kill route now falls back to
  OS-level termination instead of returning 503.


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


## 0.18.2


### Patch Changes

- [#306](https://github.com/qlan-ro/mainframe/pull/306) [`0dd31dd`](https://github.com/qlan-ro/mainframe/commit/0dd31dda84e2c31e402a5ab0cf40145bda757f12) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): reconcile queued-message state on every result event

  The previous gated sweep (`queueRemaining === 0`) couldn't escape the
  common stranded-state where a leftover `queuedRefs` entry kept the count
  non-zero and pinned `processState='working'` forever, while the renderer's
  composer banner showed stale rows that no event would ever clear.

  `onResult` now reconciles bidirectionally:
  - Cached `metadata.queued` with no matching ref → strip the flag and emit
    `message.queued.processed(uuid)`.
  - `queuedRef` with no matching cached message → drop the ref and emit
    `message.queued.processed(ref.uuid)`.
  - Always emits `message.queued.snapshot` so the renderer's
    `queuedMessages` map converges on the daemon's truth — defends against
    any out-of-order delivery between `message.queued` and
    `message.queued.processed`.

  `processState` now uses the post-reconcile count.

- [#302](https://github.com/qlan-ro/mainframe/pull/302) [`93416b7`](https://github.com/qlan-ro/mainframe/commit/93416b7dd668f9acdafbbd6bdbe7ff4a697a94c3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session row redesign: PR pill, accent worktree pill, dynamic tag overflow, and stale-tag fix
  - New PR pill in session row matches the chat header `PrBadge` styling and links to the detected PR.
  - Worktree pill uses the accent colour for clearer visual distinction from user tags.
  - Tags share the title row with smart capping: title trims at 50% only when tags need the space, otherwise tags expand into the available width with a `+N` overflow that opens the tag popover.
  - Status dot is now vertically centred against the entire row (title + metadata).
  - Time column stacks day-label and time on two lines and uses short weekdays.
  - Daemon: `PUT /api/chats/:id/tags` now syncs the in-memory active chat so a subsequent `chat.updated` emission (e.g. from `resumeChat`) no longer broadcasts stale tags and clobber the renderer store.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.18.2


### Patch Changes

- [#305](https://github.com/qlan-ro/mainframe/pull/305) [`b8288d8`](https://github.com/qlan-ro/mainframe/commit/b8288d8549ff3b4cd161d69dc2ba8613b89dd466) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render fullview plugin zone as an overlay modal instead of replacing the center layout.

- [#302](https://github.com/qlan-ro/mainframe/pull/302) [`93416b7`](https://github.com/qlan-ro/mainframe/commit/93416b7dd668f9acdafbbd6bdbe7ff4a697a94c3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session row redesign: PR pill, accent worktree pill, dynamic tag overflow, and stale-tag fix
  - New PR pill in session row matches the chat header `PrBadge` styling and links to the detected PR.
  - Worktree pill uses the accent colour for clearer visual distinction from user tags.
  - Tags share the title row with smart capping: title trims at 50% only when tags need the space, otherwise tags expand into the available width with a `+N` overflow that opens the tag popover.
  - Status dot is now vertically centred against the entire row (title + metadata).
  - Time column stacks day-label and time on two lines and uses short weekdays.
  - Daemon: `PUT /api/chats/:id/tags` now syncs the in-memory active chat so a subsequent `chat.updated` emission (e.g. from `resumeChat`) no longer broadcasts stale tags and clobber the renderer store.

- Updated dependencies [[`0dd31dd`](https://github.com/qlan-ro/mainframe/commit/0dd31dda84e2c31e402a5ab0cf40145bda757f12), [`93416b7`](https://github.com/qlan-ro/mainframe/commit/93416b7dd668f9acdafbbd6bdbe7ff4a697a94c3)]:
  - @qlan-ro/mainframe-core@0.18.2
  - @qlan-ro/mainframe-types@0.18.2


## 0.18.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.18.1


### Patch Changes

- [#300](https://github.com/qlan-ro/mainframe/pull/300) [`cf0705c`](https://github.com/qlan-ro/mainframe/commit/cf0705cde5a49b8a4aed8ed77bc8517b1bf0684c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix four issues in the Check-for-Updates menu shipped in v0.18.0: the View-menu devtools filter was case-sensitive and didn't strip the item at runtime; existing submenu items lost their `type: 'separator'`, `click` handlers, and other properties when rebuilt; and the manual-check in-flight flag could leak permanently if `electron-updater` resolved without firing a terminal event. The filter is now case-insensitive, submenu items are passed through losslessly, and a 60-second watchdog clears the flag.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.18.1
  - @qlan-ro/mainframe-core@0.18.1


## 0.18.0


### Minor Changes

- [#290](https://github.com/qlan-ro/mainframe/pull/290) [`9998508`](https://github.com/qlan-ro/mainframe/commit/99985081bf6ab6182f9541f8d302e2082d1818e9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Review Panel modal: pre-PR review surface for the active chat. Cmd/Ctrl+Shift+R or the Review button opens a modal showing every changed file with a Monaco diff viewer (inline / split toggle) and gutter-comment widgets that post line-anchored comments back into the chat. Selection on added/removed lines is preserved and visible. Staging / commit / Open PR controls are not yet exposed in the UI; the matching git API surface ships behind it (`/api/git/stage`, `/unstage`, `/commit`, `/push`).

- [#297](https://github.com/qlan-ro/mainframe/pull/297) [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session row tagging.

  Sessions can now be tagged with user-defined tags via right-click → Tags or by clicking the tag row on hover. The sessions panel header gains a tag filter row with synthetic `has-pr` and `has-worktree` chips alongside user tags; multiple selected chips combine with strict AND. The session row layout moves the worktree pill and PR badge into the title row and replaces the project · branch · time metadata line with a dedicated tag row.

### Patch Changes

- Updated dependencies [[`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850)]:
  - @qlan-ro/mainframe-types@0.18.0


### Minor Changes

- [#290](https://github.com/qlan-ro/mainframe/pull/290) [`9998508`](https://github.com/qlan-ro/mainframe/commit/99985081bf6ab6182f9541f8d302e2082d1818e9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Review Panel modal: pre-PR review surface for the active chat. Cmd/Ctrl+Shift+R or the Review button opens a modal showing every changed file with a Monaco diff viewer (inline / split toggle) and gutter-comment widgets that post line-anchored comments back into the chat. Selection on added/removed lines is preserved and visible. Staging / commit / Open PR controls are not yet exposed in the UI; the matching git API surface ships behind it (`/api/git/stage`, `/unstage`, `/commit`, `/push`).

- [#297](https://github.com/qlan-ro/mainframe/pull/297) [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session row tagging.

  Sessions can now be tagged with user-defined tags via right-click → Tags or by clicking the tag row on hover. The sessions panel header gains a tag filter row with synthetic `has-pr` and `has-worktree` chips alongside user tags; multiple selected chips combine with strict AND. The session row layout moves the worktree pill and PR badge into the title row and replaces the project · branch · time metadata line with a dedicated tag row.

### Patch Changes

- [#299](https://github.com/qlan-ro/mainframe/pull/299) [`587c0cb`](https://github.com/qlan-ro/mainframe/commit/587c0cb19ac2d776f9971a903d14f3a2f6f8653f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a "Check for Updates…" item to the Help menu. Triggers a manual update check and shows a native dialog when you're already on the latest version or when the check fails. Available updates continue to surface in the status bar as before.

- Updated dependencies [[`9998508`](https://github.com/qlan-ro/mainframe/commit/99985081bf6ab6182f9541f8d302e2082d1818e9), [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850)]:
  - @qlan-ro/mainframe-core@0.18.0
  - @qlan-ro/mainframe-types@0.18.0


### Minor Changes

- [#297](https://github.com/qlan-ro/mainframe/pull/297) [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session row tagging.

  Sessions can now be tagged with user-defined tags via right-click → Tags or by clicking the tag row on hover. The sessions panel header gains a tag filter row with synthetic `has-pr` and `has-worktree` chips alongside user tags; multiple selected chips combine with strict AND. The session row layout moves the worktree pill and PR badge into the title row and replaces the project · branch · time metadata line with a dedicated tag row.


## 0.17.3


### Patch Changes

- [#291](https://github.com/qlan-ro/mainframe/pull/291) [`e30d1dd`](https://github.com/qlan-ro/mainframe/commit/e30d1dded2fe7359a27f854372f9d00d11deea95) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hiding `worktrees`/`.worktrees` directories from the file tree at any depth. The shared `IGNORED_DIRS` set (used by recursive search/list paths) was applied unconditionally to the tree route, which hid e.g. `.claude/worktrees/` even though the user expects to navigate into it. The tree route now uses a narrower allowlist (`.git`, `node_modules`); search and file listing keep the broader exclusion.

- [#294](https://github.com/qlan-ro/mainframe/pull/294) [`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Persist detected PRs to the database. Previously they lived only in the renderer's in-memory `detectedPrs` Map, which was rebuilt by replaying events from the daemon's per-`loadChat` history scan — so PR badges only appeared on sessions the user had opened during the current daemon lifetime. PRs are now stored on the chat row (new `detected_prs` column) by both the live `onPrDetected` sink and the history-replay scan, with URL-based dedup and `mentioned → created` source upgrades. The renderer seeds its Map from `chat.detectedPrs` on chat list load, so badges show on the sidebar immediately on app start.

- [#293](https://github.com/qlan-ro/mainframe/pull/293) [`0e6bf80`](https://github.com/qlan-ro/mainframe/commit/0e6bf80807347481a7ce0d5b7ca381cff4f247b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix [#147](https://github.com/qlan-ro/mainframe/issues/147): Queued messages don't dismiss and thinking indicator disappears while assistant is working

  Add comprehensive debug logging and test coverage for message queuing and thinking state management. Identify race conditions and edge cases where queued messages fail to dismiss or the thinking indicator flips false prematurely while the assistant is still streaming responses. Tests cover queued message lifecycle and proper thinking indicator state transitions across subagent execution.

- [#288](https://github.com/qlan-ro/mainframe/pull/288) [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the desktop from auto-switching its active chat when another client (e.g. mobile) creates a new session. The daemon now stamps `chat.created` events with an `originClientId` derived from the originating WebSocket connection, and the desktop only opens/selects the new chat when the event originated locally. Each client receives its own id via a new `connection.ready` event sent on WS open.

- Updated dependencies [[`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845), [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3)]:
  - @qlan-ro/mainframe-types@0.17.3


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


### Patch Changes

- [#294](https://github.com/qlan-ro/mainframe/pull/294) [`1bdd5a7`](https://github.com/qlan-ro/mainframe/commit/1bdd5a72ec0b01729daa0f07f33a99aa2e0a8845) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Persist detected PRs to the database. Previously they lived only in the renderer's in-memory `detectedPrs` Map, which was rebuilt by replaying events from the daemon's per-`loadChat` history scan — so PR badges only appeared on sessions the user had opened during the current daemon lifetime. PRs are now stored on the chat row (new `detected_prs` column) by both the live `onPrDetected` sink and the history-replay scan, with URL-based dedup and `mentioned → created` source upgrades. The renderer seeds its Map from `chat.detectedPrs` on chat list load, so badges show on the sidebar immediately on app start.

- [#288](https://github.com/qlan-ro/mainframe/pull/288) [`202ce41`](https://github.com/qlan-ro/mainframe/commit/202ce419295737d42ee7dff580a2429296d75eb3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the desktop from auto-switching its active chat when another client (e.g. mobile) creates a new session. The daemon now stamps `chat.created` events with an `originClientId` derived from the originating WebSocket connection, and the desktop only opens/selects the new chat when the event originated locally. Each client receives its own id via a new `connection.ready` event sent on WS open.


## 0.17.2


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.2


### Patch Changes

- [#286](https://github.com/qlan-ro/mainframe/pull/286) [`789e72a`](https://github.com/qlan-ro/mainframe/commit/789e72a0d301ef3b318c334a3e5ccc98134fffc5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): scope terminal tabs per session, preserve output across switches, and stop auto-creating tabs

  Terminal panel now scopes tabs by active chat (session) instead of project — switching chats no longer leaks terminals between sessions. Output is preserved across project/session switches and panel minimize via a module-level xterm cache. The `+` icon now sits next to the tabs (not the far right), the close `×` is always visible, and an empty state prompts users to click `+` to start a session. No terminal is auto-created on mount — users open one explicitly.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.2
  - @qlan-ro/mainframe-core@0.17.2


## 0.17.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.1


### Patch Changes

- [#284](https://github.com/qlan-ro/mainframe/pull/284) [`4269203`](https://github.com/qlan-ro/mainframe/commit/4269203f0b8e674c3539ab6da4b73d431ca26d2d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix TerminalPanel infinite render loop on app startup. The `getTerminals` selector returned a fresh `[]` for any project without a stored entry, causing `useSyncExternalStore` to detect a new snapshot every render and crash the renderer with React error [#185](https://github.com/qlan-ro/mainframe/issues/185) (Maximum update depth exceeded). Returns a stable empty-array reference instead. Also adds the missing `getHomedir` field to the renderer's `MainframeAPI` type so the preload contract typechecks end-to-end.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.1
  - @qlan-ro/mainframe-core@0.17.1


## 0.17.0


### Minor Changes

- [#282](https://github.com/qlan-ro/mainframe/pull/282) [`cf58806`](https://github.com/qlan-ro/mainframe/commit/cf58806a5edb7c812b727f54218d5aab3b1b7f1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: chat rendering + adapter event pipeline improvements ([#133](https://github.com/qlan-ro/mainframe/issues/133) [#141](https://github.com/qlan-ro/mainframe/issues/141) [#142](https://github.com/qlan-ro/mainframe/issues/142) [#144](https://github.com/qlan-ro/mainframe/issues/144))
  - **[#133](https://github.com/qlan-ro/mainframe/issues/133)** Add canonical `normalizeTodos` utility (`todos/normalize.ts`) supporting `todoV1` (TodoWrite), `taskV2` (TaskCreate/TaskUpdate/TaskStop), and `codexTodoList` sources. Wire V2 task events into Claude adapter's `onTodoUpdate` so `chat.todos` reflects V2 task progress. Add 17 tests covering all sources and edge cases.
  - **[#141](https://github.com/qlan-ro/mainframe/issues/141)** Fix thinking indicator disappearing prematurely: Claude CLI emits `result` events for subagent (Task/Agent) turns carrying `parent_tool_use_id`; these were being routed to `onResult()` which flipped `processState` to `'idle'` while the parent session was still working. Subagent result events are now dropped at the event handler level. Add 3 regression tests.
  - **[#142](https://github.com/qlan-ro/mainframe/issues/142)** Add Find-in-Chat: `Cmd+F` / `Ctrl+F` while the chat thread is focused slides down a find bar with live-filter (80ms debounce), match counter, prev/next navigation, and `Esc` to close. Implemented via `FindBar.tsx` and `find-in-chat` zustand store.
  - **[#144](https://github.com/qlan-ro/mainframe/issues/144)** Fix Codex `todoList` items silently dropped: `TodoListItem` was defined in types but missing from both the `ThreadItem` union and the `item/completed` switch. Added the union member and a `todoList` case that normalizes items via `onTodoUpdate`. Add 3 tests.

- [#281](https://github.com/qlan-ro/mainframe/pull/281) [`1a4dd2f`](https://github.com/qlan-ro/mainframe/commit/1a4dd2f641256d447fc029ffec4c5a513fa17b2c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(codex): fix AskUserQuestion option selection and add sub-agent TaskGroup grouping
  - fix(codex): extract selected option from `updatedInput.answers` when user clicks an option in AskUserQuestion (previously returned empty string, leaving Codex stuck)
  - feat(codex): render Codex sub-agent delegations as a `CollabAgent` card by handling the `collabAgentToolCall` ThreadItem on `item/started` (opens the card) and `item/completed` (closes it). `CollabAgent` is registered as a subagent tool, so the desktop's `groupTaskChildren()` promotes it to a TaskGroup card when child commands emitted on the spawned thread arrive tagged with `parentToolUseId`. Both the live event-mapper path and the chat-reload `convertThreadItems()` path emit the card so it persists across daemon HMR. Verified against Codex 0.125 strings — the `collab_agent_spawn_*` notifications assumed by the earlier draft do not exist in the binary.
  - feat(codex): use the agent's `nickname` (e.g. "Maxwell") and `role` (e.g. "explorer") from Codex's own `~/.codex/state_5.sqlite` thread registry as the TaskGroup card title and subtitle, instead of falling back to the raw spawn prompt.
  - feat(codex): pass `persistFullHistory: true` to `thread/start`/`thread/resume` (requires the existing `experimentalApi: true` capability) so spawned sub-agents stream their `commandExecution` items to the parent's notification stream.
  - feat(codex): on history reload, recover sub-agent `commandExecution` items by reading each child thread's rollout JSONL directly (`~/.codex/sessions/.../<threadId>.jsonl`). The JSON-RPC `thread/read` API filters function_call records out of child threads, so without this the reloaded TaskGroup cards lacked their nested bash commands.
  - fix(codex): on chat reload, extract `userMessage.content[0].text` from `thread/read` results — Codex stores the prompt under the nested `content` array, not the top-level `text` field. Without this fix, every reloaded chat was missing all user-typed messages.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Push tunnel status and file changes over WebSocket so the renderer reacts in real-time without polling or reopening settings. The RemoteAccessSection now updates immediately when a tunnel becomes DNS-verified, and the editor auto-reloads (or shows a "File changed on disk" banner with dirty state) when an agent modifies an open file.

  Also fix a long-standing bug where files opened from Edit/Write tool cards (which use absolute worktree paths) skipped `context.updated` subscriptions entirely — the editor and diff views now classify "external" by checking against known project/worktree bases instead of by the path's leading slash, so agent edits inside a worktree refresh open editors regardless of how the file was opened.

### Patch Changes

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Improve Quick Tunnel UX so "ready" only appears when the tunnel is actually reachable. The settings panel now distinguishes three live states driven by `tunnel:status` events: **Verifying DNS…** (cloudflared registered the connection but DNS hasn't propagated yet — yellow spinner, no pairing), **Ready** (DNS verified — green dot, pairing available), and **Unreachable** (DNS check timed out — yellow dot, "DNS not yet propagated" warning, Re-check button, pairing disabled). Also bump the daemon's DNS verification budget from 15s to 45s since trycloudflare.com URLs routinely take 20–30s to propagate on first start.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.

- Updated dependencies [[`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416)]:
  - @qlan-ro/mainframe-types@0.17.0


### Minor Changes

- [#282](https://github.com/qlan-ro/mainframe/pull/282) [`cf58806`](https://github.com/qlan-ro/mainframe/commit/cf58806a5edb7c812b727f54218d5aab3b1b7f1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: chat rendering + adapter event pipeline improvements ([#133](https://github.com/qlan-ro/mainframe/issues/133) [#141](https://github.com/qlan-ro/mainframe/issues/141) [#142](https://github.com/qlan-ro/mainframe/issues/142) [#144](https://github.com/qlan-ro/mainframe/issues/144))
  - **[#133](https://github.com/qlan-ro/mainframe/issues/133)** Add canonical `normalizeTodos` utility (`todos/normalize.ts`) supporting `todoV1` (TodoWrite), `taskV2` (TaskCreate/TaskUpdate/TaskStop), and `codexTodoList` sources. Wire V2 task events into Claude adapter's `onTodoUpdate` so `chat.todos` reflects V2 task progress. Add 17 tests covering all sources and edge cases.
  - **[#141](https://github.com/qlan-ro/mainframe/issues/141)** Fix thinking indicator disappearing prematurely: Claude CLI emits `result` events for subagent (Task/Agent) turns carrying `parent_tool_use_id`; these were being routed to `onResult()` which flipped `processState` to `'idle'` while the parent session was still working. Subagent result events are now dropped at the event handler level. Add 3 regression tests.
  - **[#142](https://github.com/qlan-ro/mainframe/issues/142)** Add Find-in-Chat: `Cmd+F` / `Ctrl+F` while the chat thread is focused slides down a find bar with live-filter (80ms debounce), match counter, prev/next navigation, and `Esc` to close. Implemented via `FindBar.tsx` and `find-in-chat` zustand store.
  - **[#144](https://github.com/qlan-ro/mainframe/issues/144)** Fix Codex `todoList` items silently dropped: `TodoListItem` was defined in types but missing from both the `ThreadItem` union and the `item/completed` switch. Added the union member and a `todoList` case that normalizes items via `onTodoUpdate`. Add 3 tests.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Push tunnel status and file changes over WebSocket so the renderer reacts in real-time without polling or reopening settings. The RemoteAccessSection now updates immediately when a tunnel becomes DNS-verified, and the editor auto-reloads (or shows a "File changed on disk" banner with dirty state) when an agent modifies an open file.

  Also fix a long-standing bug where files opened from Edit/Write tool cards (which use absolute worktree paths) skipped `context.updated` subscriptions entirely — the editor and diff views now classify "external" by checking against known project/worktree bases instead of by the path's leading slash, so agent edits inside a worktree refresh open editors regardless of how the file was opened.

### Patch Changes

- [#278](https://github.com/qlan-ro/mainframe/pull/278) [`c01877a`](https://github.com/qlan-ro/mainframe/commit/c01877ac08589910b4762b2b3f368062608f7d35) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): four UX fixes — transient update errors, sessions sidebar header layout, long user message collapsing, and composer double scrollbar
  - [#136](https://github.com/qlan-ro/mainframe/issues/136): Transient auto-updater errors (network loss, DNS, 5xx, rate limits) no longer surface as a persistent error banner; logged at warn instead.
  - [#138](https://github.com/qlan-ro/mainframe/issues/138): Sessions sidebar project group header row now uses a fixed-width right cluster so the project name never reflows when action buttons appear on hover.
  - [#139](https://github.com/qlan-ro/mainframe/issues/139): User message bubbles longer than 600 characters are clamped to 6 lines with a "Read more / Show less" toggle.
  - [#140](https://github.com/qlan-ro/mainframe/issues/140): Composer card caps at 14 lines via `maxHeight: 14lh`, uses `overflow-hidden` on the outer card to eliminate the double scrollbar, and sets explicit `lineHeight`/`padding` on the textarea to fix cursor offset on paste.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Improve Quick Tunnel UX so "ready" only appears when the tunnel is actually reachable. The settings panel now distinguishes three live states driven by `tunnel:status` events: **Verifying DNS…** (cloudflared registered the connection but DNS hasn't propagated yet — yellow spinner, no pairing), **Ready** (DNS verified — green dot, pairing available), and **Unreachable** (DNS check timed out — yellow dot, "DNS not yet propagated" warning, Re-check button, pairing disabled). Also bump the daemon's DNS verification budget from 15s to 45s since trycloudflare.com URLs routinely take 20–30s to propagate on first start.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.

- [#279](https://github.com/qlan-ro/mainframe/pull/279) [`3ac3bbc`](https://github.com/qlan-ro/mainframe/commit/3ac3bbca495c40fbe6682f26b3fa7e1a50460a0d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix terminal cwd resolving to / on mount and make terminals project-scoped.

- Updated dependencies [[`cf58806`](https://github.com/qlan-ro/mainframe/commit/cf58806a5edb7c812b727f54218d5aab3b1b7f1f), [`1a4dd2f`](https://github.com/qlan-ro/mainframe/commit/1a4dd2f641256d447fc029ffec4c5a513fa17b2c), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416)]:
  - @qlan-ro/mainframe-core@0.17.0
  - @qlan-ro/mainframe-types@0.17.0


### Patch Changes

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.


## 0.16.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.16.1


### Patch Changes

- [#276](https://github.com/qlan-ro/mainframe/pull/276) [`891c685`](https://github.com/qlan-ro/mainframe/commit/891c685e4e00a4f77e779ae6520b4453cfe644ad) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): polish BashCard and SearchCard layouts
  - BashCard: drop the JS-level 80-char hard truncation; let CSS `truncate` handle overflow responsively so commands fill the available row width before getting an ellipsis. Tooltip still shows the full command on hover.
  - SearchCard: header now renders `Grep · "pattern"` (toolName plus pattern, monospaced and truncatable). The path moves to its own subheader line wrapped in a Radix tooltip showing the full path on hover.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.16.1
  - @qlan-ro/mainframe-core@0.16.1


## 0.16.0


### Minor Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex tools now render with the same unified cards as Claude. The Codex event-mapper translates Codex-native item types into Claude-shaped tool_use blocks: commandExecution → Bash, fileChange → per-file Edit/Write with parsed unified-diff (structuredPatch), mcpToolCall → mcp**<server>**<tool> for the MCPToolCard wildcard. Codex adapter declares todo_list as hidden (parity with Claude TodoWrite — TasksSection integration tracked separately).

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tool card foundations: daemon adapter is now single source of truth for hidden tools. Desktop drops two hardcoded HIDDEN lists, filters via toolCall.category. CollapsibleToolCard gains hideToggle prop and renders subHeader in both open and closed states.

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render Codex-generated images inline in the chat. Codex's `imageGeneration` thread item carries the PNG bytes as base64 in a `result` field (camelCase fields, not snake_case as previously typed); the event-mapper now decodes that inline payload directly and falls back to reading `savedPath` from disk only if the inline result is missing. The display pipeline's `convertAssistantContent` was also missing an `image` case, so even properly emitted assistant image blocks were being dropped before reaching the UI; that branch is now wired up. Image thumbs in assistant messages also no longer force right-justification.

- Updated dependencies [[`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8)]:
  - @qlan-ro/mainframe-types@0.16.0


### Minor Changes

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tool card foundations: daemon adapter is now single source of truth for hidden tools. Desktop drops two hardcoded HIDDEN lists, filters via toolCall.category. CollapsibleToolCard gains hideToggle prop and renders subHeader in both open and closed states.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pill family of tool cards: U12 mobile SkillLoadedCard port + adds `skill_loaded` content type. U14 WorktreeStatusPill (EnterWorktree, ExitWorktree). U15 MCPToolCard (wildcard for `mcp__*`). U16 SchedulePill (ScheduleWakeup, CronCreate, CronDelete, CronList, Monitor). All share the centered rounded-full pill shape from SkillLoadedCard.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Unified chat-stream tool cards (U1-U11). Status dot moves to trailing slot. Drop Maximize2/Minimize2 toggle (whole row clickable). Outer border on compact variants. Edit/Write get Pencil action icon prepended to FileTypeIcon. Read swaps Eye → FileText + "Read" label. Search restructures pattern into subheader. TaskCard moves description to subheader with 600-char prompt tooltip. Mobile gains full content for Read/Search/Plan/AskUserQuestion/Default cards (mobile package is shipped separately as a submodule).

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Markdown code blocks: header (language label + Copy button) and code body now share one visual surface. Drops the divider line and lighter header background.

- [#274](https://github.com/qlan-ro/mainframe/pull/274) [`47b6899`](https://github.com/qlan-ro/mainframe/commit/47b689973c6d150f4eba90638b1571185c96a4c7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Follow-up to [#271](https://github.com/qlan-ro/mainframe/issues/271): the original 1px nudge did not actually defeat assistant-ui's autoScroll. Tracing `useThreadViewportAutoScroll.js`: the ResizeObserver callback reads `isAtBottom` from a Zustand store, and the store is only updated by the scroll event handler. Programmatic `scrollTop = X` queues the scroll event asynchronously — so the resize fires first with the stale `isAtBottom = true`, autoScroll snaps to bottom, and the just-expanded pill flies off-screen anyway. Live repro: pill viewport top went 482.5 → -5.5 (-488 px). Fix: nudge 2px (safer than 1px against sub-pixel scrollTop) AND synchronously dispatch a `scroll` event so assistant-ui's handler updates the store BEFORE the resize callback consults it. After fix: pill top 482.5 → 484.5 (+2 px, just the nudge), scrollTop 207.5 → 205.5, autoScroll skipped.

- [#271](https://github.com/qlan-ro/mainframe/pull/271) [`27908ed`](https://github.com/qlan-ro/mainframe/commit/27908ed215fcff3e52fa8fdc96aa0e0684a032e3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix expandable cards/pills jumping off-screen when toggled near the chat bottom. Adds `useExpandable` hook that nudges the chat scroller up by 1px before `setOpen` when the user is at the bottom — defeats assistant-ui's `isAtBottom < 1` autoScroll check, so the browser keeps the pill anchored to its viewport position while the new body extends downward. No JS counter-scroll, single paint, no flash. Wired into `CollapsibleToolCard` (covers Bash/Edit/Write/Read/Plan/Default/AskUserQuestion), `MCPToolCard`, `SchedulePill`, `SkillLoadedCard`, and `TaskGroupCard`. Load-bearing detail: the 1px nudge is tied to assistant-ui's `isAtBottom` threshold — verify still works on future assistant-ui upgrades.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render Codex-generated images inline in the chat. Codex's `imageGeneration` thread item carries the PNG bytes as base64 in a `result` field (camelCase fields, not snake_case as previously typed); the event-mapper now decodes that inline payload directly and falls back to reading `savedPath` from disk only if the inline result is missing. The display pipeline's `convertAssistantContent` was also missing an `image` case, so even properly emitted assistant image blocks were being dropped before reaching the UI; that branch is now wired up. Image thumbs in assistant messages also no longer force right-justification.

- [#272](https://github.com/qlan-ro/mainframe/pull/272) [`487ef61`](https://github.com/qlan-ro/mainframe/commit/487ef61c22cf8803a92166dfe5a00915b906f855) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Bundle of small chat-rendering polish:
  - `ClickableFilePath` becomes `<span role="button">` with keydown handler instead of `<button>`, fixing the React hydration warning when nested inside another button (e.g. a tool-card header).
  - Markdown code blocks render header inside the same container as the body (single border, copy icon always visible), fixing double-border and inconsistent header positioning.
  - `SyntaxHighlightedCode` strips Shiki's default `<pre>` border/radius so it inherits the outer container chrome.
  - `SearchCard` subheader aligns to 35px (icon column + padding) and the result divider is full-width.
  - `WorktreeStatusPill` uses `my-2` for vertical rhythm parity with the rest of the pill family.
- Updated dependencies [[`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8)]:
  - @qlan-ro/mainframe-core@0.16.0
  - @qlan-ro/mainframe-types@0.16.0


### Minor Changes

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pill family of tool cards: U12 mobile SkillLoadedCard port + adds `skill_loaded` content type. U14 WorktreeStatusPill (EnterWorktree, ExitWorktree). U15 MCPToolCard (wildcard for `mcp__*`). U16 SchedulePill (ScheduleWakeup, CronCreate, CronDelete, CronList, Monitor). All share the centered rounded-full pill shape from SkillLoadedCard.


## 0.15.2


### Patch Changes

- [#263](https://github.com/qlan-ro/mainframe/pull/263) [`951d249`](https://github.com/qlan-ro/mainframe/commit/951d24954be02a58d4abfec90368de98aea7d498) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop synthesizing duplicate "Using skill" cards from subagent JSONLs on history replay. Each subagent (Task/Agent tool) writes its own `Base directory for this skill: …` isMeta entry; live mode never surfaces those at the parent level, so promoting them on replay produced ghost SkillLoadedCards that never appeared during the live session. Skill synthesis now skips entries from subagent files and sidechain entries.

- [#264](https://github.com/qlan-ro/mainframe/pull/264) [`fad6ea5`](https://github.com/qlan-ro/mainframe/commit/fad6ea5b2fb6b063ab59eb56a8fc89d16c715e6a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the duplicate "subagent prompt" pill in live Claude sessions. CLI 2.1.118+ normalizes `agent_progress` events into top-level stream-json messages with `parent_tool_use_id` set; the subagent's first event is a string-content user message that just restates the dispatch prompt — the same text already rendered by the parent's Task card from `Agent.input.prompt`. The Claude event handler now drops just that one event (string content with `parent_tool_use_id` set and no CLI-internal tags). Subagent skill loads, text/thinking, tool_use and tool_result blocks all flow through unchanged.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.15.2


### Patch Changes

- Updated dependencies [[`951d249`](https://github.com/qlan-ro/mainframe/commit/951d24954be02a58d4abfec90368de98aea7d498), [`fad6ea5`](https://github.com/qlan-ro/mainframe/commit/fad6ea5b2fb6b063ab59eb56a8fc89d16c715e6a)]:
  - @qlan-ro/mainframe-core@0.15.2
  - @qlan-ro/mainframe-types@0.15.2


## 0.15.1


### Patch Changes

- [#259](https://github.com/qlan-ro/mainframe/pull/259) [`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(claude): drop sidechain entries from history loader so subagent dispatch prompts no longer render as ghost user bubbles in the parent thread. Skill-loaded synthesis still runs first, so user-typed `/skill` invocations are preserved.

- [`eace2d6`](https://github.com/qlan-ro/mainframe/commit/eace2d648157ac64f437b5f1f70e37d65abf3f46) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect PR mutation commands (gh pr edit/ready/merge/close/reopen/comment/review and GitLab/Azure equivalents) so the PR badge appears when the agent mutates a PR, not only when it creates one.

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.15.1


### Patch Changes

- [#258](https://github.com/qlan-ro/mainframe/pull/258) [`a2e0d90`](https://github.com/qlan-ro/mainframe/commit/a2e0d909408f2f742a87a15f1265d147643d445c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix sidebar project filter drifting out of sync with the open chat. When the active chat changes (search palette, toast click, tab switch, daemon-driven activation, runtime thread switch), the filter is now cleared if the new chat lives in a different project, so the badge no longer points at a project the user is not viewing.

- [`e6c5ff1`](https://github.com/qlan-ro/mainframe/commit/e6c5ff14ed2a6fd554c5870db101d33aa4c5d741) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(editor): apply InlineCommentWidget width after Monaco's addZone, not before. Monaco's view-zones implementation sets `domNode.style.width = '100%'` inside `_addZone`, clobbering the contentWidth-based width we were setting beforehand. The first widget happened to get corrected by a later layout event; subsequent widgets stayed at full width. Width is now re-applied after addZone, and an `onDidContentSizeChange` listener keeps every open widget in sync when a scrollbar toggles.

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies [[`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3), [`eace2d6`](https://github.com/qlan-ro/mainframe/commit/eace2d648157ac64f437b5f1f70e37d65abf3f46), [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b)]:
  - @qlan-ro/mainframe-core@0.15.1
  - @qlan-ro/mainframe-types@0.15.1


## 0.15.0


### Minor Changes

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.

### Patch Changes

- [#254](https://github.com/qlan-ro/mainframe/pull/254) [`cc78f1a`](https://github.com/qlan-ro/mainframe/commit/cc78f1a1159d9c8c3f0fce9d95279c50515be80b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix spurious empty user bubble in Explore agent / Task tool subagent threads.

  Bare `<command-name>` CLI echoes (no accompanying `<command-message>` tag) are
  now suppressed in `convertUserContent` instead of being synthesized into a
  `/commandName` bubble. An additional guard in `convertGroupedToDisplay` drops
  user messages whose display content and metadata are both empty, preventing any
  residual empty bubble from reaching the client.

  User-typed `/skill-name` invocations are unaffected — they always carry a
  `<command-message>` tag alongside `<command-name>` and continue to render
  correctly.

- Updated dependencies [[`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163)]:
  - @qlan-ro/mainframe-types@0.15.0


### Minor Changes

- [#249](https://github.com/qlan-ro/mainframe/pull/249) [`4b546c4`](https://github.com/qlan-ro/mainframe/commit/4b546c49de3e6d370f44b8a74eef79619118307c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Chat quote support: highlight any text in the chat thread to surface a floating "Quote" button that prepends `> ` to each line and appends it to the composer. Find-in-path dialog widened to match the command palette width.

- [#253](https://github.com/qlan-ro/mainframe/pull/253) [`d85984e`](https://github.com/qlan-ro/mainframe/commit/d85984e4671e79ad429d1c0ffc21a5ac3a181b9d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show a spinner while messages load on app startup and session switch. The chat panel now displays a centered Loader2 indicator instead of a blank area whenever `getChatMessages` is in flight, and the app-level center panel shows a loading state during the initial data fetch.

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.

- [#250](https://github.com/qlan-ro/mainframe/pull/250) [`de23db7`](https://github.com/qlan-ro/mainframe/commit/de23db741b0168e01fb40bda6f1e1c9fe321cca2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add drag-to-capture region selection in the sandbox preview tab. Users can activate "Region capture" mode (Frame icon in the toolbar), drag a rectangle over the webview, and optionally annotate the capture before adding it to the composer. The annotation appears in the capture preamble when the message is sent.

### Patch Changes

- [#255](https://github.com/qlan-ro/mainframe/pull/255) [`57c867b`](https://github.com/qlan-ro/mainframe/commit/57c867b54ec6a715e60b0ccddf529f4cb8b794dc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pin action button bars in Quick and Full todo dialogs to the bottom so they stay visible while scrolling long forms.

- Updated dependencies [[`cc78f1a`](https://github.com/qlan-ro/mainframe/commit/cc78f1a1159d9c8c3f0fce9d95279c50515be80b), [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163)]:
  - @qlan-ro/mainframe-core@0.15.0
  - @qlan-ro/mainframe-types@0.15.0


### Minor Changes

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.


## 0.14.0


### Minor Changes

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

### Patch Changes

- [#243](https://github.com/qlan-ro/mainframe/pull/243) [`1367009`](https://github.com/qlan-ro/mainframe/commit/1367009dbc2c676bef18ff2ce13c087d19a99e95) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make `asyncHandler` return its wrapped Promise so tests can properly `await` route handlers. Previously the wrapper used a fire-and-forget `.catch(next)` which discarded the Promise, forcing tests to rely on a 50ms `setTimeout`-based polyfill that raced against `listFilesWithRipgrep`'s subprocess spawn and flaked under load. Server behavior is unchanged (Express ignores the handler's return value).

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry

- Updated dependencies [[`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b), [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf)]:
  - @qlan-ro/mainframe-types@0.14.0


### Patch Changes

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry

- [#244](https://github.com/qlan-ro/mainframe/pull/244) [`92a984d`](https://github.com/qlan-ro/mainframe/commit/92a984db5156a722b57f063ea1a18fe96f137238) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix element inspect screenshot offset when Electron zoom is not 1.0 (Cmd+/-). The crop rect passed to `capturePage` is now scaled by the webview zoom factor so device-pixel coordinates align with CSS-pixel coordinates from `getBoundingClientRect`.

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

- [#246](https://github.com/qlan-ro/mainframe/pull/246) [`3ac285f`](https://github.com/qlan-ro/mainframe/commit/3ac285f95087916d80d90d3bc52cdf8329720bfb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): show image preview thumbnails with remove button in Quick Todo and Todo Modal dialogs

- Updated dependencies [[`1367009`](https://github.com/qlan-ro/mainframe/commit/1367009dbc2c676bef18ff2ce13c087d19a99e95), [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b), [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf)]:
  - @qlan-ro/mainframe-core@0.14.0
  - @qlan-ro/mainframe-types@0.14.0


### Minor Changes

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

### Patch Changes

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry


## 0.13.0


### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.

### Patch Changes

- [#236](https://github.com/qlan-ro/mainframe/pull/236) [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list now re-orders correctly when a chat gets new activity, switching sessions while another is being archived no longer blocks the UI, and archiving a running chat no longer leaves a stuck spinner when the dying CLI process emits a final chat.updated event.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed three file/diff editor issues: the editor can now open files outside the project root, collapsed editor panels can be re-expanded, and the diff editor no longer crops the first character of each line.

- Updated dependencies [[`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c)]:
  - @qlan-ro/mainframe-types@0.13.0


### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.

### Patch Changes

- [#237](https://github.com/qlan-ro/mainframe/pull/237) [`99ae306`](https://github.com/qlan-ro/mainframe/commit/99ae306c278bdeb84c2ec3ba9c3d6925e6a6b72d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Images in agent responses now render inline in the chat bubble instead of showing as raw base64 text.

- [#239](https://github.com/qlan-ro/mainframe/pull/239) [`65c6a0f`](https://github.com/qlan-ro/mainframe/commit/65c6a0f1fac11797883ae963f3f0bc205d91a8ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix active-chat restore picking an archived session on boot. The daemon returns archived chats alongside active ones (they feed the archived-sessions popover), so `useAppInit.loadData()` must skip them when restoring `mf:activeChatId` — otherwise the right pane shows a chat that isn't visible in the flat list and the user can't navigate away.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed diff editor gutter spacing on the modified side: restores `lineDecorationsWidth: 6` so there is breathing room between line numbers and code. Follow-up to the [#113](https://github.com/qlan-ro/mainframe/issues/113) horizontal-scroll fix — the clipping was caused by `overflow-hidden`, not the decoration width, so a non-zero value is safe now that the CSS is corrected.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix InlineCommentWidget exceeding editor viewport width and causing Monaco horizontal scrollbar divergence when typing long text.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed a race on startup where the selected project badge could disagree with the chats filter after reload.

- [#238](https://github.com/qlan-ro/mainframe/pull/238) [`8d1806f`](https://github.com/qlan-ro/mainframe/commit/8d1806f58bf9fe05047f7a2fbc04c8c3ca803f37) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Quick Todo dialog no longer crops the first character of each line and its cursor sits at the correct position. The full Todo modal now responds correctly to vertical resize — the height state is applied to the DOM so dragging the resize handle taller or shorter takes effect immediately.

- [#236](https://github.com/qlan-ro/mainframe/pull/236) [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list now re-orders correctly when a chat gets new activity, switching sessions while another is being archived no longer blocks the UI, and archiving a running chat no longer leaves a stuck spinner when the dying CLI process emits a final chat.updated event.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed three file/diff editor issues: the editor can now open files outside the project root, collapsed editor panels can be re-expanded, and the diff editor no longer crops the first character of each line.

- Updated dependencies [[`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c), [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78), [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3)]:
  - @qlan-ro/mainframe-types@0.13.0
  - @qlan-ro/mainframe-core@0.13.0


### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.


## 0.12.0


### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831)]:
  - @qlan-ro/mainframe-types@0.12.0


### Minor Changes

- [#230](https://github.com/qlan-ro/mainframe/pull/230) [`29f192c`](https://github.com/qlan-ro/mainframe/commit/29f192c95f9507a6625e42d134fe599cb3f000b1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a project from the sidebar. Two discoverable entry points route through the same confirm-and-cleanup flow:
  - Hover the project group header (in the "All" view) → trash icon fades in next to "New Session".
  - When filtered to a specific project, the active filter pill shows a chevron — clicking it opens a menu with "Delete Project".

  Confirming stops all running CLI sessions in that project, removes all its chats from the database in a transaction, and resets any active filter or selected chat that belonged to the deleted project. Files on disk are not affected.

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831), [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5)]:
  - @qlan-ro/mainframe-types@0.12.0
  - @qlan-ro/mainframe-core@0.12.0


### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.


## 0.11.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1


### Patch Changes

- [#228](https://github.com/qlan-ro/mainframe/pull/228) [`7b82949`](https://github.com/qlan-ro/mainframe/commit/7b829498cad870ae239f7aea607bae7a6e249f23) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(updater): publish macOS zip artifact so electron-updater can apply updates

  Squirrel.Mac auto-updates require a `.zip` of the app bundle; the release previously shipped only `.dmg`, causing the updater to fail with "ZIP file not provided" when applying an update. Also replaces native `title` attributes on the status-bar update indicator and the composer worktree button with Radix tooltips so hovercards render with the app's own styling, re-enables hoverable content on the chat link-preview tooltip so the Copy button can be reached, and adds a right-click context menu to chat links with Copy link / Open link actions.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1
  - @qlan-ro/mainframe-core@0.11.1


## 0.11.0


### Minor Changes

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - File search now surfaces gitignored config files (e.g. .env) while still excluding build artifacts like node_modules and dist.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.0


### Minor Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `@`-picker gains terminal-style path autocomplete. Typing `/` in an `@`-token switches from fuzzy search to tree navigation; Tab completes filenames; Enter on a directory drills in.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#224](https://github.com/qlan-ro/mainframe/pull/224) [`29cddc7`](https://github.com/qlan-ro/mainframe/commit/29cddc7a0a9531fa0acfdebb84e1da6ec6c6afd9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer now preserves newlines in sent messages and caps its growth at a max height with internal scroll.

  The max-height cap is applied to an outer scroll wrapper rather than the textarea itself, so the textarea grows naturally and shares its wrapping width with the highlight overlay. With the cap on the textarea, its own scrollbar shaved the effective content width, causing the two layers to wrap at different widths and the caret to drift from the visible text. The overlay also emits a trailing zero-width marker so the caret stays aligned when the text ends with a newline.

  The global text selection color is now a neutral blue instead of the orange accent, so mentions and other accent-colored text stay readable while selected.

  The highlight overlay now seeds its text from the runtime's current state on mount instead of waiting for a subscribe event, so draft text stays visible after ancestors remount (for example, when a permission prompt closes).

- [#222](https://github.com/qlan-ro/mainframe/pull/222) [`1ee5874`](https://github.com/qlan-ro/mainframe/commit/1ee5874732bd683cdb1d379f13c72923d9031027) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list view mode is now derived from the project filter. Grouped view is used when 'All' is selected; flat view is used when filtering by a single project. The manual toggle is gone.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - While a worktree delete is in flight, show a spinner on that row's trash icon and disable both the trash and new-session buttons. Other worktree rows remain interactive.

- Updated dependencies [[`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec), [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805), [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec)]:
  - @qlan-ro/mainframe-core@0.11.0
  - @qlan-ro/mainframe-types@0.11.0


## 0.10.3


### Patch Changes

- [#216](https://github.com/qlan-ro/mainframe/pull/216) [`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken symlinks are skipped.

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.

- Updated dependencies [[`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65)]:
  - @qlan-ro/mainframe-types@0.10.3


### Patch Changes

- [#216](https://github.com/qlan-ro/mainframe/pull/216) [`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken symlinks are skipped.

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.

- [#217](https://github.com/qlan-ro/mainframe/pull/217) [`442782b`](https://github.com/qlan-ro/mainframe/commit/442782b2719ec715d7d72f294d48ce1447b8e252) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Include task title in the "Task created" toast so it matches the notification body removed in the earlier dedup fix.

- Updated dependencies [[`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22), [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65)]:
  - @qlan-ro/mainframe-core@0.10.3
  - @qlan-ro/mainframe-types@0.10.3


### Patch Changes

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.


## 0.10.2


### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.10.2


### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- [#211](https://github.com/qlan-ro/mainframe/pull/211) [`e68cc02`](https://github.com/qlan-ro/mainframe/commit/e68cc0208812a6b308fee2d97d7859a443cdf323) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent `TurnFooter` crashes from bringing down the whole chat turn, and log renderer-process crashes so blank-screen bugs leave a trace.
  - `TurnFooter`: local error boundary. `assistant-ui`'s `tapClientLookup` can throw `"Index N out of bounds (length: N)"` during concurrent renders when the external messages array shrinks between a parent capturing its index and a descendant hook reading it. The boundary scopes the failure to the footer and auto-resets on the next render; the rest of the turn keeps rendering.
  - `main`: listen for `render-process-gone` and log `{ reason, exitCode }`. Renderer crashes (OOM, GPU, killed) previously left no trace because React `ErrorBoundary` only catches render errors, not process-level failures.

- Updated dependencies [[`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306)]:
  - @qlan-ro/mainframe-core@0.10.2
  - @qlan-ro/mainframe-types@0.10.2


## 0.10.1


### Patch Changes

- [#206](https://github.com/qlan-ro/mainframe/pull/206) [`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.10.1


### Patch Changes

- [#206](https://github.com/qlan-ro/mainframe/pull/206) [`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- Updated dependencies [[`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b)]:
  - @qlan-ro/mainframe-core@0.10.1
  - @qlan-ro/mainframe-types@0.10.1


## 0.10.0


### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- Updated dependencies [[`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-types@0.10.0


### Minor Changes

- [#198](https://github.com/qlan-ro/mainframe/pull/198) [`6e90f97`](https://github.com/qlan-ro/mainframe/commit/6e90f97acf021565a1202f731c2510b147618ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add automatic update checking with status bar indicator

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#189](https://github.com/qlan-ro/mainframe/pull/189) [`afd0178`](https://github.com/qlan-ro/mainframe/commit/afd017863747e4acf41ea614b4642e6619b984db) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix memory leak: clean Maps on chat removal, add message eviction caps, unsubscribe inactive chats, cap nav stacks, clear LSP URIs

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- [#199](https://github.com/qlan-ro/mainframe/pull/199) [`f7c1133`](https://github.com/qlan-ro/mainframe/commit/f7c1133908a30ea0ea18c45fd5272b6ddd6fe87e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix terminal resize corruption by guarding fitAddon against zero dimensions and debouncing resize events

- [#201](https://github.com/qlan-ro/mainframe/pull/201) [`80026fd`](https://github.com/qlan-ro/mainframe/commit/80026fdaea261661e9d79e5a4ec8bd8b714c6112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Re-wire file editor into center panel split after zone-based layout rewrite

- [#193](https://github.com/qlan-ro/mainframe/pull/193) [`e26c46c`](https://github.com/qlan-ro/mainframe/commit/e26c46c2124dcb0baf679e8a5c2e572c786e86cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Parallelize startup API calls, lazy-load infrequent chat cards, add passive scroll listener

- [#195](https://github.com/qlan-ro/mainframe/pull/195) [`a6a3bd7`](https://github.com/qlan-ro/mainframe/commit/a6a3bd789454c74a39e9a7268611acc48cf4d76b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Optimize Zustand store selectors and add React.memo to list components to reduce re-renders

- Updated dependencies [[`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5), [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e), [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-core@0.10.0
  - @qlan-ro/mainframe-types@0.10.0


### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels


## 0.9.0


### Minor Changes

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#181](https://github.com/qlan-ro/mainframe/pull/181) [`0d1b34f`](https://github.com/qlan-ro/mainframe/commit/0d1b34f8e41b65b3474a41c3fc18cdcd762bb6f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Append system prompt to Claude sessions instructing use of AskUserQuestion tool

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- Updated dependencies [[`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f), [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22)]:
  - @qlan-ro/mainframe-types@0.9.0


### Minor Changes

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add integrated terminal panel with node-pty and xterm.js

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#184](https://github.com/qlan-ro/mainframe/pull/184) [`42efa20`](https://github.com/qlan-ro/mainframe/commit/42efa2069c59429f721f5fb01809ea406a4d3fb2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow app-protocol URLs (slack://, vscode://, figma://, etc.) to render as clickable links in chat messages

- Updated dependencies [[`0d1b34f`](https://github.com/qlan-ro/mainframe/commit/0d1b34f8e41b65b3474a41c3fc18cdcd762bb6f4), [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f), [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22)]:
  - @qlan-ro/mainframe-core@0.9.0
  - @qlan-ro/mainframe-types@0.9.0


### Minor Changes

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service


## 0.8.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.8.1


### Patch Changes

- [#178](https://github.com/qlan-ro/mainframe/pull/178) [`80d7698`](https://github.com/qlan-ro/mainframe/commit/80d7698832270d83cb55185e32b697e98f607d89) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pass default model when creating new chat sessions and show compacting indicator

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.8.1
  - @qlan-ro/mainframe-core@0.8.1


## 0.8.0


### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#176](https://github.com/qlan-ro/mainframe/pull/176) [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): read correct field path for context_usage control response

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0


### Minor Changes

- [#175](https://github.com/qlan-ro/mainframe/pull/175) [`6a1107f`](https://github.com/qlan-ro/mainframe/commit/6a1107f6a10893725a433befb1dc834c3ac71df5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add "Copy Reference" context menu action to Monaco editors

### Patch Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

- [#171](https://github.com/qlan-ro/mainframe/pull/171) [`27ee58a`](https://github.com/qlan-ro/mainframe/commit/27ee58af44a8019e3fc7f3152db2f358e3849201) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix preview URL not updating when switching to a worktree session

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0
  - @qlan-ro/mainframe-core@0.8.0


### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service


## 0.7.0


### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

### Patch Changes

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): add --ff-only to pull commands to prevent merge commits on divergent branches

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): pass localBranch to pull service so non-current branches use fetch instead of ff-only pull

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20)]:
  - @qlan-ro/mainframe-types@0.7.0


### Minor Changes

- [#163](https://github.com/qlan-ro/mainframe/pull/163) [`919fa40`](https://github.com/qlan-ro/mainframe/commit/919fa406bb5a006f49301a2e9d3841351f955e42) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): make file paths in tool cards clickable to open in editor

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#162](https://github.com/qlan-ro/mainframe/pull/162) [`58346d2`](https://github.com/qlan-ro/mainframe/commit/58346d2f9a217814241dfcce7e8fac48aac009f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): session rename context menu, copy tool output, scroll to diff

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#158](https://github.com/qlan-ro/mainframe/pull/158) [`105deb5`](https://github.com/qlan-ro/mainframe/commit/105deb59ffcc59076e32362d4ea8f63c576c6999) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add sorting options (by number, priority, type) to the tasks board columns

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

- [#167](https://github.com/qlan-ro/mainframe/pull/167) [`26b6bf7`](https://github.com/qlan-ro/mainframe/commit/26b6bf76e2e8f02c1dca1e11edd2257581ca74ff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show unread and waiting count badges on project filter pills and bold unread session titles

### Patch Changes

- [#168](https://github.com/qlan-ro/mainframe/pull/168) [`c04af83`](https://github.com/qlan-ro/mainframe/commit/c04af838d05cc96107996989345b037be82e289b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Restore composer draft persistence across chat switches and clean up drafts on archive

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#157](https://github.com/qlan-ro/mainframe/pull/157) [`8b9ce57`](https://github.com/qlan-ro/mainframe/commit/8b9ce57a6dfcd5d2ba26817e347ebf29e9519aed) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename default session label from "New Chat" to "Untitled session" to match mobile

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20), [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e)]:
  - @qlan-ro/mainframe-types@0.7.0
  - @qlan-ro/mainframe-core@0.7.0


### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements


## 0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#142](https://github.com/qlan-ro/mainframe/pull/142) [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: stop button now works when background subagents are running

  Send SIGINT to CLI child process on interrupt to bypass the blocked stdin
  message loop. Also prevent message loss from the interrupt race condition
  by waiting for the process to fully exit before respawning.

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87)]:
  - @qlan-ro/mainframe-types@0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#146](https://github.com/qlan-ro/mainframe/pull/146) [`1cae6a5`](https://github.com/qlan-ro/mainframe/commit/1cae6a5aa923e14a45f851e4df5bd932c3c9040f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace native HTML title tooltips with Radix tooltip components across the desktop app for consistent styling and behavior

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3), [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d), [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87), [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010)]:
  - @qlan-ro/mainframe-core@0.6.0
  - @qlan-ro/mainframe-types@0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state


## 0.5.0


### Minor Changes

- [#124](https://github.com/qlan-ro/mainframe/pull/124) [`b180a50`](https://github.com/qlan-ro/mainframe/commit/b180a500b98c16a63069e4b97c93b0c755b62e55) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Claude Agent SDK adapter as second builtin plugin alongside CLI adapter

- [#125](https://github.com/qlan-ro/mainframe/pull/125) [`97ebe7c`](https://github.com/qlan-ro/mainframe/commit/97ebe7cedb7a5f999d58795dd8378befe78f95ab) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Codex builtin adapter plugin — OpenAI Codex CLI integration via app-server JSON-RPC protocol with interactive approvals, streaming events, and session management

- [#136](https://github.com/qlan-ro/mainframe/pull/136) [`cd326c6`](https://github.com/qlan-ro/mainframe/commit/cd326c65a1d73d35379624fcc8065ded83969803) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Support ${VAR:-default} variable expansion in launch.json for environment-driven port configuration

- [#135](https://github.com/qlan-ro/mainframe/pull/135) [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: support enabling and attaching worktrees mid-session

  When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.

### Patch Changes

- [#123](https://github.com/qlan-ro/mainframe/pull/123) [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.

- [#119](https://github.com/qlan-ro/mainframe/pull/119) [`d59bafe`](https://github.com/qlan-ro/mainframe/commit/d59bafeef10fd3336060746c74ea11b24af82e7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Use the provided branch name for the worktree directory instead of a chatId prefix

- [#131](https://github.com/qlan-ro/mainframe/pull/131) [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add inline session rename via PATCH endpoint and pencil button

- [#134](https://github.com/qlan-ro/mainframe/pull/134) [`851ec20`](https://github.com/qlan-ro/mainframe/commit/851ec2015077de39717c16cdd13a2cc0f1fb038d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add todo-reader skill for querying project todos via sqlite3

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.5.0


### Patch Changes

- [#123](https://github.com/qlan-ro/mainframe/pull/123) [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.

- [#137](https://github.com/qlan-ro/mainframe/pull/137) [`3707218`](https://github.com/qlan-ro/mainframe/commit/37072188f8917544bba3bad9857af4829d6e9332) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow OAuth/SSO redirects to complete inside the sandbox webview instead of opening in the system browser. Persist webview sessions across app restarts via a dedicated Electron partition.

- [#135](https://github.com/qlan-ro/mainframe/pull/135) [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: support enabling and attaching worktrees mid-session

  When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.

- [#131](https://github.com/qlan-ro/mainframe/pull/131) [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add inline session rename via PATCH endpoint and pencil button

- Updated dependencies [[`b180a50`](https://github.com/qlan-ro/mainframe/commit/b180a500b98c16a63069e4b97c93b0c755b62e55), [`97ebe7c`](https://github.com/qlan-ro/mainframe/commit/97ebe7cedb7a5f999d58795dd8378befe78f95ab), [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569), [`d59bafe`](https://github.com/qlan-ro/mainframe/commit/d59bafeef10fd3336060746c74ea11b24af82e7e), [`cd326c6`](https://github.com/qlan-ro/mainframe/commit/cd326c65a1d73d35379624fcc8065ded83969803), [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329), [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2), [`851ec20`](https://github.com/qlan-ro/mainframe/commit/851ec2015077de39717c16cdd13a2cc0f1fb038d)]:
  - @qlan-ro/mainframe-core@0.5.0
  - @qlan-ro/mainframe-types@0.5.0


## 0.2.4

### Fixes

- Fix live session diffs and context.updated timing (#100)
- Only update session updatedAt on user message send (#99)
- Prevent stale messages when switching projects (#98)
- Deduplicate display messages by id to prevent assistant-ui crash (#96)

## 0.2.3

### Features

- Branch management popover (#92)
- Add LSP proxy for Monaco editor language features (#80)
- Add Find in Path content search from file tree (#79)
- Add reveal-in-tree for open editor files (#82)
- Add Cmd+Left/Right back/forward navigation in editor (#83)
- Derive session diffs from messages, improve branch diffs (#78)
- Add pino-pretty config for dev scripts (#81)

### Fixes

- Allow image-only messages by relaxing MessageSend schema (#93)
- Auto-refresh editor when agent edits the open file (#88)
- Prevent chat message text from overflowing container (#89)
- Restore nav-history code lost in PR #82 merge (#85)
- Allow Enter to send messages while response is in progress (#76)

### Chores

- Set up Changesets for version management (#87)
- Bump the dependencies group (#84)
- Bump pnpm/action-setup from 4 to 5 (#74)
- Add WIP disclaimer and Cloudflare Tunnel guide (#77)

## 0.2.2

### Features

- Add minimize button and toggle behavior to side panels (#73)
- Auto-refresh launch config dropdown on agent writes and window focus (#72)
- Move file view collapse button to pane header with expand strip (#71)
- Move fullview plugin buttons to left rail (#70)
- Auto-refresh file tree on agent writes, window focus, and manual trigger (#69)
- Handle deleted worktrees gracefully (#65)
- Improve tool display for Claude CLI sessions (#64)
- Copy session ID on session right-click (#51)
- Open external URLs in system browser (#56)
- Mobile view toggle for sandbox preview (#49)

### Fixes

- Preserve agent label in task groups and stable session list order (#68)
- Recover chat state after project switch and restore release notes (#67)
- Recognize Agent tool and update better-sqlite3 for Electron 41 (#66)
- Resolve multiple Changes tab bugs (#63)
- Preserve selected session when switching projects (#62)
- Show AskUserQuestion Q&A as inline chat messages (#61)
- Show skill name instead of full path in session context (#60)
- Simplify permission mode management (#59)
- Recover missed responses after tab/project switch (#58)
- Coerce numeric env values to strings in launch config schema (#57)
- Allow sending messages while agent is running (#52)
- Validate cwd before spawn, dynamic CSP for Electron (#53)
- Draft releases and deduplicate changelog (#54)

### Chores

- Bump dependencies (#55, #48, #47, #46, #45)
- macOS code signing + notarization (#50)

## 0.2.1

### Fixes

- Launch env isolation, imported sessions, macOS permissions (#43)
- Dev data dir, env vars, editor save, bottom panel fixes (#42)

## 0.2.0

### Features

- Tunnel self-check verification, named tunnel switch, fd leak fix (#41)
- Import external agent sessions (#29)
- File viewing improvements + Docker fixes (#28)
- Daemon distribution — Docker, standalone binary, CLI pairing (#26)
- Mobile companion app — tunneling, permissions, launch configs (#24)
- UX improvements — CLI path, dotfiles, context menu, selection (#20)
- DisplayMessage pipeline for client-ready messages (#19)
- Full-screen overlay when daemon connection is lost (#18)
- Custom commands infrastructure (#16)
- Replace Electron file picker with daemon-side directory browser (#14)
- Playwright E2E test suite (#9)

### Fixes

- Tunnel auth bypass via localhost exemption (#40)
- Defer CLI process spawn until first message (#22)
- Tutorial flow — action-gated steps, no overlay, modal-aware (#15)
- Sandbox security, scoping, and test coverage (#17)

### Chores

- Remove Docker support (#38)
- Electron-builder publish to non-draft release (#37)
- Repair all release pipelines (#36)
- Rename packages from @mainframe/* to @qlan-ro/mainframe-* (#35)
- Publish types to GitHub Packages (#34)
- WS event router, hook split, and stale-socket fix (#13)

## 0.1.0

Initial public release.

### Features

- Multi-session management with tabbed navigation
- Claude CLI adapter with full session lifecycle (start, resume, interrupt)
- Permission gating — review and approve each tool use before execution
- Live context window usage and cost tracking
- Session history replay via Claude CLI `--resume`
- Skills support — extend agents with project-specific tools and instructions
- Agent subagent tracking (left panel Agents tab)
- Keyboard-first navigation
- Dark theme with per-adapter accent colors
