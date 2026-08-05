# Claude Code workflow run details

Todo #233 · route:full · branch `todo/233-workflow-details-card`

Visual treatment — tokens, insets, class recipes, component decomposition — is fixed by the
approved `## Design direction` (2026-07-29) in the todo body. This spec restates behavior and
states only; where the two ever disagree, the design direction wins.

## Problem

When the Claude CLI runs one of its own workflow scripts, it launches asynchronously and then
publishes everything about the run — the seeded phase list, each agent's identity, state, tokens,
tool calls and errors — on a stream the daemon throws away. Mainframe keeps only a coarse
"workflow" kind for the background-activity pill. The launch itself renders through the generic
tool fallback as an unstyled blob.

A user who starts a workflow therefore cannot tell how many agents are running, which phase the run
is in, whether any agent failed, or how long it has been going, and none of it survives a webview
reload. The information exists on the wire and, for finished runs, on disk; nothing in Mainframe
reads it.

## Behavior

**Two entry points, one panel.** The run details open as a popover panel. It is reachable from the
background-activity pill above the composer while the run is live, and from a permanent one-line
launcher row in the transcript at any time. Both open the same panel.

**Launcher row.** Every `Workflow` (alias `RunWorkflow`) tool call renders as a single collapsed
row — never an expanding card: a workflow glyph tile, an outcome dot, the workflow name, one
metadata string, and a chevron. The metadata string joins with ` · `: agent count, then failed
count and unknown count when non-zero, then `running` while live, then run tokens and duration.
The outcome dot reads green on a clean completion, amber when the run completed but agents failed,
red on a failed run, pulsing amber while running, and a hollow ring when the run is stopped, paused
or its details are unavailable. Clicking the row opens the panel anchored to the row.

**Activity pill.** While a run is live it appears in the pill's list as a clickable row — glyph,
workflow name, agent count, chevron. Every other entry (subagents, bash tasks) stays inert, exactly
as today. Clicking a workflow row replaces the list with the run panel inside the same popover,
which widens; a `‹ Background activity` breadcrumb returns to the list.

**The run panel.** A header carries the workflow name, a status chip (Running, Completed, Failed,
Stopped, Paused, Unavailable), a summary line, and right-aligned run token and duration totals.
The summary line names the current phase while the run is live — the *deepest* phase that has
spawned anything, so an agent left erroring in an early phase cannot drag the header backwards —
followed by `X of Y done`, `N running`, `N failed`, `N unknown`, omitting the zeros.

Below the header, every phase from the run's seeded list renders in index order, including phases
that have not started (marked `not started`, no rows) — what is still coming is among the most
informative things on the panel. Each phase header shows its kind and agent count. Agents group
under their phase in index order. An agent row shows a state dot, its label, and right-aligned
tokens and duration; model, attempt and tool count live in the row's hover title. Beneath the row
sits at most **one** detail line, chosen by precedence: stale note → error text → result preview →
last tool name and summary → nothing.

**Run totals are run-scoped.** The tokens and duration in the header and launcher row are the run's
cumulative totals, not one agent's.

**Live behavior.** Progress events without a snapshot update the run's token and duration totals only,
and never clear the rendered structure. Such an event names no agent, and the panel renders no
run-level last tool, so nothing else on screen moves. A snapshot replaces phases and agents wholesale
rather than merging entry by entry, so a late or out-of-order snapshot cannot resurrect a stale state.
An open panel reflects a new snapshot without waiting for a new assistant message.

**Durability, honestly bounded.**

- *Webview reload, same daemon* — the identical panel, restored from daemon-held run state, without
  waiting for the next progress event. Closing the app kills the daemon sidecar, and with it the CLI
  and the run, so there is no app-restart variant of this.
