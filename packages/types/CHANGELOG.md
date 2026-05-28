# @qlan-ro/mainframe-types

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
