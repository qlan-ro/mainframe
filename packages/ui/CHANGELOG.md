# @qlan-ro/mainframe-ui

## 2.0.0-rc.1

### Patch Changes

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix archiving the active session dumping you on the empty new-session screen.

  assistant-ui's remote thread list calls `switchToNewThread()` off the archived
  thread _before_ marking it archived, so `mainThreadId` becomes a fresh
  `__LOCALID_*` draft and the existing archived-active fallback (which keyed on the
  active thread still being archived) never fired. The session router now remembers
  the last real (non-draft) thread and, when an archive bumps you onto an empty
  draft, redirects to a fallback session — the last-used one if still live, else
  the most-recently-updated non-archived session, respecting the active project
  filter. A deliberate "New" leaves the previous session regular, so it is not
  redirected.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix background sessions losing messages while another chat is open.

  A chat's live WS subscription is gated to the active thread, so a backgrounded
  chat receives no message events while dormant — the daemon still persists them,
  but the transcript stayed frozen at the pre-dormancy snapshot. On `subscribe:ack`
  the catch-up re-seed only fired for a socket reconnect or an unreconciled
  optimistic send, so simply switching back to a chat never healed the gap and the
  messages that arrived while it was backgrounded stayed invisible until a full
  reconnect.

  The controller now tracks when a live sub is torn down and treats the next
  attach as a post-dormancy reattach, re-seeding history from REST on the reattach
  ack (like a reconnect). Row-level unread notifications were unaffected — they run
  on a separate always-on session-list subscription — so this only restores the
  missed transcript content on switch-back.

- [#404](https://github.com/qlan-ro/mainframe/pull/404) [`46ff525`](https://github.com/qlan-ro/mainframe/commit/46ff52532fd86a2fcccd982d51935dd9fdd8778d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix two session/editor UX bugs:
  - Selecting a project filter with no sessions now opens a new-session draft
    instead of stranding the previously-selected session from another project.
  - The Markdown preview is now selectable, so its prose can be copied — the
    `mf-editor-selectable` opt-in class was referenced by the editor surfaces but
    never defined in the selection whitelist.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.1

## 2.0.0-rc.0

### Major Changes

- [#398](https://github.com/qlan-ro/mainframe/pull/398) [`17a2630`](https://github.com/qlan-ro/mainframe/commit/17a26309dd9369ac6a381642a5377cb0a81ad77e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Mainframe 2.0 — Tauri desktop shell.

  Ships the Tauri 2 desktop app (`@qlan-ro/mainframe-app-tauri`) alongside the
  existing Electron shell. The React renderer moves into a shared
  `@qlan-ro/mainframe-ui` package consumed by both shells, the daemon ships as a
  bundled Node sidecar, and the UI is rebuilt on assistant-ui + shadcn/ui. Also
  includes the workflows engine, remote-daemon support, and a browser-mode
  Playwright e2e suite.

### Patch Changes

- Updated dependencies [[`17a2630`](https://github.com/qlan-ro/mainframe/commit/17a26309dd9369ac6a381642a5377cb0a81ad77e)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.0
