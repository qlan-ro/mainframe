# @qlan-ro/mainframe-desktop

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

- [#354](https://github.com/qlan-ro/mainframe/pull/354) [`f1e8b64`](https://github.com/qlan-ro/mainframe/commit/f1e8b64a1ea81bef5f87124d6521b768c5ac3dd2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: handle width-overflow across chat/status/panel/title-bar rows

  Adds two shared UI primitives, `<ScrollRow>` (horizontal scroll with
  fading-edge masks + focusin auto-scroll, LTR-only) and `<TruncatedLabel>`
  (truncate + min-w-0 + opt-in native title + forwardRef for Radix
  TooltipTrigger asChild), and refactors PR badges, the chat session bar,
  status bar, selector breadcrumb, tag filter row, context section title,
  project group names, task card header, schedule pill, context file
  items, the title bar, the skills panel, and the flat session row
  actions column to use them.

  Title bar layout was rewritten to a `[1fr_auto_1fr]` grid so the project
  name, centered search box, and launch picker can each truncate
  independently without overlapping at narrow widths.

  FlatSessionRow's time column was collapsed to one line and the hover
  actions now overlay absolutely so the actions slot doesn't reserve
  width when not hovered.

  Composer bottom row now wraps so Send/Stop stays inside the card at
  narrow widths. The deeper popover-portal port (so dropdown menus can
  live inside a `ScrollRow` without clipping) is still tracked as a
  follow-up.

  Fixes [#182](https://github.com/qlan-ro/mainframe/issues/182).

### Patch Changes

- Updated dependencies [[`86ccfd9`](https://github.com/qlan-ro/mainframe/commit/86ccfd99be4d09d485748aa8320b3f4f8a90c35a), [`ca461cd`](https://github.com/qlan-ro/mainframe/commit/ca461cdf58c712b6d7c5a960a50f8ea4c68f436f)]:
  - @qlan-ro/mainframe-core@0.20.0
  - @qlan-ro/mainframe-types@0.20.0
