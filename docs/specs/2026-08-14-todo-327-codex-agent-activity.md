# Todo #327 — Codex sub-agents show up as session activity

Spec for surfacing a Codex session's sub-agent delegations in the session's Activity panel
and running-work count, the way a Claude session's sub-agents already do. Route: full.
No design gate: the feature reuses the Activity panel's existing `agent` row, so there is
no new UI to approve.

## Problem

A Codex session can have several sub-agents working at once, and the session gives the
user no place to see them. The Activity panel says "Nothing running" and the rail's
Activity button shows no live dot — while sub-agents are in fact running. The same panel
in a Claude session lists every live subagent with a
ticking elapsed time, because only the Claude adapter feeds the shared background-activity
model.

The information already exists: the Codex adapter opens a transcript card per sub-agent
and knows its identity and its outcome. It just never reaches the model the Activity panel
reads. So the user's only view of concurrent Codex delegation is scrolling the transcript
and counting cards, and there is no answer at all to "how long has this one been running".

## Behavior

**A row per live sub-agent.** When a Codex session delegates to a sub-agent, one row
appears in that session's Activity panel, of kind agent — the same row shape, glyph and
"Agent" label a Claude subagent produces. The row appears at the moment the sub-agent's
transcript card does: the sub-agent-started report, or a wait naming the child, whichever
comes first. The spawn delegation call alone opens no row, so the panel never lists a
sub-agent the transcript has not shown yet. The row's elapsed time runs from when the row
appeared, not from the spawn call.

**One live row per sub-agent.** However many delegation calls reference the same child
while it works — send-input, resume, wait — the panel keeps one row for it, and its
elapsed time keeps running from when the row first appeared. It never restarts and never
doubles.

**Row title.** The row reads with the same name the sub-agent's transcript card carries:
its nickname, else its role, else its spawn path humanized, else the literal "Sub-agent".
The title is never blank and is never a raw thread id.

**A name that is not yet known stays "Sub-agent".** Codex publishes a sub-agent's nickname
and role on its own schedule. If neither is known when the row opens, the row reads
"Sub-agent" — and so does the card, which is named from the same lookup at the same moment.
The title is settled when the row appears and never changes afterwards: a nickname Codex
records later renames neither the row nor the card, so the two views cannot drift apart.

**Elapsed.** The row's elapsed column ticks while the sub-agent runs, on the same clock as
every other activity row.

**The row ends when the sub-agent's work does.** Completion, failure, interruption, and an
explicit close by the parent each remove the row from the live set. The rail count drops
with it. Ending a row does not touch the sub-agent's transcript card, which keeps its own
result text.

**Re-engaging a finished sub-agent.** If the parent sends new input to, or resumes, a
sub-agent whose row has already ended, a fresh row appears for the new round, timed from
that moment and carrying the name the sub-agent already had. Idle time between rounds is not
counted as running time.

**Nothing stays stuck.** When the parent's turn ends with sub-agents still tracked, their
rows end. When the session process exits, every live row for that chat ends. After either,
the panel shows "Nothing running" and the rail's dot clears.

**The count and the tooltip.** The rail's Activity button shows its live dot whenever at
least one row is running and its label reads "N tasks running" ("1 task running" for one),
counting Codex sub-agent rows alongside every other kind.

**Claude is untouched.** A Claude session's Activity panel behaves exactly as before, and
the panel renders one model with no per-adapter branch: a Codex agent row and a Claude
agent row are indistinguishable to the client.

**Only delegated sub-agents count.** A Codex session's own shell commands, file edits and
MCP calls are foreground turn work and produce no rows.

## Not Included

- Stopping or cancelling a Codex sub-agent from the Activity panel — Codex reports stop as
  unsupported, and the affordance is #328's. `deferred`
- Activity panel enhancements: stop button, row expansion/details, terminal-state rows.
  `deferred`
- Any change to how a Codex sub-agent renders inline in the transcript. `declined`
- Rows for Codex's non-agent work (shell commands, MCP calls). `declined`
- Rehydrating sub-agent rows when a Codex session is resumed or reloaded: the live set is
  live-only, matching Claude; the transcript carries the history. `declined`
- Persisting background activity across daemon restarts. `declined`
- Claude Workflow runs and their drill-in panel. `declined`

## Edge cases

- Several sub-agents running at once produce that many rows, each with its own elapsed
  time; the count and tooltip report the total.
- A child first named by a wait call that has already completed opens and ends in the same
  pass — it never lingers in the live set.
- A wait that fails without naming any child ends every live sub-agent row for that
  session, mirroring how the transcript fails every open card.
- An unrecognised sub-agent activity kind, or an unrecognised delegation tool name, opens
  no row and ends none — it must not leak a permanently running entry.
- An interaction report for a child that was never registered opens no row.
- A sub-agent that is spawned but never starts and is never waited on gets no row, matching
  the transcript, which shows no card for it either.
- A sub-agent whose nickname and role are still unknown when its row opens reads "Sub-agent"
  in the panel and in the transcript, and keeps that name for the rest of the round.
- A sub-agent whose child thread never reports completion is ended by the turn-end sweep,
  not left running.
- A session that exits mid-delegation leaves no running rows for its chat.
- Ending a row twice (for example a completion followed by the turn-end sweep) is a no-op:
  no duplicate ended event, no negative count.

## Acceptance criteria