- *Run reaches a terminal status* — the daemon reconciles against the run record the CLI writes on
  completion. Because snapshots are throttled to roughly one per ten seconds, a run that ends between
  snapshots would otherwise show a Completed header over agents frozen mid-flight; reconciliation
  replaces the last snapshot with the record's final structure. When the record is not readable, the
  unresolved rows are neutralized (below) rather than asserted.
- *Chat opened in a later daemon process, run completed* — the full phase and agent breakdown,
  reconstructed from the on-disk run record found via the run id the tool result carries. A loading
  state is allowed until the first history response after chat open resolves.
- *CLI died mid-run, daemon survived* — the run reads **Stopped**, showing the last snapshot the
  daemon retained. Agents last seen starting or in progress are **neutralized, never asserted**: a
  hollow ring instead of a colored dot, an `unknown` chip, a dimmed label and metrics, and a detail
  line reading "Last observed Ns before the run stopped". Their observed numbers survive; the outcome
  claim does not. A banner above the phases says it once in words, naming how many agents' outcomes
  are unknown and how long before the stop they were last seen.
- *CLI and daemon both gone before the run finished* — nothing survives: no snapshot in memory, and
  the CLI writes a run record only on completion. The panel says exactly that — **Run details
  unavailable**, one explanatory line, and the run id where the summary would be. Never a zeroed run
  dressed as data.

**Paused.** A pause is only reachable from the CLI's own interactive UI, never from Mainframe, but a
pause update now reaches the daemon (today none do, because the status is read from the wrong place
in the payload). A paused run shows the Paused chip with its duration frozen, and it leaves the
activity pill — pausing is not live work. Its launcher row remains the way back to the panel.

**Working state.** A workflow that is not running never makes the session read as Working. The
activity pill continues to distinguish nothing beyond live/not-live; run state lives on the panel.

## Not Included

- Per-agent transcript drill-down — `declined` (design gate: a popover is a status readout, not a
  reading surface; the session transcript already carries the content).
- The current phase on the transcript launcher row — `declined` (the design gate enumerates the row's
  metadata string exhaustively; the phase is on the panel header, one click away).
- A run-level last-tool readout and a run tool-call total — `declined` (neither the panel header nor
  the launcher string carries them under the design gate, and a snapshot-less progress event names no
  agent to attribute a last tool to).
- The run's log lines, including the CLI's 500-entry ring — `declined` (same gate; a second scroll
  context inside a popover).
- The workflow script source — `declined` (arrives as the launch prompt and can be enormous).
- Recursive discovery of workflow agent transcripts under the session's per-run subagent directory —
  `deferred` (only the cut drill-down needed it; the flat subagent scan is unchanged).
- Retry, skip, kill, pause and resume controls for agents or runs — `declined` (read-only v1).
- A "Resume this run" affordance built on the CLI's resume hint — `deferred` (noted so this work
  does not make it harder).
- Remote-agent workflows and remote session links — `declined` (a different task kind).
- A status field on the background-activity wire type — `declined` (two client ingest paths would
  contradict each other; four layers of change for no v1 behavior).
- `paused` as a background-task tracker status — `declined` (the tracker's live set and terminal
  predicate define the Working indicator; run state belongs on the panel).
- Authoring, editing, browsing or launching workflow scripts from Mainframe — `declined`.
- The Automations feature and its shipped details view — `declined` (different feature).
- Anything nested below a workflow agent — `platform` (the CLI blocks agent and workflow tools inside
  agents; the tree is exactly two levels).
- Progress for a run interrupted before completion — `platform` (the CLI writes no run record for an
  unfinished run, and its resume journal cannot rehydrate one).
- Node-daemon parity — `platform` (the Rust daemon is the only runtime).
- Mobile client surfacing — `deferred` (wire additions stay additive so mobile ignores them).

## Edge cases

- **Several runs in one session** — each gets its own launcher row and its own activity row, keyed by
  run id. Two runs of the same script are distinguishable.
- **Tool call with no result yet** — the launcher row renders immediately with a running dot and a
  starting state; it never waits for the first snapshot to appear.
