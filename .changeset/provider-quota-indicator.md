---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-ui': minor
---

Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.
