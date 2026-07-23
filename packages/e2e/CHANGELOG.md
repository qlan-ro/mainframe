# @qlan-ro/mainframe-e2e

## 0.1.1-rc.0

### Patch Changes

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the Tauri Playwright suite against the Rust daemon and its native mock replay adapter, remove the legacy Electron test arm, and make filtered draft creation resilient to adapter-catalog loading and reused draft slots.

- [#500](https://github.com/qlan-ro/mainframe/pull/500) [`fe027bc`](https://github.com/qlan-ro/mainframe/commit/fe027bc6648f60cdc9871ce06df421e938d8be86) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Speed up the Tauri e2e sweep by cutting per-describe fixture cost. The vite preview server and headless Chromium are now started once for the whole run and shared across describes (each describe still gets an isolated BrowserContext and a fresh daemon), and the first-run tour is suppressed before first paint so boot no longer double-navigates. Under `E2E_MODE` the Rust daemon also skips its login-shell PATH probe and the claude/codex `--version`/catalog refresh — both pure boot-time subprocess costs the mock suite never needs — dropping daemon readiness from ~3.5s to ~0.7s per describe.