- **Launch failed** — a `Workflow` tool result that carries an error and no run id renders as a
  non-interactive row with a red dot and the error text; there is no panel to open.
- **Run ends while its panel is open from the pill** — the pill stays mounted until the popover
  closes, so the panel is not yanked out from under the cursor when the live set empties.
- **Chat or thread switched with the popover open** — the popover closes; no stale run is carried.
- **Snapshot with no agents, or a run whose script seeds no phases** — the panel renders the header
  and either the empty phase list or nothing below it, never an error.
- **Unknown entry type or unknown agent state in a snapshot** — the entry is ignored, or the state
  renders neutral; a new CLI field never breaks the panel.
- **Duplicate terminal signals** (a status update and a completion notification for the same run) —
  idempotent: the second does not restart the duration, reopen the status, or double-count.
- **A resume-time completion notification for a run from an earlier process** — updates a run the
  panel already knows about; it never conjures a phantom run out of a notification alone.
- **Agent labels and tool summaries longer than the row** — truncated on one line, full text
  available on hover.
- **Remote agents launched by a workflow script** — not represented in the panel; they keep appearing
  in the activity pill as agents.
- **A session that never runs a workflow** — nothing changes anywhere in the UI.

## Acceptance criteria

1. A `Workflow` tool call, and one named `RunWorkflow`, resolve to the launcher row, not the generic
   tool fallback, and the row does not expand in place.
2. The launcher row carries `data-testid="chat-workflow-launcher-<runId>"` and shows the workflow
   name plus the ` · `-joined metadata string: agent count, failed count when non-zero, unknown count
   when non-zero, `running` while live, run tokens, duration.
3. The launcher dot renders green for a completion with no failed agents, amber for a completion with
   at least one failed agent, red for a failed run, pulsing amber while running, and a hollow ring for
   stopped, paused, or unavailable.
4. Clicking the launcher row opens a panel with `data-testid="chat-workflow-panel-<runId>"` anchored
   to the row, with no breadcrumb.
5. While a run is live, the background-activity popover lists it as a clickable row showing the
   workflow name and agent count; rows of every other kind remain non-interactive.
6. Clicking that row shows the same run panel inside the popover with a `‹ Background activity`
   breadcrumb that returns to the list.
7. The panel header shows the workflow name, a status chip reading exactly one of Running, Completed,
   Failed, Stopped, Paused, Unavailable, and right-aligned run token and duration totals.
8. The header summary names `Phase N · Title` for the deepest phase that has spawned an agent while
   the run is live, followed by `X of Y done`, `N running`, `N failed`, `N unknown`, with zero counts
   omitted. A run whose only unfinished agent errored in an earlier phase still names the later phase.
9. Every phase in the run's seeded list renders in index order with
   `data-testid="chat-workflow-phase-<index>"`; a phase with no agents reads `not started`.
10. Each agent renders under its own phase in index order with
    `data-testid="chat-workflow-agent-<agentId>"`, showing state dot, label, tokens and duration, with
    model, attempt and tool count in the element's title.
11. An agent row shows at most one detail line, selected by the precedence: stale note, error text,
    result preview, last tool name and summary, none.
12. A progress event carrying no snapshot updates the header's and launcher row's run token and
    duration totals and leaves the previously rendered phases and agents intact — including each
    agent's state dot, metrics and detail line.
13. A snapshot replaces phases and agents wholesale; feeding a snapshot older than one already applied
    does not restore an agent to an earlier state.
14. With the panel open, a snapshot reaching the daemon updates the panel without a new assistant
    message and without a manual reopen.
15. Reloading the webview mid-run, within one daemon lifetime, restores the same panel content before
    any further progress event arrives.
16. When a run reaches a terminal status, agents left in a starting or in-progress state in the last
    snapshot show the run record's final outcomes; if the record cannot be read, those rows are
    neutralized as unknown instead of showing a stale in-progress state under a terminal header.
