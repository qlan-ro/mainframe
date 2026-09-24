# Activity enhancements: stop, details, missing types

Todo #328. Sources: the todo's `## Agent Brief`, the 2026-08-28 design walk (parked), and
the `## Design direction` resolved on 2026-09-23 (variant B, drill-in; prototype branch
`prototype/design-walk-2026-09-23-activity`, never merged). The brief's claims were
re-checked against `main` at `ac600067`. `## Decisions` records each contradiction found.

## Problem

The Activity panel lists a session's live background work: subagents, background shell
commands, Monitor-tool watchers, and workflow runs. Each row shows a glyph, a description,
a kind label, and a ticking elapsed time. Workflow rows drill into their run panel. Every
other row is inert. The user cannot stop a runaway task from the UI, even though the daemon
can. The user also cannot see anything the daemon already knows about a task: its command,
status, summary, usage, or output.

The panel also hides information. A task that finishes, fails, or is stopped disappears
immediately, so its outcome is never visible and nothing shows that it ran. Monitor-tool
work and a background shell command look identical. Any task type the daemon does not
recognise shows the same generic "Task" label, so a new upstream work type goes unnoticed.

## Behavior

**Rows and states.** Every row has one of these states: running, stopping, stop-error,
completed, failed, or stopped. Running rows appear first, in start order. Terminal rows
(completed, failed, or stopped) come next, with the most recently ended first. The
second line of a row shows its kind label. On a terminal row it also shows a status word
with a tone: success for Completed, destructive for Failed, and muted for Stopped. The
trailing slot shows the ticking elapsed time on a running row. On a terminal row it shows
the static total duration.

**Stop.**
- The trailing slot is fixed-width. On a running row it shows the elapsed time by default.
  On hover or keyboard focus it shows a square stop control instead, and the row width does
  not change. The stop control is always in the tab order. Activating it does not open the
  row's detail view.
- Stopping takes one click, with no confirmation. When the user clicks, the row enters
  **stopping**: a spinner is always visible in the trailing slot, and the second line reads
  "Stopping…". The row stays in this state until the daemon reports a terminal state. The
  row then settles as a terminal row without a reload.
- If the stop request fails, the row returns to running and enters **stop-error**. A
  destructive-tinted square is always visible in the trailing slot. Its tooltip and
  accessible name carry a readable message that includes the daemon's error text.
  Activating it retries the stop. The row's detail view shows the same message. A failure
  never removes a running row.
- If the daemon accepts the stop but no terminal state arrives within 10 seconds, the row
  enters stop-error with the message "Stop requested, but the task is still running."
- If the daemon no longer tracks the task, the row is removed. The daemon is the authority
  on liveness, and the next resync would drop the row anyway.
- The session's adapter declares whether it can stop background tasks. When it declares
  that it cannot, or declares nothing, the stop control is still shown on hover and focus.
  It is visibly disabled and stays focusable. Its tooltip gives the reason: "Stopping
  background tasks isn't supported for <adapter name> sessions." Activating it sends no
  request. Claude declares that it can stop tasks. Codex declares that it cannot.
- A recovered entry is one that was rehydrated after a daemon restart and has no live CLI
  session. Stopping a recovered entry that has no live process settles it as **stopped**
  with the summary "No live process — marked stopped." It does not stay in the stopping
  state and it does not show an error. A recovered entry that still has a live process is
  signalled like any other entry.

**Details (drill-in).**
- Every non-workflow row, and every workflow row whose run is not yet known, opens a detail
  view on click, Enter, or Space. The opened row can be running or terminal. The detail
  view replaces the list in place, with a back control labelled "Activity". This is the
  same level swap that workflow rows use. Workflow rows whose run is known still open the
  workflow run panel, exactly as they do today. Switching sessions returns the panel to
  the list.
- The detail view shows:
  - the full description and the full command, both wrapping and never truncated
  - the kind glyph and label, and the status with its tone
  - the tool that started the task, for shell-kind rows only (Bash or Monitor)
  - the start time
  - the elapsed time while running, or the total duration once terminal
  - a "Recovered" note when the entry was rehydrated
  - the reported task type for unrecognised work
  - the summary, last output line, and usage (tokens, tool uses, duration), each only
    when the daemon supplied it
