# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.15

### Minor Changes

- [#506](https://github.com/qlan-ro/mainframe/pull/506) [`2b4cad3`](https://github.com/qlan-ro/mainframe/commit/2b4cad32bd62fba2cdde5199d1022746dfd74f9b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sub-agent (CollabAgent) work now streams into the TaskCard live and reload now reconstructs sub-agent file edits and MCP calls in addition to bash commands.

- [#510](https://github.com/qlan-ro/mainframe/pull/510) [`a8d1a56`](https://github.com/qlan-ro/mainframe/commit/a8d1a56129d30d88dc22901f59db0577b72dd326) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Retire the Node.js daemon sidecar from the Tauri shell. `externalBin` now ships only the Rust `mainframe-daemon` binary (packages/core-rs); the bundled Node runtime, `daemon.cjs` resource bundle, and the `MAINFRAME_DAEMON_IMPL` canary flag are gone. Packaged builds are smaller and no longer carry a second copy of `better-sqlite3`/`node-pty`/LSP servers alongside the app.

### Patch Changes

- [#507](https://github.com/qlan-ro/mainframe/pull/507) [`f83a776`](https://github.com/qlan-ro/mainframe/commit/f83a776c67e3235286e6f1caf2ad746bcd5a9b87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close four Codex routing gaps that dropped or mis-rendered content in the chat view.

  Diff-unavailable edits now fall back to a plain message instead of an empty `EditFileCard`. A `Task` item with no recorded subagent children still renders as a `TaskCard` rather than vanishing. `imageGeneration` items with an inline result now survive a chat reload instead of being dropped by history conversion. `webSearch` items are now routed to the existing `WebSearch` tool card (registered in `register-cards.ts`) in both the live stream and history reload, emitted as an already-complete tool-use/tool-result pair since Codex never sends a separate result event for it.

- [#505](https://github.com/qlan-ro/mainframe/pull/505) [`750844f`](https://github.com/qlan-ro/mainframe/commit/750844f3e39905c122f05fe298ecca92dc8ebf3c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show a live "Compacting…" pill in the transcript that resolves into "Context compacted", for Claude and Codex.

- [#511](https://github.com/qlan-ro/mainframe/pull/511) [`e92e89e`](https://github.com/qlan-ro/mainframe/commit/e92e89e2a820f2389c59392ded94b03619ead16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a stop→restart race in the launch manager: restarting a config while its previous process was still being torn down (SIGTERM grace window) was silently ignored, leaving the preview stuck on the stopped CTA. `start` now waits for the dying process to exit and then spawns fresh; only genuinely starting/running processes still skip the duplicate start.

- [#510](https://github.com/qlan-ro/mainframe/pull/510) [`a8d1a56`](https://github.com/qlan-ro/mainframe/commit/a8d1a56129d30d88dc22901f59db0577b72dd326) Thanks [@doruchiulan](https://github.com/doruchiulan)! - PR 3 of the Rust-daemon cutover: the Tauri shell now boots the Rust `mainframe-daemon` by default. `MAINFRAME_DAEMON_IMPL=node` (or a persisted `daemonImpl: "node"` app setting) still selects the legacy Node sidecar as a rollback path until it's retired in PR 4 — this PR only flips the unset default from Node to Rust.

- Updated dependencies [[`f83a776`](https://github.com/qlan-ro/mainframe/commit/f83a776c67e3235286e6f1caf2ad746bcd5a9b87), [`750844f`](https://github.com/qlan-ro/mainframe/commit/750844f3e39905c122f05fe298ecca92dc8ebf3c), [`8425ab4`](https://github.com/qlan-ro/mainframe/commit/8425ab4c8c52d4d7abdfc8a3d826c3fa0f8ecc6a)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.15

## 2.0.0-rc.14

### Patch Changes

- [#496](https://github.com/qlan-ro/mainframe/pull/496) [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dependency refresh: Vite 8 + plugin-react 6 in the UI package, Electron 43, assistant-ui 0.14.27, CodeMirror patch pins, and in-range updates across the workspace. Removes the unused vscode-jsonrpc dependency from core. GitHub Actions bumped to checkout@v7, setup-node@v7, upload-artifact@v7, tauri-action@v1, and import-codesign-certs@v7.

  Drops Node 20 support: the engines floor is now Node 22.12+ and CI runs Node 22. That unblocks better-sqlite3 13 (now on N-API prebuilds, ending Electron rebuild pain), nanoid 6, and @testing-library/jest-dom 7 — all taken here.

  Held back deliberately: TypeScript 7 (typescript-eslint does not support it yet) and monaco-editor 0.56 (monaco-languageclient 10.x pins 0.55.1).

- Updated dependencies [[`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86), [`305c5f7`](https://github.com/qlan-ro/mainframe/commit/305c5f79273a74d379b09493db990427b533db2b), [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86), [`e5480df`](https://github.com/qlan-ro/mainframe/commit/e5480dfa900b945ab32ddf4a0bc8cadf0b4b49a5)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.14

## 2.0.0-rc.13

### Patch Changes

- Updated dependencies [[`f2b0314`](https://github.com/qlan-ro/mainframe/commit/f2b0314f0586174d098b058c242be60a1e19f61b)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.13