17. Opening a chat in a later daemon process, for a run that completed, renders the full phase and
    agent breakdown from the on-disk run record within one history response of chat open. A loading
    state before that response is acceptable; a permanently unavailable panel is not.
18. A run whose CLI process was killed mid-flight while the daemon stayed up renders the Stopped chip,
    the last snapshot's phases and agents, hollow-ring `unknown` rows with dimmed metrics and a "last
    observed" detail line for agents last seen running, and a banner naming the count of unknown
    outcomes.
19. A run whose CLI and daemon both restarted before it finished renders "Run details unavailable"
    with one explanatory line and the run id in the header, and renders no phase list, no agent rows
    and no counters.
20. `task_updated` is ingested: the payload reads `patch.status` and `patch.end_time`; the status
    mapper has explicit arms for `pending`, `running`, `completed`, `failed`, `killed`, `paused`;
    `pending` and `running` never end the tracked task; `killed` maps without logging a warning; a
    `paused` update sets the panel's Paused chip and freezes its duration.
21. A workflow run that is not running — paused, stopped, completed or failed — is absent from the
    tracker's live set, so the chat does not report Working on its account.
22. A running workflow's background-activity entry carries the workflow name and run id in addition to
    its kind, and the additions are optional fields that older clients can ignore.
23. Rust unit tests cover: parsing each of the three snapshot entry types; a progress event with and
    without a snapshot; the `local_workflow` versus `remote_agent` kind split; the full `task_updated`
    status mapping including the `patch` nesting and the no-op statuses; terminal reconciliation from
    the run record over a stale snapshot; backfill precedence between a terminal run record and a
    retained snapshot; and the no-record-no-snapshot unavailable path.
24. A Rust test covers a live run whose CLI session ends: the run's panel state becomes Stopped with
    its last snapshot retained, independently of the tracker sweep.
25. UI tests cover: the launcher row summary and each dot variant; the panel's phase and agent
    rendering including a not-started phase; the stopped-with-unknown-rows state and its banner; the
    unavailable state; an agent in the error state; and the two-level popover navigation in both
    directions.
26. Any new HTTP route or WS message validates its input with Zod and returns the `ok`/`fail`
    `ApiResponse<T>` envelope, with a test per route or message.
27. Every interactive element carries a `data-testid` in `<surface>-<element>` kebab-case keyed by run
    id or agent id, never by array index.
28. No new or modified file exceeds 300 lines and no function exceeds 50. The Claude adapter's
    `task_events.rs`, `events.rs` and `history.rs` are already over the limit; changes to them are
    limited to dispatch into new sibling modules.