- **Output tail.** When the detail view of a non-agent row opens, it requests a bounded
  tail of the task's output (at most 8 KiB, the daemon's default). It shows one of these
  states:
  - loading
  - output lines (monospace, wrapping, scrolled to the end)
  - **empty**: the output exists but has no content yet
  - **none**: the task has no output location, or its output file does not exist yet. No
    request is made when the task has no output location at all.
  - **error**: a readable message that differs from the none state
  A Refresh control re-requests the tail. There is no live following.
- **Agent rows have no output tail.** The CLI writes an agent's output location as a link
  to the agent's own transcript, which lives outside the directory the daemon may read. An
  agent row's detail view therefore makes no tail request and shows no Refresh control.
  Its output area reads "This agent's output is its transcript, which isn't shown here."
  That is neither the none state (output does exist) nor the error state (nothing failed).

**Terminal-row retention.**
- When the daemon reports that a row already listed has completed, failed, or stopped, the
  row stays in the list as a terminal row. Its summary and usage stay visible in its
  detail view.
- A terminal row leaves the list in one of three ways:
  - The user dismisses it. On hover or focus, a dismiss control (X) replaces the duration
    in the trailing slot. Activating it removes only that row.
  - The session's next user turn begins. This clears every row that is terminal at that
    moment and leaves running rows alone.
  - More than 5 terminal rows exist. The one that ended longest ago is dropped.
- Terminal rows exist only in the client's memory for their own session. They never
  appear in another session, and a reload or a daemon restart clears them.
- A terminal report for a task the panel never listed does not add a row. For example,
  boot reconciliation replaying finished tasks adds nothing.
