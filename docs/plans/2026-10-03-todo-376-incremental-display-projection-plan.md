# Incremental display projection (todo #376)

Route: no-spec, working from the approved brief. PR #735 (`fix/long-chat-streaming`) is merged (`54a31fbb`), and #377 (revision cursors) is on main, so this branch is based on `origin/main` (`d1b5d721`) and is not stacked. The lane owns independent review. Long form: the change spans four crates and well over 150 source lines.

## Goal

A partial update costs work proportional to the active turn and the containers it touches, never to settled history. Today every revision does four O(history) passes:

1. `emit_display_for` clones the whole raw cache to append the overlay.
2. `prepare_messages_for_client` re-groups and re-converts every message.
3. The hub's `encode_revision` encodes every container.
4. `RevisionLog::record` and each connection's `SessionState::diff` compare every item and build an id set over all of them.

After this change, each layer keeps state and handles only changed containers.

- **Chat side.** A per-chat projector keeps the grouped display and its cross-message fold state. It turns raw-cache changes plus the overlay into a container delta.
- **Hub side.** The hub encodes only the changed containers. `RevisionLog` and `SessionState` apply a container delta that indexes items by container ordinal.

Full history load, transcript replacement, and resume replay may still rebuild everything. A rebuild produces a `Full` delta, which consumers handle exactly like today's full diff.

Out of scope: message caps, ACP wire semantics, the resume-cursor design, client rendering, and the REST `get_display_messages` path, which is not on the partial path and stays a full `prepare`.

## Design

### Contract: container deltas

A **container** is one top-level `DisplayMessage`. Its **ordinal** is its index in the prepared display list.

- **`DisplayDelta`** (`mainframe-display`) has these fields:
  - `full: bool`
  - `changes: Vec<(usize, DisplayMessage)>`, ascending by ordinal
  - `len: usize`, the new container count. Ordinals at or above `len` are removed.
  - `snapshot: DisplaySnapshot`, a cheap `Arc` handle to the projector's materialized container list
  - `stats: ProjectionStats`
- **`DisplaySnapshot::materialize()`** clones the full list. It is only valid during the synchronous `notify` that carries the delta, because the projector mutates the list in place on the next update. Only consumers with no baseline call it: an unseeded stream or an unseeded revision log. It sits behind its own mutex, never the `MessageCache` lock, so the hub can call it from inside `notify` while `emit_display_for` still holds the cache lock.
- **`EncodedDelta`** (`mainframe-acp`) has the same shape, carrying `Vec<EncodedItem>` per changed container.
- **Merge.** Both delta types get `merge(later)`, used to coalesce buffered deltas:
  - A later `full` delta wins.
  - Otherwise the result is the union of changes by ordinal, with later entries winning. Ordinals at or above `later.len` are dropped, and `len = later.len`.
  - A `full` base stays `full`.
  - Applying a merged delta to any state between the first delta's base and the last delta's result gives the last result, because untouched ordinals did not change in that span. This is the same "latest wins" the hub's `buffer_op` relies on today.
- **`ChatSurfaceEvent::DisplayRevision`** becomes `{ chat_id, delta: DisplayDelta, streaming }`. When `streaming` is `Some`, it always applies to ordinal `len - 1`, as the encoder's "last non-queued container" rule requires. That holds because streaming requires the last display message to be an assistant message, and assistant messages are never queued.
- **Streaming flag.** The chat side tracks the previous streaming ordinal and adds that container to `changes` whenever the streaming ordinal or kind moves. A container encoded with `streaming: true` is therefore always re-encoded once it stops streaming.

### Chat side: the projector

**Trait.** `DisplayProjector` lives in `mainframe-display` (both `mainframe-chat` and `mainframe-adapter-claude` depend on it):

```rust
fn project(&mut self, input: ProjectionInput<'_>) -> DisplayDelta
```