29. `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes, the new and touched UI test files pass,
    and `cargo test` passes for the touched crates.
30. A changeset is included.

## Decisions

- **D1 — The details live in a popover off the background-activity pill, plus a one-line launcher row
  in the transcript; not an expanding inline card.** Ruled at the 2026-07-29 design gate, which
  reversed the 2026-07-28 direction: an inline card scrolls away while the run is still going.
  `hard-to-reverse`
- **D2 — Per-agent transcripts and the run log are cut, overriding the brief's acceptance list.** The
  design gate cut both after the brief was written; the brief's "expanding an agent renders its
  transcript" and "show the log lines collapsed" criteria are superseded, not forgotten. The panel
  shows only fields the snapshot itself carries. `reversible`
- **D3 — Workflow agent transcript discovery is not extended.** With the drill-down cut, the only
  consumer of a recursive scan under the session's per-run subagent directory is gone, and widening
  the flat scan risks pulling workflow agent messages into the main transcript. `reversible`
- **D4 — The run panel never sources its outcome from the background-task tracker.** The tracker's
  `Stopped` is a liveness sweep, not a run result; the panel reads daemon-held run state and the
  on-disk record. `hard-to-reverse`
- **D5 — On CLI exit the daemon stamps its workflow run state Stopped, not only the tracker.** There
  is no existing path from the exit sweep to the panel, and without one a killed run pulses forever —
  the #273 failure mode. `hard-to-reverse`
- **D6 — `paused` is not added to the tracker's status enum; a paused update ends the tracked task
  while the panel shows Paused.** Adding a status would change the live-set and terminal predicates
  that define the Working indicator, and the brief requires a paused run not to pin Working. The cost
  is that a run paused and then resumed from the CLI's own UI does not return to the activity pill;
  pausing is unreachable from Mainframe, and the launcher row still opens the panel. `hard-to-reverse`
- **D7 — Terminal reconciliation re-reads the run record when a run ends.** Snapshots are throttled to
  ~10s, so without it a run ending between snapshots shows a Completed header over agents frozen
  mid-flight — the defect that blocked the previous spec. `reversible`
- **D8 — Precedence: a terminal run record supersedes any in-memory snapshot for the same run;
  otherwise the newest snapshot wins, and an empty snapshot never supersedes a populated record.**
  The record is final by definition; the empty-snapshot carve-out avoids the old deadlock where a
  monotonic counter made the record permanently unreachable. `reversible`
- **D9 — The disk backfill runs on the async per-chat history path, not the streaming display path.**
  The streaming projection is sync under two mutexes; the history path is async, lock-free, already
  scans a directory, and re-runs on every chat open, switch and reattach. `hard-to-reverse`
- **D10 — The `task_updated` payload fix ships in this todo.** Without reading `patch.status` no update
  of any kind reaches the daemon, which makes the paused and killed criteria untestable. `reversible`
- **D11 — The status mapper gets explicit arms for the full CLI enum, with `pending` and `running` as
  no-ops.** Removing the terminal guard without a complete mapping would let a `running` update end a
  live run. `reversible`
- **D12 — The background-activity entry gains an optional workflow name and run id; it gains no
  status.** The popover row needs an identity to open the right panel; a status field has two
  contradicting client ingest paths and is explicitly out of scope. `hard-to-reverse`
- **D13 — Run totals in the header and launcher row are presented as run-cumulative.** Measured on the
  captured run: the totals equal the sum of the agents' tokens and match the completion notification
  and the disk record. `reversible`
- **D14 — Rows the run outrode are neutralized, never asserted.** A snapshot up to 10s stale cannot
  claim an outcome nobody observed; the observed numbers survive, the outcome does not. `reversible`
- **D15 — A run with no recoverable structure renders an explicit unavailable state.** A zeroed run
  looks like a run that did nothing, which is a lie. `reversible`
- **D16 — No feature gating in Mainframe for the CLI's workflows flag.** The panel only exists in
  response to a real run event or run record, so absence handles itself. `reversible`
- **D17 — "Rust daemon parity" is not a constraint here.** The Node daemon is retired; the Rust daemon
  is the only runtime, per the brief. `reversible`
- **D18 — The launcher row does not name the current phase, overriding the brief's acceptance list.**
  The 2026-07-29 gate enumerates the row's metadata string exhaustively — agents, failed, unknown,
  `running`, tokens, duration — and a phase title is the one field there that has no bounded width;
  the panel header names the phase one click away. `reversible`
- **D19 — The agent row's tool count goes in the row's hover title, beside model and attempt, not in
  the visible row.** The snapshot carries `toolCalls`, so the brief's criterion is satisfiable, but the
  gate fixed the visible row at two right-aligned metrics; the title is the surface the gate already
  uses for the row's secondary identity fields. `reversible`
- **D20 — A snapshot-less progress event updates run tokens and duration only; there is no run-level
  last-tool or tool-call readout, overriding the brief's acceptance list.** The gate's header and
  launcher string carry neither field, and such an event names no agent, so a last tool could not be
  attributed to a row even if one were rendered. Last tool survives per agent, from snapshots, as the
  row's detail line. `reversible`
