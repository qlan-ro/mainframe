# @qlan-ro/mainframe-ui

## 2.0.0-rc.9

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
