# Todo #327 — Codex sub-agents as session activity: implementation plan

Spec: `docs/specs/2026-08-14-todo-327-codex-agent-activity.md` (committed, route: full).

## Goal

Make a Codex session's sub-agent delegations appear in the shared background-activity
model, so the Activity panel lists one live `agent` row per working sub-agent and the
rail's dot and "N tasks running" label count them — exactly as they already do for
Claude. The Codex adapter becomes a second writer to `BackgroundTaskTracker`: the card
engine that already opens and resolves one transcript card per child thread also opens
and ends one tracker entry per child, carrying the card's own title, so the row and the
card can never disagree. No client-facing shape changes, no renderer change, no new
UI: the panel keeps rendering one adapter-agnostic model.

## Established facts

Verified while planning. Downstream implementers and reviewers should trust these
instead of re-deriving them.

1. The tracker is keyed by the **Mainframe chat id**, not the CLI session id — Claude
   passes `st.mainframe_chat_id` into every task-event call
   (`packages/core-rs/crates/mainframe-adapter-claude/src/events.rs:128-132`), and the
   chat manager reads it back with the chat row's own id
   (`packages/core-rs/crates/mainframe-chat/src/chat_manager/reads.rs:15`, `:31`).
2. `CodexSession::new` currently **drops** `options.mainframe_chat_id`
   (`packages/core-rs/crates/mainframe-adapter-codex/src/session.rs:124-143`); the field
   exists on `SessionOptions`
   (`packages/core-rs/crates/mainframe-types/src/adapter.rs:64-69`).
3. `CodexAdapter::new` takes only a `ResolvedPath`
   (`packages/core-rs/crates/mainframe-adapter-codex/src/adapter.rs:83-89`) and is
   constructed at `packages/core-rs/crates/mainframe-daemon/src/main.rs:209`, where the
   tracker built at `main.rs:201` is already in scope (Claude receives it at
   `main.rs:204-208`).
4. The liveness sweep **skips every non-`Bash` kind** — "agents/workflows run inside the
   CLI and have no writer — probing them would false-stop live work"
   (`packages/core-rs/crates/mainframe-background-tasks/src/liveness.rs:78-85`). An
   `agent` entry with an empty `output_path` is therefore never probed or auto-stopped.
5. `BackgroundTaskTracker::end` is idempotent on a terminal entry: it returns the
   existing task without emitting a second `ended` event
   (`packages/core-rs/crates/mainframe-background-tasks/src/tracker.rs:167-169`), and
   `end` on an unknown id drops silently (`tracker.rs:165-166`). This is the receipt for
   the "ending a row twice is a no-op" edge case.
6. `BackgroundTaskTracker::start` upserts (keeps `started_at`, emits `updated`) only when
   the existing entry is still `Running`; otherwise it emits `started` with a fresh
   `started_at` (`tracker.rs:116-155`).
7. CLI exit already ends every running entry for the chat, adapter-agnostically:
   `EventHandler`'s exit path calls `tracker_end_all_running(&self.chat_id)`
   (`packages/core-rs/crates/mainframe-chat/src/event_handler.rs:1039`, delegating to
   `tracker.end_all_running` at `tracker.rs:272-288`). Spec decision 9 needs no new code.
8. The client-facing projection carries `id`, `kind`, `description`, `startedAt` (+
   optional workflow fields) and falls back to `command` when `description` is empty
   (`packages/core-rs/crates/mainframe-types/src/background_task.rs:116-129`).
   `tool_name` and `output_path` never reach the client.
9. Claude's own agent tasks already seed `tool_name: BackgroundTaskToolName::Bash` when
   no Bash/Monitor metadata was captured
   (`packages/core-rs/crates/mainframe-adapter-claude/src/task_events.rs:219-222`), so
   reusing `Bash` for a Codex agent entry matches existing precedent.
10. The card engine funnels every naming route through `open_card`, which early-returns
    when the child is already registered
    (`packages/core-rs/crates/mainframe-adapter-codex/src/collab_card.rs:64-103`), and
    every close route through `resolve_card`, which early-returns on an already-resolved
    card (`.../collab_resolve.rs:27-57`). Hooking these two functions inherits the
    dedupe rules the spec demands.
