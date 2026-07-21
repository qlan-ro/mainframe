# @qlan-ro/mainframe-core

## 2.0.0-rc.10

### Minor Changes

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.

### Patch Changes

- [#479](https://github.com/qlan-ro/mainframe/pull/479) [`d428031`](https://github.com/qlan-ro/mainframe/commit/d428031ac7cc14c5cd0295632db3b4990c3a0691) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show context usage percentages for Codex sessions.

- [#481](https://github.com/qlan-ro/mainframe/pull/481) [`12a4d83`](https://github.com/qlan-ro/mainframe/commit/12a4d83a2fdb9ca688c37fc07c264bb5e1335a9c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add GitHub sync fields to the todos plugin schema so issue creation/sync has somewhere to write closed_at, state_reason, author, and remote linkage.

- Updated dependencies [[`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.10
