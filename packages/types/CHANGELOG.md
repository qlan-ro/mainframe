# @qlan-ro/mainframe-types

## 0.17.0

### Patch Changes

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.