`ProjectionInput` carries the raw slice, the drained `RawChanges` journal, the overlay (`Option<&ChatMessage>`), and the categories.

There are two implementations:
- `FullRebuildProjector` in `mainframe-display` wraps an injected `prepare` closure and always emits `Full`. Test fakes use it, and it doubles as the reference behaviour.
- `IncrementalProjector` in `mainframe-adapter-claude` is the production projector.

**Injection.** `EventHandlerDeps::prepare_messages_for_client` is replaced by a required `display_projector() -> Box<dyn DisplayProjector>`. It is required rather than defaulted because of the bug class #273 rule. `ChatManagerDeps` gains the same method and keeps `prepare_messages_for_client` for REST. `deps_event.rs` bridges the two traits. Production (`mainframe-server/src/chat_deps.rs`) returns the incremental projector. Every fake returns `FullRebuildProjector` around its existing fake prepare.

**Journal and lifecycle (`MessageCache`).** A per-chat projection slot holds the projector plus a `RawChanges` journal. Like `tool_timings`, it is a parallel map, so every cache mutation path records into it and every removal path drops it:

| Mutation | Journal entry |
|---|---|
| `append`, `append_live` | `appended` |
| `append_nested_live(index)` | `nested(index)` |
| Changed tool timings from `ToolTimingStore::apply` (which now returns the ids it changed, with their new timing) | `timing(id, timing)` |
| `remove_by_id`, `move_to_end` | `structural(from)` |
| `set`, `set_and_snapshot`, `delete`, `release`, eviction | the slot is dropped, so the next projection rebuilds and emits `Full` |

Load, clear, recovery, and offload therefore follow the cache with no extra hooks.

`SessionSinkImpl::mutate_messages` clones the whole cache and calls `set`, which would force a rebuild on every queued-prompt dequeue. It is replaced by two targeted cache methods that record `structural(from)` with the first touched index:
- `strip_queued_and_move_to_end(chat_id, id)`
- `strip_all_queued(chat_id)`

`mutate_messages` and its free helper are then deleted.

**Emission.** `emit_display_for` locks the cache and calls `MessageCache::project_display(chat_id, overlay, categories, make_projector)`. That call drains the journal, runs the projector, merges in any pending delta (see resume below), and decides streaming. It uses the existing `streaming_leaf_kind` rule, now reading the last container from the snapshot. `emit_display_for` then notifies, with the cache lock still held as today. The overlay is passed by reference; the raw history is never cloned. `display_projection::project_display` and the old full emission path are deleted.

**Resume snapshot.** `ChatManager::get_resume_snapshot` keeps its `get_messages` load. It then reads `EventHandler::display_snapshot(chat_id)` instead of re-running `prepare`.
- Under the cache lock, that call brings the projection current with the same step `emit_display_for` uses.
- It does not notify. Any non-empty delta it produces is stored as the slot's pending delta, merged into the next emitted delta, and the materialized list is returned.
- Today's event sequence is therefore unchanged: a resume snapshot emits nothing.
- The resumed connection's seed and the live delta stream share ordinals by construction.
- The catch-up argument holds: the snapshot state lies between the first buffered delta's base and the last buffered delta's result, so applying the merged buffered delta converges.

### `IncrementalProjector` (adapter-claude)

The full pipeline is a left fold with cross-message state. The projector keeps that fold as a stack of group records with position-indexed global indexes. It can rewind to any group and refold forward, or patch one settled group in place.

**Per group record:**
- the raw range, including trailing filtered internal-user messages and duration markers
- the group kind
- the display ordinal (`None` when conversion suppressed it or a display-id duplicate dropped it)
- `next_task_id` at entry
- the duration override, if any
- an undo log of its index contributions

**Global indexes:**
- tool-use id → owning group
- display id → owning group
- task id → history of `(group, subject)`
- the latest assistant group before each group, for duration markers

The materialized container list lives in the `DisplaySnapshot`, so each container's display is stored once.

