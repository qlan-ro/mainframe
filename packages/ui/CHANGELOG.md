# @qlan-ro/mainframe-ui

## 2.0.0-rc.11

### Minor Changes

- [#480](https://github.com/qlan-ro/mainframe/pull/480) [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an ambient provider-quota indicator to the sidebar footer, showing headroom for Claude and Codex's account-wide rate-limit windows. Each row surfaces the tightest active window as a ring, percentage, and relative reset time, turning amber then red as it nears the wall; clicking it opens a popover listing every window (session, weekly, and Claude's model-scoped weekly windows) with absolute reset timestamps and a manual refresh. Claude quota comes from a stateless `claude -p "/usage"` pull plus the `rate_limit_event` push; Codex from the `account/rateLimits/updated` push and on-demand `rateLimits/read` pull. Numbers are always the provider's own authoritative figures — never a local estimate — and fail closed to a "quota unknown" state when data is stale, expired, or the signed-in account can't be identified, so a provider swap never shows the wrong account's headroom. State persists across daemon restarts and behaves identically under the Node and Rust (`core-rs`) daemon implementations.

### Patch Changes

- [#476](https://github.com/qlan-ro/mainframe/pull/476) [`cc4a2ad`](https://github.com/qlan-ro/mainframe/commit/cc4a2ad3ab43f6aff608b2a5860881b584397b5d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the session archive flow. Archiving a session with no git worktree no longer raises a confirm dialog — there was nothing to decide, since the dialog exists only to ask what should happen to the worktree.

  Sessions with a worktree are now asked before anything moves, not after. assistant-ui switches the active thread away the moment `archive()` is called, so prompting from inside the adapter changed the selected session while the dialog was still open, and cancelling stranded the user on an empty draft instead of returning them to the session they had just chosen to keep. The row now settles the question first and only then archives, so a cancel leaves both the session and the selection untouched.

  Project rows offer a remove button on hover, alongside the existing right-click menu item. The session row's archive action uses an archive icon instead of an X.

- [#477](https://github.com/qlan-ro/mainframe/pull/477) [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix picking a project in the "All projects" view doing nothing. The picker read the draft thread's id before anything had created one — assistant-ui only mints that id inside `switchToNewThread`, and clears it again every time a draft is committed on first send — so the handler hit its null guard and returned silently. It now creates the draft first and seeds it afterwards.

  A new session started from the picker also honors the configured default adapter, matching the path taken when a project is already selected; it previously always started on Claude.

- [#475](https://github.com/qlan-ro/mainframe/pull/475) [`219ace1`](https://github.com/qlan-ro/mainframe/commit/219ace16e7be524b8282307dcd13e5b8f185e402) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The sessions list no longer reserves layout width for a scrollbar that is invisible at rest. A global `scrollbar-width: thin` made WebKit render a classic, space-reserving bar, shrinking every row by 13px to line a gutter whose thumb is transparent until hover; the list now uses a Radix ScrollArea, whose absolutely-positioned thumb overlays the rows at no layout cost.

  Fixes a latent bug in the shared `ScrollArea`: its `[&>div]:!block` rule used Tailwind v3's important-prefix syntax, which compiles to nothing under Tailwind v4, so the rule had never taken effect. Radix's `display: table` viewport wrapper now gets a viewport-bounded width as intended, restoring `truncate` on flex rows in every ScrollArea.

  The Tasks section now shows at most five tasks with a "View all N tasks" row, and sits in the bottom cluster below the flexible spacer. Project rows reserve full-strength foreground for the unread signal instead of using it at rest, matching the session-row convention.

- [#477](https://github.com/qlan-ro/mainframe/pull/477) [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Initialize new session composers with the same snapshotted defaults used on first send.

- Updated dependencies [[`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.10
