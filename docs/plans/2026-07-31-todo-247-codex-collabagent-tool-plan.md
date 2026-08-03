# Todo #247 — Codex sub-agent delegation card: implementation plan

Spec: [`docs/specs/2026-07-31-todo-247-codex-collabagent-tool.md`](../specs/2026-07-31-todo-247-codex-collabagent-tool.md)
Capture: `packages/core-rs/crates/mainframe-adapter-codex/tests/fixtures/collab-delegation-0.144.3.jsonl` (committed, 29 lines)

## Goal

Make a Codex sub-agent delegation render as one populated sub-agent card in the parent
transcript. Today the Codex adapter derives the child's identity from the `wait` collab
tool call's `receiverThreadIds` and `agentsStates`, both of which Codex 0.144.3 sends
empty, so the card is titled "Sub-agent", has a blank task line, resolves to the literal
"Sub-agent completed", and the child's reasoning and final message leak into the parent
conversation at top level. The same thread-id-agnostic handling also applies the
sub-agent's `turn/started`, `turn/completed` and `thread/tokenUsage/updated` to the parent
chat. This change moves child registration to the `subAgentActivity` notification (thread
id + agent path), keys one card per sub-agent thread, routes every stream item by its
thread id (parent / registered child / drop), resolves the card from the sub-agent's own
turn status with the parent's turn end as a backstop, and does the same on the reload
path. All work is in `packages/core-rs/crates/mainframe-adapter-codex`; no UI component
changes — the delegation keeps flowing through the existing `subagent` tool category →
`apply_tool_grouping` → `task_group` → `TaskCard` pipeline.

## Constraints from CLAUDE.md

- Max 300 lines/file, 50 lines/function. Three files this change touches are already over:
  `session.rs` (902), `history.rs` (575), `event_mapper.rs` (434), `thread_item_render.rs`
  (337). Task group 1 carves the modified regions out into new sub-300 modules.
  **Deviation:** `session.rs` stays over 300 (~810 after the carve-out). Reducing it
  further is a standalone refactor of unrelated session lifecycle code and is not in this
  change. Recorded here rather than silently ignored.
- No `console.*`/silent catches: every drop path logs via `tracing::debug!`/`warn!` with
  `module = "codex:events"`.
- Tests required for new core logic; `cargo test -p mainframe-adapter-codex` must pass.
- Changeset required before commit.
- No new HTTP route or WS message, so no Zod/`ok`/`fail` envelope work (spec criterion 21).

## Design decisions the spec left to the planner

These are load-bearing; the lane review should challenge them if wrong.

