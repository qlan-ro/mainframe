# @qlan-ro/mainframe-e2e

## 0.1.1-rc.2

### Patch Changes

- [#609](https://github.com/qlan-ro/mainframe/pull/609) [`1d56239`](https://github.com/qlan-ro/mainframe/commit/1d56239afaddacbcdf24157cb72ec66b90eaf233) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a committed testid-inventory generator (`pnpm --filter @qlan-ro/mainframe-e2e run testids`) and regenerate `UNUSED-TESTIDS.md` and `COVERAGE-GAP-REPORT.md` against the current single-tree UI, replacing the stale hand-rebuilt docs and their unreproducible `/tmp` regeneration script.

## 0.1.1-rc.1

### Patch Changes

- [#525](https://github.com/qlan-ro/mainframe/pull/525) [`84e28ef`](https://github.com/qlan-ro/mainframe/commit/84e28ef751338b9f237a2c84647d2dff00388c16) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Copy file paths and quote text straight from a chat message.

  Right-clicking a file path in a tool result offers Copy Absolute Path and Copy Relative Path. Both are derived from the same worktree and project roots that left-clicking the path opens with, so the path you copy and the file you open can never disagree. Markdown links keep their own copy/open menu, and paths inside a subagent transcript are left to the system menu.

  Selecting text in a message raises a floating toolbar with Quote and New session. Quote adds the selection to the composer as its own quote with its own comment box, so several passages — including passages from different messages — can be quoted and sent as one message. New session opens a draft on the same project, prefilled with the selection. Neither action sends anything on its own. The editor's Add Agent Context now adds a quote the same way, and a quote carrying no comment can be sent for the first time.

## 0.1.1-rc.0

### Patch Changes

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the Tauri Playwright suite against the Rust daemon and its native mock replay adapter, remove the legacy Electron test arm, and make filtered draft creation resilient to adapter-catalog loading and reused draft slots.

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Speed up the Tauri e2e sweep by cutting per-describe fixture cost. The vite preview server and headless Chromium are now started once for the whole run and shared across describes (each describe still gets an isolated BrowserContext and a fresh daemon), and the first-run tour is suppressed before first paint so boot no longer double-navigates. Under `E2E_MODE` the Rust daemon also skips its login-shell PATH probe and the claude/codex `--version`/catalog refresh — both pure boot-time subprocess costs the mock suite never needs — dropping daemon readiness from ~3.5s to ~0.7s per describe.
