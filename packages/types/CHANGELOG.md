# @qlan-ro/mainframe-types

## 2.0.0-rc.10

### Minor Changes

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.