11. `SpawnAgent` opens no card — it only stashes the prompt
    (`collab_card.rs:144-145`, `stash_spawn_prompts` at `:130-136`) — and `CloseAgent`
    plus `Unknown` currently fall into a debug-log arm with no effect
    (`collab_card.rs:155-160`). Spec decision 1 (no row on spawn) is satisfied by
    hooking `open_card` rather than the tool dispatch.
12. The card title chain is `nickname → role → humanized spawn path → "Sub-agent"`
    (`collab_identity.rs::card_title:18-23`); the card's task line is the prompt, which
    is **not** what AC 1 compares against — the row's `description` must equal the
    title.
13. `CodexSessionState` derives `Debug`
    (`.../session_state.rs:38-56`), and `BackgroundTaskTracker` does **not**
    (`tracker.rs:79-85`). Both of the tracker's field types do implement `Debug`
    (`tokio-1.52.3/src/sync/broadcast.rs:1685` `impl<T> fmt::Debug for Sender<T>`;
    `dashmap-6.2.1/src/lib.rs:1236` `impl<K: Eq + Hash + Debug, V: Debug, S> Debug for
    DashMap`), so `#[derive(Debug)]` on the tracker compiles.
14. `mainframe-adapter-codex/Cargo.toml` does not yet depend on
    `mainframe-background-tasks`; the workspace already declares that path dependency
    (`packages/core-rs/Cargo.toml:71`).
15. The codex crate's integration tests drive the real event mapper through
    `replay_capture(path, &rec, &mut state)` / `handle_notification`
    (`packages/core-rs/crates/mainframe-adapter-codex/tests/common/mod.rs:158-179`), with
    a throwaway sqlite thread registry from `temp_registry`
    (`tests/common/mod.rs:186-205`). `CodexSessionState` is re-exported from
    `mainframe_adapter_codex::event_mapper` for tests
    (`tests/collab_delegation.rs:12`).
16. The renderer is already adapter-agnostic: `ActivityCard.tsx` maps `kind → glyph`
    and `kind → label` from constants (`packages/ui/src/features/session-panel/
    ActivityCard.tsx:36-49`, testid `session-panel-kind-${kind}`), and the rail label
    comes from `runningLabel` (`.../activity-view.ts:14-18`). AC 7 and AC 11 are
    verification-only.
17. The mock (replay) adapter has **no** background-task bridge on this branch — its
    only tracker-adjacent surface is `stop_background_task`, which answers unsupported
    (`packages/core-rs/crates/mainframe-adapter-mock/src/session_trait.rs:143-150`) —
    and the e2e session-panel spec says so explicitly: "Background Activity's running
    state is not [covered]" (`packages/e2e/tests-tauri/session-panel.spec.ts:67`).