1. **Card identity.** The card's `tool_use` id is the `subAgentActivity` item's `id`
   (`call_4Sektr7DEdLzGCaKGNEcUVl4` in the capture — Codex's spawn call id) when the child
   is learned from the activity route. When a child is learned only from a `wait` call's
   `receiverThreadIds` (legacy shape), the card id stays that `wait` item's id, preserving
   today's behavior and the existing tests. Registration is keyed by **child thread id**, so
   a child named by both routes gets exactly one card (spec criterion 9).
2. **A `wait` with an empty `receiverThreadIds` can only fail cards, never complete them.**
   The spec says a `failed` wait resolves "its card", but the shipping build names no
   receivers, so an unnamed failure applies to every card open at that moment. Success never
   travels this route: Codex returns an empty status when the wait times out (spec Edge
   cases §"Wait times out"), which would otherwise classify as `Unknown` and resolve every
   open card while its sub-agent is still running. Completion therefore comes only from the
   sub-agent's own `turn/completed` and from the parent-turn-end backstop. Named receivers
   keep both outcomes — that shape is the one that carries `agentsStates` (spec criterion 8).
3. **The live rollout tail is deleted.** Spec decision 9 makes the live stream the sole
   in-run source and criterion 17 forbids two sources feeding one card. Once child items
   nest via the activity route, `src/child_tail.rs` and `tests/child_tail.rs` are dead code
   whose only effect would be the duplication criterion 17 forbids. `read_rollout_items`
   and `RolloutReaderDeps` stay — the reload path in `session.rs` still uses them.
4. **A resolved card keeps its child-thread registration.** Late child items nest into the
   closed card instead of being dropped or leaking to the parent, and `resumeAgent` /
   `sendInput` re-open a resolved card as running (spec Behavior §"Follow-up delegation
   calls") without creating a second one.
5. **The child's final message is its last non-empty `agentMessage` text on the child's
   thread.** `agentsStates[child].message` still wins when present (spec Behavior §"When it
   finishes").
6. **`thread/tokenUsage/updated` parsing is fixed as part of criterion 7.** The capture
   proves Codex 0.144.3 sends `params.tokenUsage.{total,last}` in camelCase, while
   `TokenUsageUpdatedParams` requires a top-level snake_case `usage` — the exact failure
   `docs/adapters/codex/CONSUMED-SURFACE.md` row CODEX-EVT-04 predicts. Without the fix,
   criterion 7's assertion is vacuous (`None == None`) and the parent context gauge stays
   dead. Mapped from `tokenUsage.last` (per-turn), which matches what
   `handle_turn_completed` already reports as `context_tokens`. Legacy `usage` still parses.

## Task groups

### Group 1 — Carve-out and protocol scaffolding (core)

Mechanical module splits plus small pure helpers. No behavior change except the deletion in
task 4. Runs first because every later group writes into files it creates.

**Task 1.** Split `src/event_mapper.rs` (434 lines) without changing behavior.
- Create `packages/core-rs/crates/mainframe-adapter-codex/src/session_state.rs`: move
  `CurrentTurnPlan`, `LastUsage`, `CodexSessionState` verbatim.
- Create `.../src/parent_id_sink.rs`: move `ParentIdSink` and its impl verbatim; move
  `src/event_mapper/parent_id_sink_tests.rs` to `src/parent_id_sink/tests.rs` and update the
  `#[cfg(test)] mod` declaration. Delete the now-empty `src/event_mapper/` directory.
- Create `.../src/turn_lifecycle.rs`: move `handle_turn_started`, `handle_turn_completed`,
  `handle_token_usage`, `handle_plan_delta` verbatim, as `pub(crate)`.
- `src/event_mapper.rs` keeps `handle_notification`, `handle_thread_started`,
  `handle_account_rate_limits_updated`, `handle_item_started`, `handle_item_completed`,
  `plan_item_fields`, and re-exports `CodexSessionState`, `CurrentTurnPlan`, `LastUsage`,
  `ParentIdSink` so `use mainframe_adapter_codex::event_mapper::CodexSessionState` in
  `tests/event_mapper.rs` still resolves.
- Verify: `cargo test -p mainframe-adapter-codex` passes unchanged; `wc -l` on
  `src/event_mapper.rs` is under 300.

**Task 2.** Split `src/history.rs` (575 lines) without changing behavior.
- Create `.../src/history_convert.rs`: move `convert_thread_items` and its
  `ThreadItem` match verbatim.
- Create `.../src/history_collab.rs`: move `emit_collab_agent` verbatim.
- Create `.../src/unified_diff.rs`: move `parse_unified_diff`, `parse_hunk_header`,
  `parse_pair` verbatim, keeping the `TODO(port)` comment.
- `src/history.rs` keeps `make_message`, `reasoning_text`, `user_message_text`,
  `is_exec_error`, `bash_input`, `file_change_input`, `mcp_result_content`,
  `extract_added_content`, the block builders, `collab_agent_tool_use`, `with_parent`, and
  re-exports `convert_thread_items` and `parse_unified_diff` so `src/session.rs`,
  `src/thread_item_render.rs` and `tests/history.rs` keep compiling.
- Verify: `cargo test -p mainframe-adapter-codex --test history` passes unchanged; all four
  files under 300 lines.

**Task 3.** Extract `load_history_inner` from `src/session.rs` into a new
`.../src/history_load.rs` as `pub(crate) async fn load_history_inner(...)`, verbatim, with
its `use` block. `src/session.rs` imports it. No behavior change.
- Verify: `cargo check -p mainframe-adapter-codex`; `wc -l src/session.rs` decreased by ~90.

**Task 4.** Delete the live rollout tail (design decision 3).
- Delete `.../src/child_tail.rs` and `.../tests/child_tail.rs`.
- Remove `pub mod child_tail;` from `src/lib.rs` (including its two-line comment).
- Remove `spawn_child_tails` and the `spawn_child_tail` call from
  `src/thread_item_render.rs`; remove `child_tails` from `CodexSessionState` in
  `src/session_state.rs` and every read/write of it in `src/thread_item_render.rs`.
- Remove the now-unused `tokio_util::sync::CancellationToken` import from
  `src/thread_item_render.rs`. Leave `read_rollout_items` and `RolloutReaderDeps` untouched.
- Verify: `cargo test -p mainframe-adapter-codex` passes (the collab tests in
  `tests/event_mapper.rs` still pass — none of them assert on tails); `cargo clippy
  -p mainframe-adapter-codex -- -D warnings` reports no unused imports.

**Task 5.** Create `.../src/collab_protocol.rs` — string→enum classifiers, no I/O.
- `pub(crate) enum CollabTool { SpawnAgent, SendInput, ResumeAgent, Wait, CloseAgent,
  Unknown }` and `pub(crate) fn classify_collab_tool(tool: &str) -> CollabTool` mapping
  `"spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent"`, everything else to
  `Unknown` with a `tracing::debug!` naming the value.
- `pub(crate) enum SubAgentKind { Started, Interacted, Interrupted, Unknown }` and
  `classify_sub_agent_kind(&str)` over `"started" | "interacted" | "interrupted"`.
- `pub(crate) enum CollabCallStatus { InProgress, Completed, Failed, Unknown }` and
  `classify_collab_status(&str)` over `"inProgress" | "completed" | "failed"` — note in a
  doc comment that `"interrupted"` is deliberately absent from the collab-call enum.
- Inline `#[cfg(test)] mod tests` asserting every defined value plus one unknown per enum.
- Register `pub(crate) mod collab_protocol;` in `src/lib.rs`.
- Verify: `cargo test -p mainframe-adapter-codex collab_protocol`.

**Task 6.** Create `.../src/collab_identity.rs` — the identity chains shared by the live and
reload paths (pure functions, no state).
- `pub(crate) fn humanize_agent_path(path: &str) -> Option<String>`: last `/`-separated
  non-empty segment, `_` → space, trimmed; `None` when the result is empty.
- `pub(crate) fn card_title(meta: Option<&AgentMetadata>, agent_path: Option<&str>) ->
  String`: `agent_title(meta)` → `describe_agent(meta)` → `humanize_agent_path` →
  `"Sub-agent"` (spec decision 6).
- `pub(crate) fn card_task_line(prompt: Option<&str>, title: &str) -> String`: the prompt
  when it is `Some` and non-empty, otherwise `title` (spec decision 7; never blank).
- Inline tests: `/root/compute_sum` → `"compute sum"`; registry nickname beats the path;
  role used when nickname is absent; `""` and `"/"` fall through to `"Sub-agent"`; task
  line falls back to title on `None` and on `Some("")`.
- Register `pub(crate) mod collab_identity;` in `src/lib.rs`.
- Verify: `cargo test -p mainframe-adapter-codex collab_identity`.

**Task 7.** Make `SubAgentActivityItem.agent_path` optional in
`.../src/thread_item_variants.rs`: `#[serde(default)] pub agent_path: Option<String>`, so a
build that omits it still registers the child instead of failing the whole item's
deserialization. Update the assertion in `.../tests/item_types.rs` that reads `agent_path`.
- Verify: `cargo test -p mainframe-adapter-codex --test item_types`.

**Task 8.** Add a test seam to `.../src/thread_registry.rs`.
- `#[derive(Debug, Clone, Default)] pub struct ThreadRegistryDeps { pub db_path:
  Option<PathBuf> }`.
- `pub fn lookup_agent_metadata_with(thread_ids: &[String], deps: Option<&ThreadRegistryDeps>)
  -> HashMap<String, AgentMetadata>` — the existing body, with `db_path()` overridden by
  `deps.db_path`. `lookup_agent_metadata` becomes a one-line call with `None`.
- Verify: `cargo check -p mainframe-adapter-codex`; existing callers unchanged.

**Task 9.** Fix `TokenUsageUpdatedParams` in `.../src/types.rs` for Codex 0.144.3 (design
decision 6).
- Add `#[derive(Deserialize)] struct TokenUsageEnvelope { #[serde(default)] total:
  Option<CamelUsage>, #[serde(default)] last: Option<CamelUsage> }` and `struct CamelUsage`
  with `#[serde(rename_all = "camelCase")] { input_tokens: i64, cached_input_tokens:
  Option<i64>, output_tokens: i64 }`.
- `TokenUsageUpdatedParams` gains `#[serde(default)] pub token_usage:
  Option<TokenUsageEnvelope>` and its `usage` field becomes `#[serde(default)] pub usage:
  Option<Usage>`; add `pub fn resolved_usage(&self) -> Option<Usage>` returning `usage`
  first, else `token_usage.last`, else `token_usage.total`.
- Update `handle_token_usage` in `src/turn_lifecycle.rs` to call `resolved_usage()` and
  return early (debug-logged) when it is `None`.
- Update `docs/adapters/codex/CONSUMED-SURFACE.md` row CODEX-EVT-04 to describe both
  accepted shapes and name the new test.
- Inline `#[cfg(test)]` tests in `src/types.rs`: the capture's `tokenUsage` payload parses to
  `last` values; the legacy top-level `usage` payload still parses; a payload with neither
  yields `None`.
- Verify: `cargo test -p mainframe-adapter-codex types::`.

**Task 10.** Reshape the collab state in `.../src/session_state.rs` and register the
remaining new modules in `.../src/lib.rs`.
- Add `#[derive(Debug, Clone)] pub struct SubAgentCard { pub card_id: String, pub title:
  String, pub open: bool, pub resolved: bool, pub last_message: Option<String> }`.
- Replace `open_collab_cards`, `errored_collab_cards`, `collab_child_threads` and
  `child_tails` with `pub sub_agent_cards: HashMap<String /* child thread id */,
  SubAgentCard>`; keep `spawn_prompts`. Add `pub registry_deps:
  Option<ThreadRegistryDeps>` (production leaves it `None`).
- Add helper methods on `CodexSessionState`: `card_for_thread(&self, tid: &str) ->
  Option<&SubAgentCard>`, `open_card_ids(&self) -> Vec<String>`,
  `thread_for_card(&self, card_id: &str) -> Option<String>`.
- Create empty-but-declared `.../src/collab_card.rs` (doc comment only) and register
  `pub(crate) mod collab_card;`, `pub(crate) mod session_state;`, `pub(crate) mod
  parent_id_sink;`, `pub(crate) mod turn_lifecycle;`, `pub(crate) mod history_convert;`,
  `pub(crate) mod history_collab;`, `pub(crate) mod unified_diff;`, `pub(crate) mod
  history_load;` in `src/lib.rs`, so groups 3 and 4 never touch `lib.rs`.
- Stub out the collab call sites in `src/thread_item_render.rs` that referenced the removed
  fields with `todo!()`-free minimal equivalents keyed off `sub_agent_cards` so the crate
  still compiles; behavior at this point may differ from both old and new — group 2's tests
  are what pin the target.
- Verify: `cargo check -p mainframe-adapter-codex` and `cargo clippy -p
  mainframe-adapter-codex -- -D warnings` both clean.

### Group 2 — Red-phase tests (test)

Written against the target behavior; expected to fail (or fail to compile against
not-yet-written `collab_card` functions) until groups 3 and 4 land.

**Run these tasks in order, not in parallel.** Tasks 12, 13 and 14 all consume the harness
task 11 adds to `tests/common/mod.rs` (`replay_capture`, `capture_path`, `temp_registry`,
`Recorder::nested_blocks`, `Recorder::top_level_blocks`), none of which exists today. Started
concurrently, they fail to compile instead of failing red.

**Task 11.** Extend `.../tests/common/mod.rs` with the replay and registry harness.
- `pub fn replay_capture(path: &str, rec: &Recorder, state: &mut CodexSessionState)`: reads
  a JSONL file, and for each line dispatches `handle_notification(line["method"],
  line["params"], &rec.sink(), state)`.
- `pub fn capture_path(name: &str) -> String`: `concat!(env!("CARGO_MANIFEST_DIR"),
  "/tests/fixtures/")` + name.
- `pub fn temp_registry(rows: &[(&str, Option<&str>, Option<&str>, Option<&str>)]) ->
  (tempfile::TempDir, ThreadRegistryDeps)`: creates a SQLite file with a `threads(id,
  agent_nickname, agent_role, rollout_path)` table and the given rows, returning deps
  pointing at it.
- Add `pub fn nested_blocks(&self, card_id: &str) -> Vec<Value>` to `Recorder`: every
  recorded message/tool-result block whose `parentToolUseId` equals `card_id`, in emission
  order; and `pub fn top_level_blocks(&self) -> Vec<Value>` for blocks with no
  `parentToolUseId`.
- Verify: `cargo test -p mainframe-adapter-codex --test event_mapper` compiles.

**Task 12.** New `.../tests/collab_delegation.rs` — the capture replay (spec criteria 1–7).
- `renders_exactly_one_sub_agent_card`: replay the capture; assert exactly one
  `CollabAgent` `tool_use` block across all recorded messages.
- `card_title_is_the_humanized_agent_path`: that block's `input.subagent_type` is
  `"compute sum"` and is not `"Sub-agent"`.
- `card_task_line_is_non_empty`: `input.description` is non-empty (`"compute sum"`).
- `nested_transcript_carries_the_child_thinking_then_final_message`: `nested_blocks(card_id)`
  contains, in order, a `thinking` block (empty text — the capture's reasoning item has
  empty `summary` and `content`) followed by a `text` block equal to `"4. Confirmed: 2 + 2 =
  4."`.
- `card_result_is_the_child_final_message`: exactly one `tool_result` with
  `toolUseId == card_id`, `content == "4. Confirmed: 2 + 2 = 4."`, `isError == false`.
- `child_output_never_reaches_the_parent_conversation`: no block in `top_level_blocks()`
  carries the child's final message text or the child's reasoning; the parent's own two
  messages (`"I'm delegating the calculation now, then I'll wait for the result."` and
  `"The sub-agent reported: **2 + 2 = 4**."`) are present at top level.
- `sub_agent_turn_lifecycle_does_not_produce_a_parent_result`: exactly one `SessionResult`
  is recorded across the whole replay.
- `sub_agent_token_usage_does_not_reach_the_parent_result`: that result's
  `usage.input_tokens` equals the parent's own last `thread/tokenUsage/updated`
  (`last.inputTokens == 20641`), not the sub-agent's `20638`.

**Task 13.** Rewrite the collab section of `.../tests/event_mapper.rs` (spec criteria 8–15).
Delete `sub_agent_activity_started_and_interacted_are_noops` and
`sub_agent_activity_interrupted_then_wait_completed_does_not_double_close`, which encode the
behavior being replaced, and add:
- `receiver_list_route_still_produces_one_card_with_registry_title_and_state_map_result`:
  populate `state.registry_deps` via `temp_registry` with a nickname for `child_thread_1`,
  dispatch `spawnAgent` + `wait` `item/started` + `wait` `item/completed` with a populated
  `agentsStates` message; assert one card, `subagent_type` = the nickname, result =
  `"Found 3 files"` (criterion 8).
- `activity_and_receiver_list_naming_the_same_child_produce_one_card`: `started` activity
  then a `wait` naming the same `agentThreadId`; assert exactly one `CollabAgent` tool_use
  (criterion 9).
- `collab_tool_values_each_have_their_documented_effect`: table-driven over
  `spawnAgent | sendInput | resumeAgent | closeAgent | notATool`; with a card open from a
  `started` activity, each leaves exactly one card and zero `tool_result` blocks for it;
  `wait` with a matching receiver resolves it to exactly one `tool_result` (criterion 10).
- `sub_agent_activity_kinds_each_have_their_documented_effect`: `started` registers the
  child and emits the card; `interacted` on an open card emits nothing and leaves it open;
  `interrupted` emits one `tool_result` with `isError == true` and content
  `"Sub-agent interrupted"` (criterion 11).
- `collab_call_status_drives_success_only_through_its_own_enum`: a `failed` wait resolves its
  card with `isError == true`; a `completed` wait whose child had an `interrupted` activity
  still leaves the card errored and emits no second result. Assert by grep in the same test
  file that no test string literal compares a collab-call status to `"interrupted"`
  (criterion 12) — the production comparison is removed in task 15.
- `an_unnamed_completed_wait_leaves_open_cards_running`: two `started` activities open two
  cards; a `wait` `item/completed` with an empty `receiverThreadIds` and an empty `status`
  emits zero `tool_result` blocks and leaves both cards open. A `failed` wait with the same
  empty receiver list resolves both as errors (spec Edge cases §"Wait times out"; design
  decision 2).
- `unknown_thread_items_are_dropped_and_untagged_items_go_to_the_parent`: an
  `item/completed` with `threadId: "grandchild_thread"` produces no message and no
  tool_result; the same item with `threadId` absent produces one top-level message
  (criterion 13).
- `parent_turn_end_closes_a_still_open_card_with_the_childs_last_message`: `started`
  activity, a child `agentMessage`, then the parent's `turn/completed`; assert one
  `tool_result` for the card carrying that message and one `SessionResult` (criterion 14).
- `card_renders_without_a_registry_row_or_rollout_path`: no `registry_deps`; `started`
  activity plus child items; assert `subagent_type == "compute sum"` and the child's blocks
  are nested (criterion 15).

**Task 14.** New `.../tests/collab_reload.rs` — reload parity (spec criterion 16).
- A helper reads the capture, collects each `item/completed` payload's `item` grouped by
  `threadId`, and builds the two `convert_thread_items` inputs: the parent thread's items as
  `items`, and the child thread's items as `child_items_by_thread`.
- `reload_reproduces_the_live_card`: call `convert_thread_items` with an empty
  `agent_meta_by_thread`; assert one `CollabAgent` tool_use with `subagent_type ==
  "compute sum"`, non-empty `description`, the child's thinking + final-message blocks
  tagged with the card id, and a closing `tool_result` whose content is
  `"4. Confirmed: 2 + 2 = 4."` — the same four values `tests/collab_delegation.rs` asserts
  live.
- `reload_emits_the_child_message_once`: the child's final message text appears exactly once
  across all produced `ChatMessage` content blocks (criterion 17's reload half).

### Group 3 — Live path (core)

**Task 15.** Write `.../src/collab_card.rs` — the card engine (must stay under 300 lines;
split into `collab_card.rs` + a `collab_resolve.rs` sibling if it exceeds it, registering the
sibling in `lib.rs` is then the one exception to task 10's "groups 3 and 4 never touch
lib.rs").
- `pub(crate) fn on_sub_agent_activity(item: &SubAgentActivityItem, sink, state)`:
  `Started` → `open_card(item.agent_thread_id, item.id.clone(), item.agent_path.as_deref(),
  None, sink, state)`; `Interacted` → debug-log, leave the card untouched; `Interrupted` →
  `resolve_card(thread, Outcome::Error("Sub-agent interrupted"), ...)`; `Unknown` →
  `tracing::debug!` naming the kind.
- `pub(crate) fn open_card(child_thread_id, card_id, agent_path, prompt, sink, state)`:
  no-op when `state.sub_agent_cards` already has `child_thread_id` (idempotent, design
  decision 1); otherwise look the child up with `lookup_agent_metadata_with(&[child],
  state.registry_deps.as_ref())`, derive title via `collab_identity::card_title` and task
  line via `card_task_line(prompt.or(spawn_prompts.get(child)), &title)`, emit
  `history::collab_agent_tool_use(&card_id, &task_line, &task_line, &title)` through
  `sink.on_message`, and insert the `SubAgentCard { open: true, resolved: false,
  last_message: None }`.
- `pub(crate) fn record_child_message(child_thread_id: &str, text: &str, state)`: stores the
  last non-empty text as `last_message` (design decision 5).
- `pub(crate) fn resolve_card(child_thread_id, outcome, sink, state)`: no-op when the card is
  absent or already `resolved`; emits one `tool_result` on `card_id` with content per spec
  (`agentsStates` message → `last_message` → `"Sub-agent completed"`, or the error string)
  and `is_error` per the outcome; sets `resolved = true`, `open = false`, and keeps the
  thread registration (design decision 4).
- `pub(crate) fn reopen_card(child_thread_id, state)`: sets `open = true`, `resolved = false`
  for `sendInput`/`resumeAgent`.
- `pub(crate) fn on_collab_tool_call(item: &CollabAgentToolCallItem, phase: Phase, sink,
  state)`: `classify_collab_tool` drives the switch. `SpawnAgent` → `stash_spawn_prompts`
  only. `SendInput | ResumeAgent` → `reopen_card` for each named receiver, nothing else.
  `CloseAgent | Unknown` → debug-log only. `Wait` on `Phase::Completed` → branch on the
  receiver list (design decision 2):
  - **`receiverThreadIds` non-empty** — for each named receiver, resolve with
    `classify_collab_status(&item.status)`: `Failed` → error whose content is
    `agentsStates[child].message` when present else `"Sub-agent failed"`;
    `Completed | InProgress | Unknown` → success carrying `agentsStates[child].message` →
    `last_message` → `"Sub-agent completed"`.
  - **`receiverThreadIds` empty** — only `Failed` resolves, and it resolves every open card
    as an error. `Completed | InProgress | Unknown` resolves nothing and debug-logs: a
    timed-out wait returns an empty status, so a completed wait is not proof any sub-agent
    finished (spec Edge cases §"Wait times out", spec decision 5). Success on this route
    arrives from `on_sub_agent_turn_completed` or `resolve_open_cards_on_parent_turn_end`.

  `Wait` on `Phase::Started` → for each named receiver, `open_card` keyed by the wait item's
  id (legacy route); with an empty receiver list, nothing.
- `pub(crate) fn on_sub_agent_turn_completed(child_thread_id: &str, status: &str, sink,
  state)`: `"failed" | "interrupted"` → `resolve_card` as an error; anything else →
  `resolve_card` as success (spec decision 5).
- `pub(crate) fn resolve_open_cards_on_parent_turn_end(sink, state)`: resolves every card
  still `open` as success (spec Edge cases §"Parent turn ends with a card still open").
- Delete the `item.status == "interrupted"` comparison that decision 8 calls dead.
- Verify: `cargo test -p mainframe-adapter-codex --test event_mapper`.

**Task 16.** Rewire `.../src/thread_item_render.rs` to the new engine.
- Change `render_completed_item(item, thread_id: Option<&str>, sink, state)`; the caller
  passes `params.thread_id.as_deref()`.
- `ThreadItem::CollabAgentToolCall(i)` → `collab_card::on_collab_tool_call(&i, Phase::Completed, ...)`.
- `ThreadItem::SubAgentActivity(a)` → `collab_card::on_sub_agent_activity(&a, ...)`.
- `ThreadItem::AgentMessage(m)` → render as today, and when `thread_id` names a registered
  child, also `collab_card::record_child_message(...)`.
- Delete `handle_collab_completed`, `handle_sub_agent_activity`,
  `emit_collab_task_group_start`; keep `stash_spawn_prompts` (moved into `collab_card.rs`
  if that reads cleaner) and the non-collab renderers unchanged.
- Verify: file under 300 lines; `cargo test -p mainframe-adapter-codex --test event_mapper`.

**Task 17.** Add thread-scoped routing to `.../src/event_mapper.rs`.
- `enum Owner { Parent, Child(String), Unknown }` and `fn resolve_owner(thread_id:
  Option<&str>, state: &CodexSessionState) -> Owner`: `None` → `Parent`;
  `Some(t)` equal to `state.thread_id` → `Parent`; `Some(t)` in `state.sub_agent_cards` →
  `Child(t)`; otherwise `Unknown` — except when `state.thread_id` is `None` (pre-`thread/started`),
  where everything is `Parent` so nothing is lost during handshake.
- `handle_item_completed` / `handle_item_started`: `Unknown` → `tracing::debug!(module =
  "codex:events", thread_id, "codex: dropping item from an unregistered thread")` and
  return. `Child(t)` → wrap the sink in `ParentIdSink` with the card id from
  `state.sub_agent_cards[&t].card_id` (replacing today's `collab_child_threads` lookup).
- Verify: `cargo test -p mainframe-adapter-codex --test event_mapper
  unknown_thread_items_are_dropped`.

**Task 18.** Gate turn lifecycle and usage by thread in `.../src/turn_lifecycle.rs`.
- `handle_turn_started`: return without touching `current_turn_id`, `current_turn_plan` or
  `compaction_emitted` unless `resolve_owner` says `Parent`.
- `handle_token_usage`: same gate before setting `state.last_usage`.
- `handle_turn_completed`: on `Child(t)`, call
  `collab_card::on_sub_agent_turn_completed(&t, &turn.status, sink, state)` and return —
  no `sink.on_result`, no `last_usage` reset. On `Parent`, call
  `collab_card::resolve_open_cards_on_parent_turn_end(sink, state)` **before** emitting
  `sink.on_result`, then proceed as today. On `Unknown`, debug-log and return.
- These three handlers now need `&CodexSessionState` and the sink; update
  `handle_notification`'s call sites accordingly.
- Verify: `cargo test -p mainframe-adapter-codex --test collab_delegation`.

### Group 4 — Reload path (core)

Runs after group 3. The files are disjoint, but every task here verifies with `cargo test`,
which compiles the whole crate — including the live-path modules group 3 rewrites — so a
concurrent group 3 turns this group's gates red on code it does not own.

**Task 19.** Teach `.../src/history_convert.rs` the activity route.
- `convert_thread_items` keeps a local `open_cards: HashMap<String /* child thread id */,
  String /* card id */>` alongside `spawn_prompts`.
- New arm `ThreadItem::SubAgentActivity(a)`: `Started` → register `a.agent_thread_id →
  a.id` and call `history_collab::emit_sub_agent_card(...)`; `Interacted` → skip;
  `Interrupted` → emit the errored closing `tool_result` for that card and mark it resolved;
  `Unknown` → skip.
- The `ThreadItem::CollabAgentToolCall` arm switches on `classify_collab_tool`: `SpawnAgent`
  stashes prompts as today; `Wait` resolves the cards of its named receivers, and with an
  empty receiver list resolves every still-open card only when its status is `failed` —
  the same rule as the live path (design decision 2), so reload and live agree on the
  capture; `SendInput | ResumeAgent | CloseAgent | Unknown` are skipped.
- After the loop, resolve any card left open (the stored transcript's backstop, mirroring
  the live parent-turn-end rule).
- Verify: `cargo test -p mainframe-adapter-codex --test collab_reload`.

**Task 20.** Rewrite `.../src/history_collab.rs` around the child thread id.
- `pub(crate) fn emit_sub_agent_card(messages, chat_id, card_id, child_thread_id,
  agent_path, prompt, child_items_by_thread, agent_meta_by_thread)`: derives title/task via
  `collab_identity` (same chain as the live path), emits the `CollabAgent` tool_use, then
  nests the child's converted items exactly as `emit_collab_agent` does today (skipping the
  child's user-prompt echo, splitting `tool_result` blocks into their own `ChatMessage`s).
- `pub(crate) fn emit_sub_agent_result(messages, chat_id, card_id, content, is_error)`:
  the closing `tool_result` message, id `"{card_id}:result"`.
- The result content chain matches the live path: `agentsStates[child].message` → the
  child's last non-empty `agentMessage` text from `child_items_by_thread` →
  `"Sub-agent completed"`.
- Keep the legacy receiver-only path working: a `Wait` whose receivers were never registered
  by an activity item opens and immediately resolves its own card keyed by the wait item id.
- Verify: `cargo test -p mainframe-adapter-codex --test history --test collab_reload`.

**Task 21.** Collect child thread ids from both routes in `.../src/history_load.rs`.
- Walk `all_items` for `ThreadItem::SubAgentActivity` (any kind) collecting
  `agent_thread_id`, in addition to today's `wait` `receiver_thread_ids` sweep; dedupe.
- Leave the rollout-preferred / `thread/read`-fallback child fetch unchanged.
- Verify: `cargo check -p mainframe-adapter-codex`; `cargo test -p mainframe-adapter-codex
  --test collab_reload --test history --test item_types`. Scoped to this group's own test
  binaries on purpose — a bare `cargo test -p` also runs group 3's `collab_delegation` and
  the rewritten collab section of `event_mapper`, which this task does not own.

### Group 5 — Release hygiene (test)

**Task 22.** Add `.changeset/todo-247-codex-subagent-card.md` with a `patch` bump for
`'@qlan-ro/mainframe-core'`, describing the user-visible change: Codex sub-agent delegations
now render as a titled sub-agent card with the delegated task, the sub-agent's nested
transcript and its own final message, and a sub-agent's turn no longer ends the parent
session's turn or moves its context gauge.
- Verify: the file exists and matches the frontmatter shape of
  `.changeset/adapter-model-catalog-fixes.md`.

**Task 23.** Full verification pass.
- `cargo test -p mainframe-adapter-codex` (all binaries) passes.
- `cargo clippy -p mainframe-adapter-codex -- -D warnings` clean.
- `cargo fmt --check` clean from `packages/core-rs`.
- `find packages/core-rs/crates/mainframe-adapter-codex/src -name '*.rs' | xargs wc -l |
  sort -rn | head` shows every file except `session.rs` under 300; every function added or
  modified in this change is under 50 lines.
- No UI package changed: `git diff --name-only origin/main..HEAD -- packages/ui` is empty
  (spec criterion 18 — the delegation renders through the existing
  `subagent`→`task_group`→`TaskCard` pipeline, which already covers the `CollabAgent` tool
  name in `mainframe-adapter-claude/src/messages/display_helpers.rs`).

## Out of scope (spec §Not Included)

Nested delegation beyond one level (the grandchild's items land on the drop path of task
17), sub-agent controls in the UI, the proactive-delegation effort level, the turn-start
collaboration-settings payload gap, the left-panel Agents tab, a Codex-specific card
treatment, and live streaming across a daemon restart.
