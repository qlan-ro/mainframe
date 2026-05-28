# @qlan-ro/mainframe-core

## 0.20.0

### Minor Changes

- [#357](https://github.com/qlan-ro/mainframe/pull/357) [`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(bg-tasks): reconciliation, liveness sweep, and auto-kill

  Background tasks now survive daemon restarts AND suspend/resume. On startup
  the daemon walks the Claude CLI spool directory, validates each `.output`
  file against the active chat's session ID and encoded cwd, and uses `lsof`
  (write-mode FDs only) to detect live writers. While the daemon is alive a
  60s liveness sweep watches for tasks the CLI lost track of (laptop sleep,
  missed signals, event-loop stalls); a wallclock-jump heuristic detects wake
  and skips the two-strike grace window. Recovered tasks appear in the pill
  with a `↻` marker and remain killable from the UI.

  On chat archive, chat end, project removal, and direct worktree deletion,
  a new `killTasksForChat` helper runs **before** the CLI is killed so
  `stop_task` has a live target. Any survivor is signaled via
  `lsofWriters → SIGTERM/SIGKILL`. A provenance-scoped sweep limited to spool
  files under the worktree's encoded prefix catches untracked stragglers
  without touching editors, language servers, or shells with cwd in the
  worktree.

  Fixes the bug where 7h-old phantom task rows could not be cleared after
  the CLI session lost track of them — the kill route now falls back to
  OS-level termination instead of returning 503.

### Patch Changes

- [#353](https://github.com/qlan-ro/mainframe/pull/353) [`ca461cd`](https://github.com/qlan-ro/mainframe/commit/ca461cdf58c712b6d7c5a960a50f8ea4c68f436f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Send `message.queued.snapshot` on `chat.resume` so the composer banner
  reconverges on the daemon's truth whenever the client re-opens a chat.

  Previously only the (rarely-used) `subscribe` WS handler emitted this
  snapshot; `chat.resume` (which the desktop fires every time a chat view
  mounts) just added the chat to the subscription set without seeding the
  queue state. The result: a queued message that the CLI processed while
  the client was unsubscribed (because the user had switched chats) would
  stay stranded in the composer banner forever, even though the daemon
  had already pruned the ref. The bubble's `metadata.queued` flag silently
  cleared on re-entry — `useChatSession` HTTP-refetches messages from
  JSONL, which never carries that transient flag — so the user saw a
  stuck composer entry alongside a clean message bubble.

  The two WS handlers now share a private `sendQueuedSnapshot` helper.

- Updated dependencies [[`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a)]:
  - @qlan-ro/mainframe-types@0.20.0