**Rules, all derived from the full pipeline's rules (see Established facts):**
- **Grouping.** Shared rule extraction: `message_grouping` exposes the per-message grouping decision (marker / attach results / merge / new group) so `group_messages` and the fold use one definition. Only the last group can absorb a merge or a tool result. A duration marker patches the nearest preceding assistant group at any distance. The patch is recorded in the undo log of the group whose raw range holds the marker, and the target's ordinal joins `changes`.
- **Tool dedupe.** A tool-use block is kept only where its id's owning group is the current group. This is the same as the full pipeline's global first-wins post-pass.
- **Display-id dedupe.** A container is dropped when its id is owned by an earlier group.
- **Subject backfill.** Uses the scope before the group: for each task id, the latest subject from a group earlier than this one, plus that group's `next_task_id` at entry. `task_subject_backfill` is generalized over a scope lookup so `backfill_task_subjects` keeps its behaviour. Task groups keep their inner scope.
- **Timing.** Read per id from the group's raw `ToolUse` blocks. The cache writes the same timing onto every occurrence of an id, so any occurrence is the first valid one. `mainframe-display` gains a per-container `apply_tool_call_timing` variant.

**Update dispatch per `project` call:**

1. **Full rebuild** when there is no prior state, the slot was dropped, or the categories differ from the stored ones. The result is `Full`.
2. **Rewind point `r`.**
   - It starts at the last group when anything was appended, or when an overlay is present now or was present last time.
   - `structural(from)` lowers it to the group containing `from - 1` (group 0 when `from == 0`). A removed or moved message can let the group before it merge with what follows, as with a queued prompt between two assistant runs.
3. **In-place patches** for groups below `r`:
   - A `timing(id)` change patches the owning group's container.
   - `nested(index)` re-converts that one group with the scope before it, reusing its duration override.

   A re-conversion falls back to a rewind from that group in three cases, each counted in `ProjectionStats` as a suffix rebuild:
   - its display presence changes;
   - its top-level task registrations change;
   - it claims a tool id already owned by a later group.
4. **Rewind and refold.**
   - Pop groups from `r` upward, undoing their contributions. That includes restoring any duration patch they made to earlier groups and marking those groups changed.
   - Refold `raw[groups[r].start..]`, then the overlay as a synthetic tail message.
   - The overlay always lands in the last group, so the next call's rewind removes it.
5. **Emit.** `changes` = every refolded ordinal (implementers may skip ones equal to their previous display) plus the patched ordinals; `len` = the new count.
6. **Stats.** Record raw messages folded, groups rebuilt, containers patched, and full or suffix rebuilds.

A partial with no raw change refolds only the last group and the overlay.

### Hub side

**`mainframe-acp`.** All of these are additive in G2. G4 removes the ones it makes dead.

- **Encoder.** `encode_container(&DisplayMessage, Option<StreamingLeafKind>)` returns that container's items (empty for a queued one). `encode_containers` returns one list per container, with streaming on the last non-queued container. `encode_revision` becomes the flattened `encode_containers`, so the full and incremental paths share one encoder.
- **`SessionState`** keeps a per-ordinal list of item ids and a `seeded` flag.
  - `seed_containers(&[Vec<EncodedItem>])`.
  - `apply(&EncodedDelta, full: impl FnOnce() -> Vec<Vec<EncodedItem>>)`.
  - `full` is used only when the state is unseeded and the delta is incremental, which is the fresh `attach` prompt path. It reproduces today's "first revision creates everything".
  - A `Full` delta behaves exactly like `diff`.
  - For an incremental delta:
    1. Collect the old ids of the affected ordinals (changed ordinals, plus those at or above `len`) and subtract the new ids.
    2. Clear the vanished non-tool items, sorted.
    3. Create or revise the changed containers' items in ordinal order.
    4. Update the index.
  - The output equals `diff` on the flattened snapshots minus the no-op entries.
  - `diff` stays for resume replay. A cumulative `items_compared()` counter feeds the gates.