18. Codex answers `stop_background_task` with `ok: false`
    (`packages/core-rs/crates/mainframe-adapter-codex/src/session.rs:750-757`); this plan
    does not change that (spec decision 7 / #328).

## Design

### Where a row opens and ends

Four hook points, all inside the card engine, so "row follows card" holds by
construction (facts 10-12):

| Event | Existing function | New effect |
|---|---|---|
| sub-agent started report, or a `wait` naming the child | `collab_card::open_card` | open one entry, `description = title` |
| `sendInput` / `resumeAgent` on a resolved child | `collab_card::reopen_card` | open a **new** entry (spec decision 5) |
| completion / failure / interruption / unnamed-`wait` failure | `collab_resolve::resolve_card` | end the entry |
| `closeAgent` completing without failure | new arm in `collab_card::on_collab_tool_call` | end the entry, card untouched (spec decision 3) |
| parent `turn/completed` (`Owner::Parent`) | `turn_lifecycle::handle_turn_completed` | after the card sweep, drain every remaining entry |

Unknown activity kinds and unknown tool names reach none of these functions, so they
open and end nothing — no new guard needed (fact 11).

### State

`CodexSessionState` gains three fields:

```rust
pub mainframe_chat_id: String,
pub background_tasks: Option<Arc<BackgroundTaskTracker>>,
/// child thread id → live tracker task id. Presence means "a row is live".
pub agent_task_ids: HashMap<String, String>,
```

`None` tracker (every existing test state, and the reload/history paths, which build
their own states) makes every hook a no-op — that is also what makes spec decision 6
(no rehydration on resume) true by construction.

Entry id: a fresh `nanoid!()` per round, prefixed `codex-agent-`. Presence in
`agent_task_ids` is the liveness flag: open no-ops when the key exists (AC 4), end
removes the key. A fresh id per round is required so a re-engagement (AC 6) does not
overwrite the ended record in the tracker's per-chat map (fact 6).

Seed fields: `kind: Agent`, `tool_name: Bash` (fact 9), `tool_use_id`: the card's
`card_id`, `command` and `description`: the card title (fact 8 — never a raw thread
id), `workflow_name: None`, `output_path: String::new()` (fact 4).

### Pinned sub-decisions (not in the spec; tests pin them)

- **P1 — `closeAgent` ends on `Phase::Completed` with a non-`Failed` status, for each id
  in `receiver_thread_ids`.** A `closeAgent` that itself failed leaves the row to the
  turn-end sweep rather than claiming work stopped that may still be running. A
  `closeAgent` with no `receiver_thread_ids` ends nothing.
- **P2 — the turn-end drain runs after the card sweep** and ends every entry still in
  `agent_task_ids`, so a row whose card was already resolved by another route can never
  survive the turn (AC 8).
- **P3 — no row is opened when `mainframe_chat_id` is empty**, mirroring Claude's
  `if !st.mainframe_chat_id.is_empty()` guard (`events.rs:128`).

## Constraints

- Max 300 lines/file, 50/function. `collab_card.rs` is at 188 lines and `collab_resolve.rs`
  at 138 — the new logic lives in its own `collab_activity.rs`, called from both.
- Rust daemon and TS types stay in parity: **no** shape change to `BackgroundTask`,
  `BackgroundActivityTask` or the event envelope (AC 12, spec decision 10).
- No `console.*`/`println!`; failures log through `tracing` at debug, like the
  surrounding collab code.
- A changeset is required before committing (`pnpm changeset`).
- Tests: new adapter logic gets a test file; existing Claude/background-activity tests
  must stay green untouched.

## Tasks

Run every `cargo` command from `packages/core-rs`. TDD order: group A's tests are
written and observed failing before group B exists.

### Group A — red-phase adapter tests

**Task 1. Test dependency and local helper.**
Files: `packages/core-rs/crates/mainframe-adapter-codex/Cargo.toml`, new
`packages/core-rs/crates/mainframe-adapter-codex/tests/collab_activity.rs`.
Add `mainframe-background-tasks = { workspace = true }` to `[dev-dependencies]` (task 4
promotes it to `[dependencies]`; keeping the dev entry until then is what makes the red
phase runnable). Put the helper **inside the new test file, not in
`tests/common/mod.rs`** — every codex test binary does `mod common;`, so a helper that
references fields task 3 has not added yet would red the whole suite instead of this one
binary. Helper: `fn state_with_tracker(rows: &[RegistryRow<'_>]) -> (tempfile::TempDir,
Arc<BackgroundTaskTracker>, CodexSessionState)`, building `common::temp_registry(rows)`,
a fresh `Arc<BackgroundTaskTracker>`, and a `CodexSessionState` with `registry_deps`,
`mainframe_chat_id: "chat-327"`, `background_tasks: Some(tracker.clone())`.
Verify (red): `cargo test -p mainframe-adapter-codex --test collab_activity` fails to
compile with "no field `background_tasks` on type `CodexSessionState`", while
`cargo test -p mainframe-adapter-codex --test collab_delegation` stays green. That
one-binary red is the expected state for tasks 1-2; group B turns it green.

**Task 2. Lifecycle tests.**
File: `packages/core-rs/crates/mainframe-adapter-codex/tests/collab_activity.rs`
(created in task 1).
Drive `handle_notification` with hand-built `item/started` / `item/completed` /
`turn/completed` payloads (shapes copied from `tests/collab_delegation.rs` and
`tests/fixtures/collab-delegation-0.144.3.jsonl`), asserting on
`tracker.list_live("chat-327")`. One test per acceptance clause:

1. `sub_agent_started_opens_one_running_agent_entry` — AC 1: exactly one entry,
   `kind == Agent`, `description == "Maxwell"` (registry nickname).
2. `entry_description_equals_the_card_title` — AC 1: read the `CollabAgent` tool_use
   block's `input.subagent_type` from the recorder and assert character-for-character
   equality with the entry's `description`, for a registry row with a nickname.
3. `unresolved_identity_reads_sub_agent_in_both_views` — AC 1/3: empty registry, no
   `agentPath` → both the card title and the entry description are `"Sub-agent"`.
4. `a_late_nickname_does_not_rename_the_entry` — AC 3 (spec decision 11).
5. `spawn_call_alone_opens_no_entry` — AC 2: live set stays empty.
6. `wait_naming_an_unknown_child_opens_one_entry` — spec "open on wait" route.
7. `repeat_delegation_calls_add_no_entry_and_keep_started_at` — AC 4: `sendInput`,
   `resumeAgent`, `wait` against the live child; assert one entry with an unchanged
   `started_at`.
8. `completion_ends_the_entry`, `failure_ends_the_entry`,
   `interruption_ends_the_entry`, `close_agent_ends_the_entry` — AC 5, one test each.
9. `re_engagement_after_end_opens_a_new_entry` — AC 6: end via completion, then
   `sendInput`; new id, `started_at >=` the ended one, identical `description`.
9b. `re_engagement_after_close_agent_opens_a_new_entry` — the same clause on the
   `closeAgent` route, where the card is still open and unresolved (this is what
   forces the unconditional `open_activity` call in `reopen_card`).
10. `parent_turn_end_drains_every_entry` — AC 8 (P2).
11. `unknown_activity_kind_and_unknown_tool_open_and_leak_nothing` — AC 9 edge case.
12. `ending_twice_emits_one_ended_event` — subscribe to the tracker, drive completion
    then the turn-end sweep, assert exactly one `Ended` for that id (fact 5).
13. `a_state_without_a_tracker_is_inert` — the default state path (no panic, no work).

Verify: `cargo test -p mainframe-adapter-codex --test collab_activity` fails to compile
(the state fields do not exist yet). Record the compiler error in the commit message as
the red observation, then stop — group B makes it pass.

### Group B — Codex adapter writes to the tracker

**Task 3. State fields.**
File: `packages/core-rs/crates/mainframe-adapter-codex/src/session_state.rs`. Add the
three fields from the design section with doc comments. Add
`#[derive(Debug)]` to `BackgroundTaskTracker`
(`packages/core-rs/crates/mainframe-background-tasks/src/tracker.rs:79`) so
`CodexSessionState`'s existing derive still compiles (fact 13); if that derive is
rejected, implement `Debug` for `CodexSessionState` by hand and skip the tracker field
instead.
Verify: `cargo check -p mainframe-adapter-codex && cargo test -p mainframe-background-tasks`.

**Task 4. Crate dependency.**
File: `packages/core-rs/crates/mainframe-adapter-codex/Cargo.toml`. Move
`mainframe-background-tasks = { workspace = true }` from `[dev-dependencies]` (task 1)
into `[dependencies]` (fact 14); a crate must not list the same path dependency twice.
Verify: `cargo check -p mainframe-adapter-codex`.

**Task 5. The activity module.**
New file: `packages/core-rs/crates/mainframe-adapter-codex/src/collab_activity.rs`
(register it in `src/lib.rs`). Three `pub(crate)` functions, each ≤ 30 lines:
- `open_activity(child_thread_id: &str, card_id: &str, title: &str, state: &mut CodexSessionState)`
  — returns early when the tracker is `None`, `mainframe_chat_id` is empty (P3), or the
  child already has an id; otherwise `nanoid!()`-prefixed id, `tracker.start(chat_id,
  TaskSeed { kind: Agent, tool_name: Bash, tool_use_id: card_id, command: title,
  description: title, workflow_name: None }, String::new())`, then record the id.
- `end_activity(child_thread_id: &str, state: &mut CodexSessionState)` — removes the id
  and calls `tracker.end(chat_id, &id, TerminalUpdate { status: Completed, output_path:
  String::new(), summary: String::new(), usage: None })`. No-op when absent.
- `end_all_activity(state: &mut CodexSessionState)` — drains the map through
  `end_activity`.
Unit tests in the module's `#[cfg(test)] mod tests` for the `None`-tracker and
empty-chat-id guards.
Verify: `cargo test -p mainframe-adapter-codex collab_activity`.

**Task 6. Hook the card engine.**
Files: `packages/core-rs/crates/mainframe-adapter-codex/src/collab_card.rs`,
`.../src/collab_resolve.rs`, `.../src/turn_lifecycle.rs`.
- `open_card`: after inserting the `SubAgentCard`, call `open_activity` with the same
  `card_id` and `title`.
- `reopen_card`: call `open_activity` **unconditionally** with the card's stored
  `card_id`/`title` (clone them before the mutable borrow ends). Do not gate it on
  `card.resolved`: `closeAgent` ends the row while leaving the card open and unresolved,
  and a gated call would then skip the new round's row. `open_activity`'s own
  map-presence check is the dedupe for a still-live child.
- `resolve_card`: call `end_activity` alongside clearing the card flags.
- `on_collab_tool_call`: split the `CloseAgent | Unknown` arm — `CloseAgent` on
  `Phase::Completed` with a non-`Failed` `classify_collab_status` ends each id in
  `receiver_thread_ids` (P1); `Unknown` keeps the debug log.
- `handle_turn_completed`'s `Owner::Parent` branch: call `end_all_activity(state)`
  immediately after `resolve_open_cards_on_parent_turn_end` (P2).
Keep each file under 300 lines (currently 188 / 138 / 131).
Verify: `cargo test -p mainframe-adapter-codex --test collab_activity` and
`cargo test -p mainframe-adapter-codex` — the whole crate, including
`collab_delegation.rs` and `collab_reload.rs`, must stay green.

**Task 7. Session and adapter wiring.**
Files: `packages/core-rs/crates/mainframe-adapter-codex/src/session.rs`,
`.../src/adapter.rs`, `packages/core-rs/crates/mainframe-daemon/src/main.rs`.
- `CodexSession::new` takes `background_tasks: Arc<BackgroundTaskTracker>` and seeds the
  state with it plus `options.mainframe_chat_id` (fact 2) instead of
  `CodexSessionState::default()`.
- `CodexAdapter` holds the tracker; `CodexAdapter::new(background_tasks, resolved_path)`
  and `Default` (which builds its own `Arc::new(BackgroundTaskTracker::new())`, as
  `ClaudeAdapter` does at `adapter.rs:110`); `create_session` passes it down.
- `main.rs:209`: `CodexAdapter::new(Arc::clone(&background_tasks), resolved_path.clone())`.
- Do not touch `stop_background_task` — Codex keeps answering unsupported (fact 18).
Verify: `cargo check -p mainframe-daemon && cargo test -p mainframe-adapter-codex` and
`cargo test -p mainframe-server --test chat_background_activity` (AC 12: no shape drift).

**Task 8. Consumed-surface rows and changeset.**
Files: `docs/adapters/codex/CONSUMED-SURFACE.md`, `.changeset/<name>.md`.
Add two rows in the existing table format (`| ID | Surface | Upstream artifact |
Mainframe consumer (file::symbol) | Coverage | Verified | Breakage symptom |`):
- `CODEX-ITEM-02` — `SubAgentActivity.kind` vocabulary (`started`, `interacted`,
  `interrupted`), consumer
  `src/collab_protocol.rs::classify_sub_agent_kind`, `src/collab_activity.rs::open_activity`,
  coverage `tests/collab_activity.rs::sub_agent_started_opens_one_running_agent_entry`,
  symptom "a renamed kind stops opening Activity rows and the panel reads Nothing
  running while sub-agents work".
- `CODEX-ITEM-03` — `CollabAgentToolCall.tool` / `.status` /
  `.receiverThreadIds` as the delegation vocabulary that ends and re-opens rows,
  consumer `src/collab_protocol.rs::{classify_collab_tool, classify_collab_status}`,
  `src/collab_activity.rs::end_activity`, coverage
  `tests/collab_activity.rs::close_agent_ends_the_entry` and
  `..::repeat_delegation_calls_add_no_entry_and_keep_started_at`, symptom "rows never
  end (stuck running count) or a re-engaged sub-agent gets no row".
Changeset: `pnpm changeset`, patch on `@qlan-ro/mainframe-ui` (the release-tagged
package for daemon-side changes), describing the user-visible change.
Verify: `git status` shows the changeset file; the two doc rows render as a table row
with seven cells.

### Group C — mock harness and end-to-end verification

Read the "Open risks" note on overlapping uncommitted work before starting task 9.

**Task 9. Agent rows under the replay adapter.**
Files: `packages/core-rs/crates/mainframe-adapter-mock/Cargo.toml`,
`.../src/lib.rs`, `.../src/adapter.rs`, `.../src/session.rs`, new
`.../src/task_bridge.rs`; `packages/core-rs/crates/mainframe-daemon/src/main.rs`.
Derive tracker calls from the replayed message stream: a recorded `tool_use` whose name
is a subagent tool (`Task`, `Agent`) starts an `agent` entry keyed by its
`tool_use_id`; the matching `tool_result` ends it; unresolved work stays running (that
is what a fixture wants). Register the adapter with the tracker at `main.rs:212`
(`MockCliAdapter::new(Arc::clone(&background_tasks))`). Unit-test the bridge inside the
new module: one open, one end, an unknown tool name opening nothing.
Verify: `cargo test -p mainframe-adapter-mock && cargo check -p mainframe-daemon`.

**Task 10. E2E assertion.**
Files: `packages/e2e/tests-tauri/session-panel.spec.ts`, plus the recording it drives
(`packages/e2e/fixtures/recordings/<name>.ndjson` — extend an existing subagent
recording rather than adding a new fixture if one already emits a `Task` tool_use).
Add a test: open the rail's Activity card on a chat whose replay has an unresolved
subagent tool_use, assert `session-panel-kind-agent` is visible, the row's detail line
reads "Agent", `session-panel-rail-activity-dot` exists, and the rail button's label
reads "1 task running"; then replay the resolving `tool_result` and assert
`session-panel-activity-empty`. Update the spec's header comment, which currently
records this as uncovered (fact 17).
Verify: `pnpm test:e2e --grep "activity"` (batch the full suite once at the end of the
series).

**Task 11. Cross-cutting verification (AC 7, 11, 12).**
No production files change.
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-panel/__tests__/ActivityCard.test.tsx`
  and `.../__tests__/SessionPanelRail.test.tsx` — green, unmodified.
- `rg -n "claude|codex|adapterId" packages/ui/src/features/session-panel/ActivityCard.tsx
  packages/ui/src/features/session-panel/SessionPanelRail.tsx
  packages/ui/src/features/session-panel/activity-view.ts` returns nothing (AC 11).
- `cargo test -p mainframe-server --test chat_background_activity` and
  `cargo test -p mainframe-types background_task` — green, unmodified (AC 12).
- `cargo fmt --check && cargo clippy -p mainframe-adapter-codex -- -D warnings`.

## Acceptance-criteria coverage

| AC | Covered by |
|---|---|
| 1 | Tasks 2 (tests 1-3), 5, 6 |
| 2 | Task 2 (test 5) — spawn hooks nothing |
| 3 | Task 2 (test 4) |
| 4 | Task 2 (test 7) |
| 5 | Task 2 (test 8) |
| 6 | Task 2 (tests 9 and 9b) |
| 7 | Tasks 10, 11 |
| 8 | Task 2 (test 10) + fact 7 for session exit |
| 9 | Task 2 (all) |
| 10 | Tasks 9, 10 |
| 11 | Task 11 |
| 12 | Tasks 7, 11 |
| 13 | Task 8 |

## Open risks

- **Overlapping uncommitted work.** A mock-adapter background-task bridge
  (`packages/core-rs/crates/mainframe-adapter-mock/src/task_bridge.rs` plus adapter,
  session and `main.rs` edits, and a `mock-adapter-background-tasks` changeset) exists
  **uncommitted** on the `fix/transcript-switch-scroll` branch in the main checkout. It
  covers Claude-shaped `Task`/`Agent`/`Workflow` tool uses, which subsumes task 9. Before
  starting task 9, check whether it has landed on `main`; if it has, drop task 9 and keep
  only task 10 (the e2e assertion), adjusting testids to whatever that bridge emits.
- **`main.rs` is touched by both group B (task 7) and group C (task 9)** — they cannot
  run concurrently.
- **Codex agent rows are not stoppable.** The daemon's stop route still exists; Codex
  answers unsupported and the Activity panel ships no stop button today. #328 owns
  hiding or disabling the affordance.
- **Elapsed time starts at the row's open, not at spawn** (spec decision 1). A sub-agent
  that spends time between spawn and its started report reads as younger than it is.