1. Given a Codex session whose sub-agent has started (or is named by a wait), the chat's
   background activity contains exactly one running entry of kind `agent`, and its
   `description` is character-for-character the title of that child's transcript card
   (that title being nickname, else role, else humanized spawn path, else "Sub-agent").
   The equality holds for every case below, including when the card reads "Sub-agent".
2. A spawn delegation call for a child that has neither started nor been named by a wait adds
   no entry: the chat's live set stays empty.
3. A child whose nickname and role become known only after its entry opened keeps the
   `description` it opened with, and so does its card.
4. Given a live sub-agent, further send-input, resume and wait calls naming the same child
   add no entries and leave its `startedAt` unchanged.
5. Each of completion, failure, interruption, and an explicit close by the parent removes
   the entry: after any one of them the chat's live set contains no entry for that child.
6. After a sub-agent's entry has ended, a send-input or resume against that same child adds
   one new running entry whose `startedAt` is later than the ended entry's and whose
   `description` is unchanged from it.
7. In a Codex session with N live sub-agents, the Activity panel renders N rows carrying the
   agent glyph (`session-panel-kind-agent`) with the detail line "Agent", and the rail's
   Activity button shows its live dot with the label "N tasks running".
8. When the parent's turn completes with sub-agents still tracked, and when the session
   process exits with sub-agents still tracked, the chat's live set is empty afterwards and
   the panel shows "Nothing running".
9. Adapter-level Rust tests cover the entry lifecycle driven from the collab vocabulary:
   open on started report, open on a wait naming an unknown child, dedupe across both, a
   spawn call opening no entry (it only stashes the prompt), title equality with the card
   including the unresolved-identity case, end on each of
   completed / failed / interrupted / close, the turn-end sweep, and an unknown activity
   kind and unknown tool name opening no entry and leaking none.
10. The e2e mock harness can drive an `agent` activity row from open to end, and the row is
    asserted in the Activity panel.
11. Existing Claude background-activity tests pass unchanged, and the renderer contains no
    adapter-specific branch for activity rows (no reference to an adapter id in the Activity
    panel or rail source).
12. Every emitted activity entry validates against the existing background-activity schema
    (`BackgroundActivityTaskSchema` / `BackgroundActivitySchema`), and the Rust daemon and
    the TypeScript types stay in parity — no shape change to `BackgroundTask`,
    `BackgroundActivityTask` or the started/updated/ended envelope.
13. `docs/adapters/codex/CONSUMED-SURFACE.md` gains rows covering the sub-agent activity
    reports and delegation tool calls this feature depends on, each naming the consuming
    source and its test, so a CLI vocabulary change is caught.

## Decisions

1. **A row opens exactly where the child's transcript card opens — the sub-agent-started
   report or a wait naming the child, deduped by child thread id — and not on the spawn
   call, so the row's clock starts at open rather than at spawn.** This overrides the brief,
   which recommended opening on spawn too and timestamping there: spawn opens no card
   (`collab_card.rs` routes `SpawnAgent` to stashing the prompt) and its item carries no
   `agentPath`, so a spawn-opened row could read "Sub-agent" while the card for the same
   child reads "Maxwell" — the exact divergence decision 4 exists to prevent. The cost is
   that a spawned-but-never-started child gets no row, which is also what the transcript
   shows. `reversible`
2. **A row ends on completion, failure, interruption, or explicit close, with a turn-end
   sweep as backstop.** Mirrors the four card-resolution routes plus the existing
   parent-turn-end backstop, so a row can never outlive its card. `reversible`
3. **Explicit close ends the row even though the transcript card ignores close today.** The
   user's question is "is this sub-agent still working", and a closed sub-agent is not; the
   card's behavior stays out of scope, so the row/card asymmetry is deliberate. `reversible`
4. **The row's title is the card's title: nickname, role, humanized spawn path, then
   "Sub-agent".** This extends the brief's "role or nickname" with the path step, because two
   views of the same sub-agent disagreeing on its name is worse than the extra fallback.
   `reversible`
5. **"One entry per sub-agent" means one live entry at a time, not one entry forever.** A
   sub-agent that finishes and is later re-engaged gets a new row: counting the idle gap as
   running time would make the elapsed column lie. `reversible`
6. **No rehydration on resume or reload.** The live set is derived and never persisted, and
   Claude behaves the same way; a resumed session shows history in the transcript, not in the
   live panel. `reversible`
7. **A Codex agent row is not stoppable in this todo.** Codex answers stop as unsupported;
   #328 owns hiding or disabling the affordance where a session cannot stop work.
   `reversible`
8. **Codex's non-agent work does not become rows.** Shell commands and MCP calls run inside
   the turn the user is already watching; adding them would turn a background-work panel into
   a second transcript. `reversible`
9. **Session-exit reconciliation is existing machinery, not new work.** Process exit already
   ends every running entry for the chat, adapter-agnostically; only the Codex turn-end sweep
   is new behavior. `reversible`
10. **The client-facing shapes stay as they are.** The activity payload carries id, kind,
    description and start time only, so an agent entry needs nothing the model lacks; changing
    the shape would touch every consumer for no user-visible gain. `reversible`
11. **A row's title is settled when the row opens and never changes, so an identity Codex
    has not published yet shows as "Sub-agent" for that whole round.** The card fixes its
    title at open too, and Codex writes a child's nickname and role on its own schedule; a
    row that renamed itself later would disagree with the card that did not. Renaming stays
    available — the activity model already broadcasts updates — if the card ever learns to
    re-title, and until then a stale "Sub-agent" is the accepted cost. `reversible`