- **`RevisionLog`.** Same container index, with `seed_containers` and `record_delta(&EncodedDelta, full)`.
  - An unseeded log records `full()` exactly as `record` does today.
  - Vanished tool calls still return `ToolCallVanished`.
  - It also gets an `items_compared()` counter.
- **`SessionStream`.** `seed_containers` and `on_revision_delta(&EncodedDelta, full, now, cursor)`.
- **Resume.** `ResumeReplay` gains `containers`. `revision::resolve` seeds an unseeded log with containers. The flat `items` stay for `plan` and `itemCount`.

**`mainframe-server` hub (G4).**
- **`handle_display_revision`.** Keeps the early return when nothing is listening. Otherwise it encodes only `delta.changes`, with streaming on `len - 1`. It builds one lazily evaluated full encoding, an `Arc` cell over `delta.snapshot`, that is forced at most once and only during this synchronous call. It then records with `record_delta` and fans out `StreamOp::Revision { delta: Arc<EncodedDelta>, full, cursor }`.
- **`buffer_op`.** Merges a buffered revision into the waiting one with `EncodedDelta::merge`, keeping the later cursor, instead of replacing it.
- **`reset_session`.** `ResumeSeed` carries containers, and the stream is seeded with `seed_containers`. The drain applies the merged delta, whose lazy full is never forced, because the stream is seeded by then.

## Files

- `mainframe-display`:
  - new `src/projection.rs` with submodules as needed: the trait, `ProjectionInput`, `RawChanges`, `DisplayDelta` and `merge`, `DisplaySnapshot`, `ProjectionStats`, `FullRebuildProjector`;
  - `src/tool_call_timing.rs`: the per-container variant;
  - `src/lib.rs`.
- `mainframe-adapter-claude/src/messages`:
  - new `incremental/` module (projector, fold, indexes, patches, tests) and its registration in `messages.rs`;
  - `message_grouping.rs`: the shared grouping decision;
  - `task_subject_backfill.rs`: the scope abstraction;
  - `display_pipeline.rs`: `convert_grouped_to_display` becomes `pub(crate)`. Its behaviour and its tests are unchanged.
- `mainframe-acp`:
  - `encoder.rs`;
  - new `encoder/delta.rs` (`EncodedDelta`, merge);
  - `session_state.rs` and new `session_state/containers.rs`;
  - `revision_log.rs` and new `revision_log/delta.rs`;
  - `stream.rs`;
  - `resume.rs` and `resume/revision.rs`;
  - `lib.rs` exports;
  - tests beside each.
- `mainframe-chat`:
  - `message_cache.rs`, `message_cache/{history,tool_timing}.rs`, and a new `message_cache/projection.rs`;
  - `tool_call_timing.rs` (`apply` reports changes);
  - `chat_surface.rs`;
  - `event_handler.rs` (emission, deps trait, `mutate_messages` removal), `event_handler/display_projection.rs` (only the streaming rule remains), and `event_handler/tool_timing.rs`;
  - `chat_manager/{deps,deps_event,history}.rs`;
  - every `EventHandlerDeps` and `ChatManagerDeps` fake listed in Established facts, and the tests that read `DisplayRevision.messages`.
