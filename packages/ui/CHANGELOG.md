# @qlan-ro/mainframe-ui

## 2.0.0-rc.27

### Minor Changes

- [#634](https://github.com/qlan-ro/mainframe/pull/634) [`a8ec7b1`](https://github.com/qlan-ro/mainframe/commit/a8ec7b1878df3f9562591ab070a90bff98e8a8d2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add the Claude CLI's native `auto` permission mode as a fourth, capability-gated execution mode. The composer picker, provider settings, automations Ask-Agent chip, and plan gate all offer Auto for adapters that advertise it, letting Claude decide which actions need approval without leaving Mainframe's permission gate.

### Patch Changes

- [#632](https://github.com/qlan-ro/mainframe/pull/632) [`8d6573e`](https://github.com/qlan-ro/mainframe/commit/8d6573ea5c406d9f634edcf99cef8d16c86aa5cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix background-task output never loading. The daemon derived the Claude
  CLI's spool directory from a uid it never read, so it looked for task output
  in `/tmp/claude-0` — a directory that does not exist for a normal user — and
  the output request failed as an invalid path. The same wrong directory meant
  tasks were not recovered after a daemon restart, shells writing into a
  removed worktree were never signalled, and live bash tasks were falsely
  reported as stopped. The daemon now reads its real uid.

- [#643](https://github.com/qlan-ro/mainframe/pull/643) [`8691fa5`](https://github.com/qlan-ro/mainframe/commit/8691fa5534814a27fefacce6921847e43ee6b37f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pull requests opened from a Codex session are now detected, live and on reload. PR detection moved off the Claude adapter onto the shared message stream every adapter emits, and the cold-load rescan now reads a Codex chat's rollout JSONL instead of `thread/read`, whose 0.147.0 response never carried command output.

- [#637](https://github.com/qlan-ro/mainframe/pull/637) [`b1c083c`](https://github.com/qlan-ro/mainframe/commit/b1c083c0675166d87e0d89df94d37df6e7fdc3b6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A Codex session's sub-agents now show up in the Activity panel and the rail's running count while they work, the way Claude's sub-agents already do.

- [#639](https://github.com/qlan-ro/mainframe/pull/639) [`67bbe2e`](https://github.com/qlan-ro/mainframe/commit/67bbe2e31db47c4eb81375f41c1d52c1a93afa4a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A pull request created during a live turn now appears in the open session without reopening it.

- [#630](https://github.com/qlan-ro/mainframe/pull/630) [`ac1e24d`](https://github.com/qlan-ro/mainframe/commit/ac1e24da04fa7d215107c5083a1166320059e60a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replayed sessions now report their background work, including workflow runs. The
  mock adapter derives background-task start/end from the message stream — a
  `Workflow` tool use starts a workflow row and seeds its run, `Task`/`Agent` start
  subagent rows, a backgrounded `Bash` starts a shell row, and a matching
  `tool_result` ends whichever it was. Work a recording never resolves keeps
  running. A fixture can also ship a full `ClaudeWorkflowRun` snapshot via the
  `onWorkflowRun` recorded method, so the run panel's phases, agent grid, token
  counts and "up next" render under replay.

  Until now the Activity panel, the rail's pulse dot, `summarizeByKind` and the
  whole workflow-run surface were unreachable in mock mode — they always read
  "Nothing running" — which left them untestable as well as undemoable. Adds a
  `workflow` fixture: a four-phase release-readiness run, six agents, two phases
  still going.

- [#644](https://github.com/qlan-ro/mainframe/pull/644) [`d014308`](https://github.com/qlan-ro/mainframe/commit/d01430816d09011120ee446bb438ffe0a435e02d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A permission request, a question, or a plan awaiting your answer now sits above
  the composer instead of at the end of the transcript, so it stays in view while
  you scroll back through the run it is blocking. The pinned slot caps itself at
  45% of the thread pane and scrolls inside itself, so a long plan never pushes
  the composer off screen — and, symmetrically, a long queued draft in the
  composer can no longer starve the slot down to nothing. Answering the gate
  returns the space to the transcript.

- [#645](https://github.com/qlan-ro/mainframe/pull/645) [`5015858`](https://github.com/qlan-ro/mainframe/commit/5015858fbdcbc031a5e278d4d5bb365c73964d84) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Previewing a Mainframe dev server no longer hangs on "Connecting to the daemon". The nested app was mistaking the preview webview for the host app.

- [#642](https://github.com/qlan-ro/mainframe/pull/642) [`7c4da91`](https://github.com/qlan-ro/mainframe/commit/7c4da91cd38efed5ae4f0299a1dc7ad52353f185) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the sidebar's hand-rolled scroll-edge fade with the shadcn `scroll-fade` utility, keeping only the sticky-header inset measurement and feeding it through the utility's mask override. The session panel's card bodies, the session tab strip, and the attachment rail now fade with content past their edges instead of clipping. The workspace tab strip also picked up the fade — it wasn't named in the brief, but leaving it clipped beside a fading session tab strip would keep the exact inconsistency this change removes.

  Engines older than the `animation-timeline: scroll()` floor (confirmed live on macOS 26.4.1; the exact lower bound is unconfirmed) now get the pre-adoption clip instead of shadcn's fallback, which pins a permanent both-edges dim.

- [#638](https://github.com/qlan-ro/mainframe/pull/638) [`17f377d`](https://github.com/qlan-ro/mainframe/commit/17f377d9d1e4927ee2159d25386e1bffc92efdb1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Sort the sidebar's session list by recent activity in every grouping. Grouping by project used to list each project's sessions in the order the app happened to receive them — an order that changed between restarts — and the name and status modes left their ties there too. Each section now leads with the most recently active session, and every mode resolves ties the same way.

- [#641](https://github.com/qlan-ro/mainframe/pull/641) [`97d17f7`](https://github.com/qlan-ro/mainframe/commit/97d17f792d9769a69829d669daa67ac24c6c50d0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Order the session rail's Tasks panel by last touched, in-progress tasks above open ones, so a task you just added or edited sits at the top instead of the bottom.

- [#636](https://github.com/qlan-ro/mainframe/pull/636) [`4576784`](https://github.com/qlan-ro/mainframe/commit/4576784d88678e285be80dd5ffd78bf7282db8b0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Kanban board and the Automations library each get their own in-modal project picker, seeded from the sidebar's project filter on every open. Both surfaces now always open — with no session active or a projectless draft, they offer a project picker instead of a dead click — and an in-modal change is local to that open: it never writes back to the sidebar filter and is forgotten on close.

- Updated dependencies [[`a8ec7b1`](https://github.com/qlan-ro/mainframe/commit/a8ec7b1878df3f9562591ab070a90bff98e8a8d2)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.27