- The panel's count badge, the rail button's badge and pulse, and the rail tooltip ("N
  tasks running") count only running and stopping rows. When only terminal rows remain,
  the badge is hidden, and the panel lists the terminal rows instead of the "Nothing
  running" placeholder. That placeholder appears only when the list is empty.

**Kinds and labels.**
- Shell-kind work started by the Monitor tool shows a Monitor glyph and the label
  "Monitor". A background shell command shows the terminal glyph and the label "Task". The
  Monitor glyph is different from the Agent, Task, Workflow, and unrecognised glyphs.
- Agent and workflow rows are unchanged.
- An unrecognised task type is labelled with the type string the CLI reported, verbatim
  (for example `container_exec`). It uses the unrecognised-kind glyph. If no type was
  reported, the label falls back to "Task".

## Not Included

- Codex sub-agents in the Activity model, and any Codex stop implementation (#327).
  `deferred`
- Live-following output tail and a full-output viewer. `deferred`
- Showing an agent's transcript (its output location) in the detail view. `deferred`
- Relaxing the output path validation to follow links out of the spool directory.
  `declined`
- Populating the last-output-line field. The daemon never sets it today. The detail view
  shows it only when present. `deferred`
- A confirmation step before stopping. `declined`
- Persisting terminal rows or activity history across reloads or daemon restarts.
  `declined`
- A client wrapper for the list-tasks endpoint, because the broadcast already carries the
  data. `declined`
- Redesigning the panel layout, the rail, or the workflow run panel. `declined`
- Changing how tasks are started, reconciled, or adopted. The only exceptions are recording
  the reported type and the recovered-entry stop outcome. `declined`
- Re-implementing the spool-root uid fix. #338 landed it as pr:632. This todo only verifies
  it end to end. `declined`
- Automations runs, launch processes, and terminals. `platform` (they are different
  surfaces, not background tasks)
- The mobile client, which lives in a separate repository and PR. It must keep working
  when it ignores the new optional fields. `platform`

## Edge cases

- **Stop races completion.** The ended event arrives before the stop request resolves. The
  row settles on the reported terminal status. A late stop failure does not revert a
  terminal row.
- **Stop while the CLI exits.** When the CLI exits, all of the session's running tasks end
  as stopped at once. Every affected row settles, and the cap of 5 applies.
- **Resync snapshot.** Every chat update carries a running-only snapshot. The snapshot
  replaces the running set and never removes retained terminal rows. If the panel lists a
  row as running and the snapshot omits it, the row is removed, because no terminal detail
  is known. If the panel already lists a row as terminal and the snapshot says it is
  running, the terminal state wins.
- **Stopping and resync.** A row in the stopping state keeps that state across a snapshot
  that still lists the task as running.
- **Workflow terminal rows.** A workflow row that reaches a terminal state still opens its
  run panel.
- **Detail view of a row that leaves the list.** If a dismissal, the next turn, or the cap
  removes the row while its detail view is open, the view returns to the list. If the task
  settles while its detail view is open, the view updates in place.
- **Output location present but no file yet.** Today the daemon validates the path before
  reading, and validation resolves the real path, so a missing file fails validation and
  returns `invalid_path` (409), the same answer as a path outside the spool directory. This
  todo splits the two: when the output file itself is absent and its directory resolves
  inside the spool directory, the daemon answers `no_output` and the detail view shows the
  none state. If the directory is also missing or resolves elsewhere, the answer stays
  `invalid_path`.
- **Path validation.** Any path that resolves outside the spool directory, including
  through a link, still fails as `invalid_path` and shows the error state. Reads stay
  bounded at 8 KiB and path-validated.
- **A non-agent task whose output is a link out of the spool directory.** Only agent outputs
  are links today. If another kind ever writes one, its tail read fails validation and the
  row shows the error state, which is truthful.
- **Adapter list not loaded.** The stop capability is treated as unsupported until the
  session's adapter is known.
- **Task description is empty.** The row title falls back to the command, as it does today.

## Acceptance criteria

1. In a Claude session, hovering or focusing a running row shows `activity-stop-<taskId>`
   in the trailing slot. The row's bounding width does not change.
2. Activating `activity-stop-<taskId>` sends exactly one kill request for that chat and
   task. The row shows the stopping state (a spinner and "Stopping…") until the ended
   event arrives. The row then shows "Stopped" without a reload. No detail view opens.
3. When the kill request fails, `activity-stop-error-<taskId>` is visible. Its accessible
   name contains the daemon's error text. The row is still listed and still counted as
   running. Activating the control sends another kill request.
4. When the kill request succeeds but no terminal event arrives within 10 s, the row shows
   `activity-stop-error-<taskId>` with the message "Stop requested, but the task is still
   running."
5. When the kill request returns "task not found", the row is removed from the list.
6. Adapter capabilities gain an optional stop-background-task flag in both the Rust type
   and the TypeScript type. Claude reports `true`, Codex reports `false`, and each other
   adapter reports whether its session implements stop. An absent flag means unsupported.
   Rust tests pin the Claude and Codex values.
7. In a session whose adapter flag is false or absent, `activity-stop-<taskId>` has
   `aria-disabled="true"`, is focusable, and shows a tooltip naming the adapter. Activating
   it sends no request.
8. Killing a recovered entry that has no live writer returns the success envelope. It also
   ends the tracked task as `stopped` with the summary "No live process — marked stopped."
   and emits the ended event. A Rust unit test on the kill path pins this. Killing a
   non-recovered task that has no live writer still returns the failure envelope.
9. Activating a non-workflow row, or its `activity-drill-open-<taskId>`, shows
   `activity-detail-<taskId>`. The detail view contains the status, the full description,
   the full command, and the duration. It also contains the summary and usage whenever
   the task record carries them. `activity-drill-back-<taskId>` returns to the list.
   Activating a workflow row whose run is known still opens the workflow run panel.
10. Opening the detail view of a non-agent task that has an output location requests the
    output tail with a byte limit of 8 KiB or less. If the tail has content,
    `activity-output-lines-<taskId>` shows it. If it has none,
    `activity-output-empty-<taskId>` appears. If the task has no output location, or the
    daemon reports `no_output`, `activity-output-none-<taskId>` appears. Any other failure,
    including `invalid_path`, shows `activity-output-error-<taskId>` with a message.
    Activating `activity-output-refresh-<taskId>` sends a new request.
11. For an output location whose file does not exist but whose directory resolves inside
    the spool directory, the output endpoint returns the `no_output` failure, not
    `invalid_path` and not "read failed". An output location that is a link resolving
    outside the spool directory still returns `invalid_path`. Rust route tests pin both.
12. With the daemon running as an ordinary (non-root) user, a real background shell task's
    output tail returns the content the CLI wrote under that user's `claude-<uid>` spool
    directory. The existing spool-root regression test from #338 still passes. This todo
    adds no second uid fix.
13. After an ended event for a listed task, the row stays listed with its status label
    (Completed, Failed, or Stopped) and a static total duration. Its detail view shows the
    summary and usage.
14. Pure reducer unit tests cover these rules:
    - terminal retention
    - the cap of 5, where the oldest-ended row drops
    - dismissal removing only the targeted row
    - clearing terminal rows when the next user turn starts, with running rows untouched
    - ignoring terminal payloads for tasks that were never listed
    - snapshot merging (terminal rows kept, and running rows missing from the snapshot
      removed)
15. A pure unit test shows that the running count counts only running and stopping rows.
    With one running row and two terminal rows, the panel badge and the rail badge both
    show 1 and the rail tooltip reads "1 task running". Dismissing `activity-dismiss-<id>`
    on a terminal row leaves both badges unchanged.
16. A shell task started by the Monitor tool renders `session-panel-kind-monitor` with the
    label "Monitor". A background shell command renders `session-panel-kind-bash` with the
    label "Task". A unit test asserts that the Monitor, Task, Agent, Workflow, and
    unrecognised glyphs are pairwise distinct.
17. The daemon records the CLI's reported task type on the task record and carries it into
    the activity projection. A Rust test pins that an unmapped type such as
    `container_exec` survives. A UI unit test pins that a task with kind `other` and
    reported type `container_exec` renders the label `container_exec`.
18. The new projection fields are all optional:
    - status
    - tool name
    - command
    - output location
    - ended time
    - last output line
    - summary
    - usage
    - recovered
    - reported type

    The TypeScript Zod schema parses a legacy payload that has only id, kind, description,
    and start time. The Rust projection (the `backgroundActivity` snapshot) and the
    TypeScript projection (from events) emit the same field set. Tests exist on both sides.
19. A new client API module wraps kill and output-tail. It Zod-validates the ok/fail
    envelope for kill, and for output-tail failures. Tests cover success and each failure
    mapping, including `no_output`, "task not found", and an error string.
20. Every new interactive or stateful element carries a `data-testid` from this set, keyed
    by task id and never by list index: `activity-stop-`, `activity-stop-error-`,
    `activity-dismiss-`, `activity-drill-open-`, `activity-drill-back-`, `activity-detail-`,
    `activity-output-refresh-`, `activity-output-lines-`, `activity-output-empty-`,
    `activity-output-none-`, `activity-output-error-`, and `activity-output-transcript-`.
    The existing
    `session-panel-task-<taskId>` and `session-panel-kind-<kind>` stay.
21. `pnpm` typecheck, lint, and UI tests pass, and `cargo test` passes for the touched
    crates. The PR includes a changeset.
22. Opening the detail view of an agent row sends no output-tail request, renders
    `activity-output-transcript-<taskId>` with the text "This agent's output is its
    transcript, which isn't shown here.", and renders none of
    `activity-output-none-<taskId>`, `activity-output-error-<taskId>`, or
    `activity-output-refresh-<taskId>`.

## Decisions

- **Widen the shared activity projection additively, with every new field optional on the
  wire.** The data is already broadcast in the task events. Widening avoids a new daemon
  shape and a per-row round trip. Mobile co-owns the contract. `hard-to-reverse`
- **Add an explicit stop-background-task flag to adapter capabilities, where absent means
  unsupported.** The brief and the design walk require the affordance to be driven by a
  capability. Today the only signal is a runtime `"unsupported"` string, which would fail
  after the click. This follows the existing `autoMode` pattern. `hard-to-reverse`
- **The daemon records the CLI's raw task type on each task.** This contradicts the brief:
  the daemon discards `task_type` after mapping it, so "shown with its reported type" is
  impossible without an additive daemon field. The design direction's `reportedType`
  assumed a field that does not exist. `hard-to-reverse`
- **Detail view is a drill-in that reuses the workflow level swap.** This is the 2026-09-23
  design direction, verdict B: inline expansion loses content off-screen at a 288px by
  384px panel size. `reversible`
- **No confirmation on stop.** This is the brief's recommendation. A background task is
  recoverable by re-running it, and a confirmation on a live list adds friction.
  `reversible`
- **Terminal rows leave on dismissal, on the next user turn, or when a 6th pushes out the
  oldest (cap of 5).** The design direction set dismissal plus next turn and defaulted the
  cap to 5. `reversible`
- **Terminal rows live in client memory, scoped to their session, and survive switching
  away and back during one app run.** Chat controllers are kept warm per session, so
  clearing rows on a switch would need extra machinery. It would also contradict the
  "dismiss or next turn" boundary. The brief's "never persist across a session switch"
  is read as "never shown in another session and never stored". `reversible`
- **Only tasks the panel already listed become terminal rows.** Boot reconciliation replays
  finished tasks, which would otherwise flood the panel with work from earlier sessions.
  `reversible`
- **Monitor is detected by the tool name, not the kind.** This contradicts the design
  direction: Monitor tasks carry kind `bash`, not a distinct kind. The tool name is the
  only reliable signal, and it is `Monitor` only when that tool was captured. `reversible`
- **The Monitor glyph differs from the Agent glyph.** This overrides the design direction's
  `Bot` icon, which is already the Agent glyph and would break "glyph distinguishes kinds".
  The planner picks the icon. `reversible`
- **The Tool line appears only for shell-kind rows.** The daemon defaults the tool name to
  Bash for tasks with no captured tool use, such as agents, so showing it elsewhere would
  mislabel them. `reversible`
- **A recovered entry with no live writer is marked stopped daemon-side and returns
  success.** The design direction requires this outcome instead of an error. Resolving it
  in the daemon keeps every client, including mobile, truthful. Live-session tasks keep the
  error, because the daemon cannot know their state. `reversible`
- **Stopping times out after 10 s into stop-error.** A stop that the CLI accepts but that
  never produces a terminal event would otherwise spin forever. `reversible`
- **A "task not found" reply to a kill removes the row.** The daemon is authoritative on
  liveness, and this is not an optimistic removal. `reversible`
- **The output tail is on demand: fetched once when the detail view opens, with a Refresh
  control and the daemon's default limit of 8 KiB or less.** This is the brief's
  recommendation. Follow mode is deferred. `reversible`
- **The daemon answers `no_output` for an absent output file whose directory is inside the
  spool directory, instead of today's `invalid_path`.** Today validation resolves the real
  path first, so "not written yet" and "outside the spool" are the same 409 rejection, and
  the brief requires "no output" and a failure to be distinct. Checking the directory keeps
  reads path-validated. Uncertain: if the CLI creates the tasks directory after
  `task_started`, a very new task shows the error state until Refresh. `reversible`
- **Agent rows show a transcript note and never request the tail; validation is not
  relaxed.** The CLI writes an agent's output as a link to its subagent transcript outside
  the spool directory (verified on disk; see CLEAR.md on `initTaskOutputAsSymlink`), so every
  agent tail read fails as `invalid_path`. Showing that as an error on the most common row
  kind would be false, "none" would also be false, and relaxing validation would expose
  raw transcript JSON. Gated on the row kind, not the adapter. `reversible`
- **The last output line is shown only when present, and populating it is deferred.** This
  contradicts the brief: the field exists, but the daemon never sets it. `reversible`
- **The client API wraps kill and output-tail only.** The broadcast makes a list call
  redundant. `reversible`
- **The background-shell label stays "Task".** This matches the current label and the
  design direction. The glyph and the Monitor label carry the distinction. `reversible`
- **Codex sub-agents are out of scope (#327). Stop is gated by the capability, not by the
  adapter id.** This is the brief's recommendation. `reversible`
- **The #338 end-to-end criterion is verified here, not implemented.** The user ruled this
  on 2026-08-14, and the fix merged as pr:632. `reversible`