- `mainframe-server`:
  - G3 owns `src/chat_deps.rs`, `tests/live_vs_cold_reload_golden.rs` (its deps impl), and `tests/support/facade.rs::revision_event`. G3 also makes a minimal `src/acp_ws/hub/handlers.rs` adaptation (materialize, then today's `encode_revision`) and updates the hub tests that build `DisplayRevision`, so the server builds between groups.
  - G4 owns `src/acp_ws/hub/{handlers,fanout,revisions}.rs`, `src/acp_ws/hub.rs`, `src/acp_ws/facade_conn/slots.rs`, `src/acp_ws/dispatch/resume.rs`, hub and dispatch tests, a new `tests/display_projection_scaling.rs`, and a new ignored benchmark `tests/display_projection_bench.rs`.
- Docs: `docs/ARCHITECTURE.md` (display data-flow paragraph) and `docs/guides/acp-facade.md` (the revision path, if it describes full snapshots).
- One `.changeset/*.md` (`'@qlan-ro/mainframe-app-tauri': patch`).

Every new file stays at or under 300 lines and every function at or under 50. `event_handler.rs` is already 2386 lines, so new logic goes in new modules.

## Task groups

**G1 display-projector (core).** Owns `mainframe-display` and `mainframe-adapter-claude/src/messages`. TDD inside the group:

1. **Red: the contract.**
   - `DisplayDelta::merge` laws: a later full wins; a shrink then regrow keeps the later content; the union keeps later entries.
   - `FullRebuildProjector` always emits `Full` with the materialized list.
2. **Red: equivalence suite.** After every step, `snapshot().materialize()` and the streaming input must equal `prepare_messages_for_client(raw + overlay)`. Replaying the emitted deltas onto a mirror must also reproduce the snapshot. Scenarios:
   - text and thinking partials growing, and an interrupted overlay (removed with no raw change);
   - tool calls with results;
   - a subagent task group fed by a `nested` append to a settled group;
   - task updates resolving a subject from a `TaskCreate` many turns earlier, and a `TaskCreate` with no result id (`next_task_id`);
   - a duration marker after a user-only turn, patching an earlier assistant group;
   - a timing completion on a settled tool call;
   - a queued prompt between assistant runs, then a dequeue (`structural`), merging the runs;
   - a duplicate tool id across groups (fallback, still equal);
   - a display-id duplicate;
   - a categories change (full rebuild);
   - a deterministic seeded random sequence of all of the above (a hand-rolled xorshift; the workspace has no proptest), several hundred steps.
3. **Red: projector counters.** With an identical active turn after 100, 1,000, and 10,000 settled messages, each partial's `ProjectionStats` (raw folded, groups rebuilt, containers emitted) is identical across the three sizes. A retroactive timing or nested change reports exactly the affected containers and no rebuild.
4. **Green.**
   - Extract the shared grouping decision and the backfill scope abstraction. The existing `display_pipeline`, `message_grouping`, and `task_subject_backfill` tests stay green unchanged.
   - Build the contract types, then `IncrementalProjector`.

Exit: the `mainframe-display` and `mainframe-adapter-claude` tests and clippy pass.

**G2 acp-container-diff (core).** Owns `mainframe-acp`. Additive only, so the server keeps building on the old APIs until G4.

1. **Red: encoder.** `encode_containers` flattened equals `encode_revision` on the existing encoder fixtures, including streaming on the last non-queued container and queued containers dropped.
2. **Red: `EncodedDelta::merge` laws.** The same laws as G1.
3. **Red: `SessionState::apply` equivalence.** For sequences of container snapshots (edits, appends, a shrink, removal of a tail container, a moved item id, a vanished tool call, a meta-only change, a streaming flag clearing), the updates from `apply` on deltas equal `diff` on the flattened snapshots, in order. A fresh unseeded state given an incremental delta matches `diff` on full. `items_compared` counts only the affected containers' items.
4. **Red: `RevisionLog::record_delta`.**
   - Outcomes (`Unchanged`, `Recorded`, `ToolCallVanished`), revision stamps, and tombstones match `record`.
   - The later `plan` output is the same as with `record`.
   - An unseeded log records full.
5. **Red: stream and resume.** `SessionStream::on_revision_delta` matches `on_revision` frame for frame. `ResumeReplay.containers` flattens to `items`, and `resolve` seeds the log by container.
6. **Green:** build the pieces above.

Exit: the `mainframe-acp` tests and clippy pass, and the workspace builds unchanged.

**G3 chat-projection-wiring (core), depends on G1.** Owns `mainframe-chat`, plus the G3 server files listed above.

1. **Red: journal.** Each `MessageCache` mutation records the entry in the table above, and each removal path drops the slot. `ToolTimingStore::apply` reports exactly the ids whose timing changed.
2. **Red: emission.**
   - Successive partials emit deltas whose `changes` hold only the active container.
   - Overlay removal (retry, result, exit) shrinks `len` or rewrites the last container, and the streaming container is re-sent without the flag.
   - The queued-prompt strip and move emit a structural delta, not `Full`, and no longer clone the cache.
   - These tests use a fake projector to inspect inputs, plus the full fake for shape.
3. **Red: lifecycle equivalence.** Clear (`plan_mode_actions` `set` of empty), reload (`set_and_snapshot`), recovery (`delete`), offload (`release`), and eviction each make the next emission `Full`, and its materialized list equals a fresh full projection.
4. **Red: resume snapshot.**
   - `get_resume_snapshot` returns the projector's materialized list. It equals a fresh `prepare`, mid-stream overlay included.
   - It emits no `DisplayRevision`, and the next emitted delta carries any pending change.
   - Adapt the existing `resume_snapshot.rs` and `resume_overlay.rs` assertions.
5. **Green.**
   - Swap the deps trait method and update all fakes.
   - Move recorders that read `DisplayRevision` to materializing at receipt.
   - Add production `display_projector` in `chat_deps.rs`.
   - Make the minimal `handlers.rs` adaptation and the `revision_event` helper.

Exit: the `mainframe-chat` and `mainframe-server` tests and clippy pass, including `live_vs_cold_reload_golden` and the #735 retention tests (`crossing_two_thousand_raises_no_resync`, `warm_and_cold_snapshots_agree_past_two_thousand`). A grep finds no `mutate_messages` and no `EventHandlerDeps::prepare_messages_for_client`.

**G4 hub-incremental-fanout (core), depends on G2 and G3.** Owns the G4 server files, the docs, and the changeset.

1. **Red: hub tests.**
   - An attached, seeded connection receives exactly the frames the old full path produced, for the same event sequence (a full-path reference, `encode_revision` plus `diff`, driven side by side).
   - A fresh `attach` stream's first incremental revision creates all items.
   - A revision log created at `begin_resume` and still unseeded records full.
   - Several revisions buffered during `AwaitingSeed` merge, and the catch-up converges to the latest state with the later cursor.
   - A reconnect after an interrupted overlay converges to a fresh full projection.
   - The existing `awaiting_seed`, `resume_race`, revision-cursor, gate, and `replay_complete` tests stay green.
2. **Red: scaling gate (`tests/display_projection_scaling.rs`).** Drive the real chat projection (incremental projector, `MessageCache::project_display`) into the hub path with one seeded connection and a revision log. Use the same active turn and identical partial sequence after 100, 1,000, and 10,000 settled messages. Per partial, these must be identical across the three sizes:
   - raw messages folded;
   - containers encoded;
   - `SessionState` and `RevisionLog` `items_compared`.

   A retroactive tool-result timing and a task update in the active turn touch only the affected containers.
3. **Green:**
   - `handle_display_revision` (encode changes, lazy full, `record_delta`);
   - `StreamOp::Revision` with delta and full;
   - `buffer_op` merge;
   - `reset_session` and `ResumeSeed` containers;
   - removal of the old `on_revision(items)` and `seed(items)` stream APIs once nothing calls them.
4. **Benchmark (`tests/display_projection_bench.rs`, `#[ignore]`).**
   - Compare old (full `prepare`, `encode_revision`, `diff`, `record`) and new per partial at 100, 1,000, and 10,000 settled messages, with identical input.
   - Report median and p95 latency, and allocations per partial (count and bytes, from a counting global allocator in that test binary only).
   - Run it in release, and put the table plus conditions (machine, OS, rustc, profile, iteration counts) in the PR description.
5. **Docs and changeset.**

Exit:
- The `mainframe-acp`, `mainframe-chat`, and `mainframe-server` tests and clippy pass, and the workspace builds.
- The scaling gate passes.
- The benchmark table is recorded.
- New files are at most 300 lines and new functions at most 50.

## Risks

- **Projector drift from `prepare`.** The orchestration is new code over shared leaf rules. Mitigations:
  - the equivalence suite, including the seeded random sequence;
  - `FullRebuildProjector` as a ready fallback;
  - fallbacks for anomalies (duplicate tool ids, top-level task changes in a settled group, display-presence flips), which rebuild from the affected group and are counted.

  If a scenario cannot be made exact, it falls back to a counted suffix or full rebuild rather than diverging.
- **Snapshot handle lifetime.** `materialize()` reflects the projector's current state. It is correct only inside the synchronous `notify`. Test recorders must materialize at receipt, and the hub must never force a lazy full from a buffered op (drained ops always hit a seeded stream). The doc comment states the invariant, and a hub test covers it.
- **Lock order.** It is cache lock, then snapshot mutex. The hub takes only the snapshot mutex during `notify`. Nothing takes the cache lock while holding the snapshot mutex.
- **Memory.** Each loaded chat now keeps its display list and fold indexes alongside the raw cache, roughly doubling its resident size. This is bounded by cache retention: the slot is dropped on offload, release, and eviction. Per connection, `SessionState` adds an id list per container.
- **Pending deltas from resume snapshots.** A snapshot that brings the projection current without emitting leaves other connections behind until the next emission. This matches today, where a snapshot never emitted. The resumed connection's catch-up is idempotent.
- **Append-time timing scan.** `ToolTimingStore::apply` still walks the raw cache on each completed-message append. That predates this change and is not on the partial path. It now reports changes but stays O(raw). Making it id-indexed is separate work.

## Established facts

- `emit_display_for` holds the `MessageCache` guard across `chat_surface::notify`, so emissions are serialized and the hub handles each synchronously. Receipt: `mainframe-chat/src/event_handler.rs::emit_display_for`, and `mainframe-server/src/acp_ws/hub/handlers.rs` (`impl ChatSurface for FacadeHub` → `handle_display_revision`).
- `emit_display_for` is the only production constructor of `ChatSurfaceEvent::DisplayRevision`. Receipt: grep over `crates/`, where the other hits are tests and `hub/handlers.rs` matching.
- The encoder's `Accum` state is created per `encode_content` call, and its positions are relative to the tail of `out`. Encoding containers separately and concatenating is therefore identical to `encode_messages`. Streaming marks only the last non-queued container. Receipt: `mainframe-acp/src/encoder.rs::encode_messages`, `encoder/content.rs::encode_content`, `encoder/accum.rs::Accum::{claim,open,finish}`.
- In `group_messages`:
  - a tool result attaches only to `result.last_mut()` when that group is assistant or tool_use;
  - an assistant or tool_use message merges only into the last group;
  - a `turnDurationMs` system marker attaches to the nearest preceding assistant group at any distance, and creates no group;
  - tool-use dedupe is a global first-wins post-pass over groups in order.

  Receipt: `mainframe-adapter-claude/src/messages/message_grouping.rs::group_messages`.
- In `prepare_messages_for_client`:
  - the internal-user filter is per message;
  - display-id dedupe is global first-wins over converted groups;
  - `backfill_task_subjects` is a forward fold with `subjects` and `next_id`, and task groups use a fresh inner scope;
  - `apply_tool_call_timing` overwrites each node's timing from the first valid raw `ToolUse` timing for its id.

  Receipt: `messages/display_pipeline.rs::prepare_messages_for_client`, `messages/task_subject_backfill.rs::{backfill_task_subjects,backfill_blocks,backfill_item}`, `mainframe-display/src/tool_call_timing.rs::apply_tool_call_timing`.
- `convert_assistant_content` and `apply_tool_grouping` depend only on the group being converted. Receipt: `messages/display_helpers.rs::{convert_assistant_content,apply_tool_grouping}`.
- `ToolTimingStore::apply` writes the store's single per-id timing onto every `ToolUse` occurrence. Receipt: `mainframe-chat/src/tool_call_timing.rs::ToolTimingStore::apply`.
- `MessageCache.cache` is private. Every mutation goes through `append`, `append_live`, `append_nested_live` (which extends an earlier assistant message found by `rposition` of the parent tool use), `finish_tool_calls`, `set`, `set_and_snapshot`, `delete`, `release`, eviction, `remove_by_id`, or `move_to_end`. Receipt: `mainframe-chat/src/message_cache.rs`, `message_cache/{history,tool_timing}.rs`.
- `SessionSinkImpl::mutate_messages` clones the chat's whole vector and calls `set`. Its callers strip queued metadata and move one message to the end, or strip all queued metadata. Receipt: `mainframe-chat/src/event_handler.rs::{SessionSinkImpl::mutate_messages,strip_queued_and_move}`.
- `SessionState::diff` and `RevisionLog::record` each build an id set over the whole snapshot and scan every known item per revision. Receipt: `mainframe-acp/src/session_state.rs::SessionState::{diff,clear_vanished}`, `mainframe-acp/src/revision_log.rs::RevisionLog::record`.
- `FacadeHub::attach` installs a fresh, unseeded `Live` stream, so its next revision creates every item. `is_attached` counts `AwaitingSeed` slots. Receipt: `mainframe-server/src/acp_ws/hub.rs::FacadeHub::attach`, `facade_conn.rs::FacadeConnection::is_attached`.
- A buffered revision replaces the waiting one, and the drain runs buffered ops on the freshly seeded stream after the replay. Receipt: `hub/fanout.rs::{buffer_op,drain_into}`, `hub.rs::FacadeHub::reset_session`.
- The resume snapshot re-runs the full projection through `project_display`. Receipt: `mainframe-chat/src/chat_manager/history.rs::get_resume_snapshot`.
- The deps-trait implementations to update:
  - `EventHandlerDeps` is implemented by `chat_manager/deps_event.rs::EhDeps`, by fakes in `event_handler.rs` (two), `event_handler/{pr_detection_wiring,attention,permission_cancel,worktree_trigger,chat_surface,stable_id_characterization,partial_overlay}_tests.rs`, and by `mainframe-server/tests/live_vs_cold_reload_golden.rs::NoopDeps`.
  - `ChatManagerDeps` is implemented by `chat_manager/tests.rs::StoreDeps` and `mainframe-server/src/chat_deps.rs::DaemonChatDeps`.

  Receipt: grep for `impl .*Deps for`.
- `ToolCategories` derives `PartialEq`, so the projector can cheaply detect a categories change. Receipt: `mainframe-types/src/display.rs::ToolCategories`.
- `mainframe-acp` depends only on `mainframe-types`, `serde`, and `serde_json`. `mainframe-chat` and `mainframe-adapter-claude` both depend on `mainframe-display`. Receipt: each crate's `Cargo.toml`.
- The workspace has no `criterion` or `proptest` in `Cargo.lock`. The `unsafe` ban is a crate-root attribute in each lib (`#![forbid(unsafe_code)]` in `mainframe-server/src/lib.rs`), so a counting allocator in an integration-test binary is not affected by it. Receipt: `packages/core-rs/Cargo.lock`, `crates/mainframe-server/src/lib.rs`.
- Daemon-only changesets bump `'@qlan-ro/mainframe-app-tauri': patch`. Receipt: `.changeset/unspawned-cell-offload.md`.
- Files are capped at 300 lines and functions at 50. Receipt: `CLAUDE.md` § Code Rules.
