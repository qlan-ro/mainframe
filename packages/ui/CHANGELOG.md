# @qlan-ro/mainframe-ui

## 2.0.0-rc.15

### Patch Changes

- [#507](https://github.com/qlan-ro/mainframe/pull/507) [`f83a776`](https://github.com/qlan-ro/mainframe/commit/f83a776c67e3235286e6f1caf2ad746bcd5a9b87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close four Codex routing gaps that dropped or mis-rendered content in the chat view.

  Diff-unavailable edits now fall back to a plain message instead of an empty `EditFileCard`. A `Task` item with no recorded subagent children still renders as a `TaskCard` rather than vanishing. `imageGeneration` items with an inline result now survive a chat reload instead of being dropped by history conversion. `webSearch` items are now routed to the existing `WebSearch` tool card (registered in `register-cards.ts`) in both the live stream and history reload, emitted as an already-complete tool-use/tool-result pair since Codex never sends a separate result event for it.

- [#505](https://github.com/qlan-ro/mainframe/pull/505) [`750844f`](https://github.com/qlan-ro/mainframe/commit/750844f3e39905c122f05fe298ecca92dc8ebf3c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show a live "Compacting…" pill in the transcript that resolves into "Context compacted", for Claude and Codex.

- [#504](https://github.com/qlan-ro/mainframe/pull/504) [`8425ab4`](https://github.com/qlan-ro/mainframe/commit/8425ab4c8c52d4d7abdfc8a3d826c3fa0f8ecc6a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sidebar now shows a session as Working while only background subagents are active.

  The sidebar's WS event router dropped `background_task.started|updated|ended` in its default case, so a session whose only live activity was a background subagent never triggered a reload — the badge stayed on Idle even though the daemon's `displayStatus` was already Working. The router now reloads the session list on all three background-task lifecycle events.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.13

## 2.0.0-rc.14

### Patch Changes

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the composer's provider-defaults staleness: the effort/features toolbar read a private once-fetched copy of provider settings, so a default-effort or default-model change made in Settings didn't reflect in the composer until an app reload. `useProviderDefaults` now reads the shared settings store the Settings pane writes optimistically, seeding it with one fetch when nothing has loaded it yet.

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the Tauri Playwright suite against the Rust daemon and its native mock replay adapter, remove the legacy Electron test arm, and make filtered draft creation resilient to adapter-catalog loading and reused draft slots.

- [#494](https://github.com/qlan-ro/mainframe/pull/494) [`e5480df`](https://github.com/qlan-ro/mainframe/commit/e5480dfa900b945ab32ddf4a0bc8cadf0b4b49a5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the crash on archiving a session ("Maximum update depth exceeded", React [#185](https://github.com/qlan-ro/mainframe/issues/185)).

  `useAdapters()` rebuilt its array on every render, and `useNewThreadAutoConfig` uses that array as an effect dependency — so the effect tore down and re-ran on every render. Both its body and its cleanup write to the store `ChatSurface` subscribes to, so each write re-rendered and re-armed it. Archiving the active session lands on an unresolved draft, which is the one state where that effect runs, so the loop crashed the window into the error boundary.

  `useAdapters()` is now memoized on the catalog, and `ChatSurface`'s no-active-thread fallback selects a shared idle value instead of a fresh object literal.

- Updated dependencies [[`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.12

## 2.0.0-rc.13

### Patch Changes

- [#492](https://github.com/qlan-ro/mainframe/pull/492) [`f2b0314`](https://github.com/qlan-ro/mainframe/commit/f2b0314f0586174d098b058c242be60a1e19f61b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Capture full diagnostics when a render error is caught. The error boundary now
  logs the error stack and React component stack durably through the host (so
  packaged builds record crashes without devtools), and "Copy details" copies the
  full stack bundle instead of just the one-line message.
