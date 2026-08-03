# Todo #247 — Codex sub-agent delegation renders as a real sub-agent card

Spec for the transcript card Mainframe shows when a Codex session delegates work to a
sub-agent (Codex's CollabAgent tools). Route: full. No design gate — the user removed
`needs-ui` on 2026-07-30, ruling that the Codex delegation reuses the card Claude
subagents already render.

## Problem

When a Codex session delegates work to a sub-agent, the transcript shows one blank card
titled "Sub-agent" with no task text and the result "Sub-agent completed". Nothing
streams inside it while the sub-agent works. The sub-agent's reasoning and its answer do
appear — but at the top level of the parent conversation, indistinguishable from the
parent's own output. The user reads the same work twice, once as unattributed narration
and once as the parent's closing summary, and cannot tell which agent produced what.

The delegation also disturbs the parent session. The sub-agent runs its own turn on the
same connection, and Mainframe applies that turn's start, its completion and its token
usage to the parent chat: the turn reads as finished while the parent is still working,
and the context indicator drops to the sub-agent's usage. Reloading the session shows the
same degraded card, so nothing recovers on its own.

## Behavior

**A card per sub-agent.** The moment Codex reports that a sub-agent has started, the
parent transcript gains one collapsed sub-agent card for that sub-agent — before, and
independently of, the parent waiting on it. Two concurrent sub-agents produce two cards,
in start order. The card is the same card a Claude subagent renders: same layout, same
title/task/result lines, same expand affordance.

**Title.** The sub-agent's nickname or role as Codex records it. When Codex has no record
yet — the normal case at spawn time — the card shows the sub-agent's path humanized: the
last path segment, underscores as spaces (`/root/compute_sum` → "compute sum"). The
literal "Sub-agent" appears only when neither is available.

**Task line.** The delegation prompt when Codex supplies one. Codex encrypts the spawn
prompt on the current build, so the usual outcome is the sub-agent's humanized name. The
task line is never blank.

**While it runs.** The card shows a running indicator. Expanding it shows the sub-agent's
work as it arrives: reasoning, messages, command runs, file edits — every item shape the
transcript already renders for the main agent, nested inside the card. None of it appears
at the top level of the parent conversation.

**When it finishes.** The card stops running and shows the sub-agent's final message as
its result. When Codex reports a per-sub-agent final message of its own, that wins.
"Sub-agent completed" appears only when the sub-agent produced no message at all.

**Errors.** Three things resolve a card to an error state: Codex reporting the sub-agent as
interrupted, which reads "Sub-agent interrupted"; Codex reporting the delegation call
itself as failed, which reads "Sub-agent failed" unless the sub-agent left a message, in
which case the message is the result; and the sub-agent's own turn ending `failed` or
`interrupted` — the only two error states its turn-status enum defines, and the same two
the parent's own turn already treats as errors. A delegation that merely returns nothing
is not an error.

**The parent session is unaffected.** A sub-agent's turn starting or completing does not
start or end the parent's turn; the parent chat stays "running" until the parent's own
turn completes. A sub-agent's token usage does not move the parent's context indicator or
the parent turn's reported usage.

**Follow-up delegation calls.** Sending input to a sub-agent, resuming one, or closing one
neither creates a second card nor resolves an open one. Work the sub-agent produces after
a resume appears in that sub-agent's existing card, which shows as running again.

**Reload.** Reopening the session shows the same cards with the same titles, task lines,
nested transcripts and results as the live run showed.

## Not Included

- `deferred` — Nested delegation: a sub-agent that spawns its own sub-agent. The
  grandchild's output is dropped rather than rendered or leaked to the parent.
- `deferred` — Controls for sending input to, resuming, interrupting or closing a
  sub-agent from Mainframe. This renders what Codex reports; it adds no actions.
- `declined` — A Codex-specific visual treatment for the card. The user's 2026-07-30 gate
  ruling: Codex delegations render through the same card as Claude subagents. A distinct
  affordance would be a separate todo.
- `deferred` — Adding the reasoning-effort level that makes Codex delegate proactively to
  the effort union and the composer's picker (separate todo).
- `deferred` — The turn-start collaboration-settings payload gap found on the same trail
  (separate todo).
- `deferred` — The left-panel Agents tab, agent-definition discovery, and the sidebar
  skills/agents fetch behavior. Not this todo, per the 2026-07-29 ruling.
- `platform` — Live streaming across a daemon restart. A restart mid-delegation drops the
  live view; the reload path restores it.

## Edge cases

- **Codex names no receiver.** The current build sends the wait call with an empty
  receiver list and an empty per-sub-agent state map. The card must still be fully
  populated from the start notification.
- **Codex does name receivers.** Older or future builds, or a wait on several sub-agents,
  populate the receiver list. Those sub-agents are honored, and a sub-agent named by both
  routes gets exactly one card.
- **Wait times out.** Codex's wait returns an empty status on timeout and can end early on
  new user input. A completed wait therefore does not by itself finish a card; the card
  resolves on the sub-agent reaching a final status.
- **Parent turn ends with a card still open.** The card stops running and resolves with
  whatever the sub-agent last produced; it never spins forever.
- **Sub-agent produced no message.** Result reads "Sub-agent completed", not an error.
- **No registry row, no stored log path.** The card still renders with a non-placeholder
  title and the sub-agent's streamed transcript. No retry loop, no empty card.
- **An item arrives on a thread that is neither the parent nor a registered sub-agent.**
  It is dropped and logged; it is never shown as parent output. Grandchild delegation
  lands here.
- **An item arrives with no thread id.** It belongs to the parent conversation.
- **Reload of a session whose stored parent transcript predates this change.** The card
  renders from whatever the stored transcript carries; a missing sub-agent identity
  degrades the title, and must not produce a crash or an empty card.
- **A sub-agent's rollout log and its live stream both describe the same work.** The card
  shows that work once.

## Acceptance criteria

1. Replaying the committed capture
   (`packages/core-rs/crates/mainframe-adapter-codex/tests/fixtures/collab-delegation-0.144.3.jsonl`,
   recorded live against Codex 0.144.3: a `subAgentActivity` item with `kind: "started"`,
   then a `wait` collab tool call with `receiverThreadIds: []` and `agentsStates: {}`,
   then a reasoning item and a final message on the sub-agent's thread id, then the wait
   completing still empty) produces exactly one sub-agent card. The capture's sub-agent
   reasoning item carries an empty `summary` and empty `content`, so it renders as an
   empty thinking block; no criterion asserts sub-agent reasoning *text* against this
   capture.
2. That card's title is not "Sub-agent"; for this capture it is "compute sum", derived
   from the agent path `/root/compute_sum`.
3. That card's task line is non-empty.
4. That card's nested transcript contains the sub-agent's final message
   "4. Confirmed: 2 + 2 = 4.", and it contains the thinking block the sub-agent's reasoning
   item renders to — asserted by presence and position inside the card, since that item's
   text is empty in the capture.
5. That card's result text is "4. Confirmed: 2 + 2 = 4."
6. In that same replay, no block carrying the sub-agent's reasoning or final message is
   emitted into the parent conversation at top level, and the parent's own two messages
   still are.
7. In that same replay, the sub-agent's `turn/started` and `turn/completed` produce no
   parent turn result, and the sub-agent's `thread/tokenUsage/updated` does not change the
   usage or context total the parent's `turn/completed` reports. A test asserts the
   parent's reported usage equals the parent's own last usage snapshot.
8. A test replays the previously-working shape — populated `receiverThreadIds` plus a
   populated `agentsStates` message — and still produces one card with the registry-derived
   title and the state-map result.
9. A test replays a start notification and a populated receiver list naming the same
   sub-agent and asserts exactly one card, not two.
10. Each of the five collab tool values has a test asserting its effect: `wait` can resolve
    an open card; `spawnAgent`, `sendInput`, `resumeAgent` and `closeAgent` leave an open
    card open and un-duplicated; an unrecognized value is logged and changes nothing.
11. Each of the three sub-agent activity kinds has a test asserting its effect: `started`
    registers the sub-agent and opens its card, `interacted` leaves the open card
    unchanged and running, `interrupted` resolves it to an error result reading
    "Sub-agent interrupted".
12. No branch and no test compares the collab tool call's status against a value its
    protocol enum does not define. The enum is `inProgress`, `completed`, `failed`; the
    `interrupted` comparison present today is dead and is removed. A test asserts a
    `failed` wait resolves its card to an error state, and a test asserts a `completed`
    wait whose sub-agent was interrupted still renders an errored card — `completed` alone
    is not proof of success.
13. A test asserts that an item whose thread id is neither the session's thread nor a
    registered sub-agent's is dropped — it reaches neither the parent conversation nor any
    card — and that an item with no thread id reaches the parent conversation.
14. A test asserts a card left open when the parent's turn completes stops running and
    carries the sub-agent's last message as its result.
15. A test asserts a sub-agent with no registry row and no stored log path renders a card
    with a non-placeholder title and its streamed transcript.
16. A test asserts the session reload path, fed the same captured delegation, produces the
    same card title, task line, nested transcript and result as criterion 1–5's live
    replay.
17. A test asserts a live run does not emit the sub-agent's messages twice into one card
    (live stream and stored-log replay do not both feed the same open card).
18. The delegation renders through the existing subagent-category → task-group → `Task`
    card pipeline: the emitted tool call stays in the adapter's `subagent` tool category
    and the UI renders `chat-task-card` with `chat-task-agent` and `chat-task-description`
    populated. No new UI component ships. If any UI change is needed, its interactive
    elements carry `data-testid` in `<surface>-<element>` kebab-case keyed by the
    sub-agent's thread id, never an array index.
19. The capture in criterion 1 is committed in the repository and is the payload the tests
    replay; no test in this change asserts the new behavior against a hand-written
    delegation payload alone.
20. `cargo test -p mainframe-adapter-codex` passes; UI tests pass if the UI changed; no
    file exceeds 300 lines and no function 50; a changeset is included.
21. No new HTTP route or WebSocket message is added, so the Zod/`ok`/`fail` envelope
    requirements do not apply. `packages/core-rs` is the only runtime touched; there is no
    Node-daemon parity work.

## Decisions

Hard-to-reverse first.

1. **One card per sub-agent thread, keyed by the spawn call, not one card per wait call.**
   `hard-to-reverse` — card identity lands in persisted transcript messages, so changing
   it later re-shapes stored history. The capture shows the start notification carrying
   the spawn call id and arriving before the wait, and Codex's wait can cover several
   sub-agents, so per-sub-agent is the only keying that survives both shapes.
2. **The sub-agent's identity comes from the start notification (thread id + agent path),
   with the receiver list honored when present.** `hard-to-reverse` — this is the change's
   premise; every other ruling assumes it. The capture proves the receiver list is empty
   on the shipping build.
3. **An item on an unknown thread is dropped and logged, not attributed to the parent.**
   `reversible` — flagged at the brief gate as the riskiest flip. Codex only streams
   threads Mainframe knows about (the session's own, or a registered sub-agent's), so an
   unknown thread is by definition not the parent speaking; showing it as the parent is
   the leak being fixed. Criterion 13 pins it, and the debug log keeps a dropped item
   diagnosable.
4. **Sub-agent turn lifecycle and token usage no longer drive the parent session — added
   to scope.** `reversible` — not in the brief; found in the capture, where the sub-agent's
   `turn/completed` and `thread/tokenUsage/updated` arrive on the parent's connection
   before the parent finishes. Same root cause as the transcript leak (thread-id-agnostic
   handling) and user-visible, so it is fixed here rather than filed.
5. **The card resolves on the sub-agent reaching a final status, with the parent's turn
   end as a backstop.** `reversible` — Codex documents wait as returning an empty status on
   timeout and ending early on new user input, so wait completion alone is not proof the
   sub-agent finished.
6. **Title fallback chain: Codex registry nickname/role → humanized agent path →
   "Sub-agent".** `reversible` — adopts the brief's recommendation unchanged. The wait
   call's per-sub-agent state was considered as a middle link and rejected: that value is
   `{ status, message }` only, so it carries no name. Nickname and role live solely on the
   registry's thread row, and `message` feeds the result line, not the title.
7. **Task line falls back to the sub-agent's humanized name when no prompt is present.**
   `reversible` — the spawn prompt is encrypted in the payload, so a prompt is the
   exception, not the rule; a blank task line is worse than a name.
8. **Error state comes from three in-protocol signals: a `failed` collab tool call, an
   `interrupted` sub-agent activity, or the sub-agent's own turn ending `failed` or
   `interrupted`. The `interrupted` half of today's collab-tool-call status comparison is
   deleted.** `reversible` — the tool call's enum is `inProgress | completed | failed`, so
   `failed` is a real signal and stays, while `interrupted` is not a member and can never
   match. The third signal reads the sub-agent's *turn* status, whose enum is
   `inProgress | completed | failed | interrupted`; the adapter already treats those same
   two members as errors on the parent's own turn, so no new comparison value is
   introduced. The per-sub-agent state carried in the wait call was rejected as this
   signal's source: it is a different enum, and the shipping build sends that map empty, so
   a signal read from it would never fire. The two non-tool-call signals are kept because a
   `completed` wait says only that the parent stopped waiting, not that the sub-agent
   succeeded.
9. **The live stream drives the card during a run; the stored rollout is the reload
   source.** `reversible` — adopts the brief's recommendation; the capture proves
   sub-agent items arrive on the same connection, and running both sources into one open
   card is the duplication criterion 17 forbids.
10. **The sub-agent's tool calls (commands, file edits) render inside the card.**
    `reversible` — adopts the brief; a card showing only prose hides what the sub-agent
    did.
11. **No Codex-specific card.** `reversible` — the user's 2026-07-30 gate ruling; recorded
    here so it is visible, not re-litigated.
12. **Grandchild delegation is dropped, not rendered.** `reversible` — the drop rule in
    decision 3 covers it; rendering a two-level nest is its own design question and no
    capture of it exists.
13. **The capture is committed with this spec, filtered to the notification methods the
    adapter consumes and with the home path scrubbed.** `reversible` — the only known
    recording of a real delegation lived in `/tmp` and would not have survived to the
    implementation stage. The planner may relocate it; provenance is Codex 0.144.3,
    2026-07-30.
