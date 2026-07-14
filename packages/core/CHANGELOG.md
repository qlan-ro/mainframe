# @qlan-ro/mainframe-core

## 2.0.0-rc.8

### Minor Changes

- [#465](https://github.com/qlan-ro/mainframe/pull/465) [`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations: add a read-only details view (Overview/Runs tabs, reached by clicking a library row) and make project scoping real. Automations now save non-configurably to the session's active project — the scope toggle is gone, the library filters to it, and Agent steps inherit it automatically with a real branch picker for their worktree's base branch. Also: removed the non-functional per-tool auto-approve chips (permission mode already covers this), added a short inline explanation for the agent step's "Result" token, and replaced the hardcoded model list with the live provider/model catalog.

- [#466](https://github.com/qlan-ro/mainframe/pull/466) [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Hide automation-created chats from the default sessions list. `ask_agent` steps now stamp the new chat with `automationRunId`, and the daemon excludes those chats from the default `/api/chats` list — they remain reachable directly (e.g. "Open agent chat" from a workflow run).

- [#464](https://github.com/qlan-ro/mainframe/pull/464) [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a global "Default provider" setting (Settings → Providers) that picks which adapter seeds new chats, replacing the hardcoded Claude default. Also fix the top-level "Providers" nav item showing a blank pane until a specific provider was picked underneath it — it now auto-selects the first installed adapter.

### Patch Changes

- Updated dependencies [[`6ffd7ec`](https://github.com/qlan-ro/mainframe/commit/6ffd7eca28cbbfb269babe0b088b15402dfbb62f), [`20f3266`](https://github.com/qlan-ro/mainframe/commit/20f32662d1e1d4095fc5f0e4f426e97ed3f59ad3), [`ef2b51c`](https://github.com/qlan-ro/mainframe/commit/ef2b51c6fdde0f5f0e8649f86055f7856ba7d7af)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.8
