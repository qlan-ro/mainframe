# Codex: stream agent message deltas through the partial overlay (todo #378)

Short-form plan. The expected source diff is under ~150 lines, excluding tests and the fixture. Route: no-spec, working from the approved brief. PR #735 (streaming metadata) and #382 (resume snapshot carries the overlay) are both merged, and this branch is based on `origin/main` (88d633cb), so nothing is stacked. The lane owns independent review.

## Goal

Top-level Codex `item/agentMessage/delta` text appears in the transcript as it streams, with `ItemMeta.streaming` on the open segment. `item/completed` remains authoritative. It lands under the same id, so the display converges in place and the final text appears once. Completion without deltas behaves as it does today. Deltas from child threads, unknown threads, stale turns or malformed payloads never reach the parent overlay. Partial state is released on item completion, turn completion (including `failed` and `interrupted`), kill and process exit. Scope is limited to top-level agent text. Child threads keep completed-only rendering, and the other delta families stay ignored.

## Files

- New `packages/core-rs/crates/mainframe-adapter-codex/src/agent_message_partial.rs`:
  - `AgentMessageDeltaParams { thread_id, turn_id, item_id, delta }`, all required `String`s with camelCase serde. A missing field is a parse failure, so the delta is dropped. The struct lives here, not in the oversized `types.rs`.
  - `AgentMessagePartialState`, a `pub` field on `CodexSessionState`. It holds the in-flight `(thread_id, turn_id, item_id, text)`, `last_emit_ms`, a pub `emit_interval_ms` (default 50, the same floor as Claude's `PARTIAL_EMIT_INTERVAL_MS`; tests set 0) and the set of agent-message ids completed in the current turn. It provides `clear()` and an item-completion method.
  - `handle_agent_message_delta(params: &Value, sink, state)`. It drops the delta when any of these hold: the payload is malformed, `item_id` is empty, `resolve_owner` is not `Owner::Parent`, `state.current_turn_id != Some(turn_id)`, or the item already completed this turn. A new `(thread, turn, item)` key restarts accumulation. Otherwise it appends the delta. When the text is non-empty and the gate is open, it calls `sink.on_message_partial(&item_id, vec![history::text_block(&text)])`. Keep each function at or under 50 lines.
- `src/event_mapper.rs` (296 lines, so the change must add no net lines): replace the `"item/agentMessage/delta"` entry in the ignore arm with a one-line arm that delegates to the new handler. Update the `PORT STATUS` notes only if that adds no lines.
- `src/lib.rs`: declare the module.
- `src/session_state.rs`: add the field. Add `CodexSessionState::clear_transient()`, which clears `command_state` and the partial state.
- `src/session.rs` (already oversized, so add no net lines): in `kill` and the `on_exit` handler, replace the existing `.command_state.clear()` with `.clear_transient()`. Leave `interrupt` alone. Its `turn/completed {status: interrupted}` clears the state, and clearing early would let a late delta from the same turn restart the text mid-message.
- `src/turn_lifecycle.rs`: clear the partial state in `handle_turn_started` and `handle_turn_completed`, on the parent branch only. A child's turn never touches the parent's partial state.
- `src/thread_item_render.rs::render_agent_message`: before `on_message`, mark the item completed. If it is the in-flight item and the thread matches (or the completion carries no thread), drop the in-flight text.
- Tests:
  - `tests/common/mod.rs::RecordingSink` records `on_message_partial(id, content)`.
  - New `tests/agent_message_delta.rs`.
  - New fixture `tests/fixtures/agent-message-delta-0.155.1.jsonl`. A trimmed live capture already exists at `<repo>/.worktrees/.lane-state/todo-378-codex-agent-message-deltas/agent-message-delta-capture-0.155.1.jsonl`; copy it. If it is missing, re-capture it with Technique 1 of `.agents/skills/codex-protocol-debugger/SKILL.md`.
  - New runtime test `packages/core-rs/crates/mainframe-server/tests/codex_agent_message_streaming.rs`.
- `docs/research/adapters/codex/CONSUMED-SURFACE.md`: move `item/agentMessage/delta` from CODEX-EVT-02 to the handled set. Add a row for the delta shape, the item-id identity and the ordering facts below, with test receipts.
- One patch `.changeset/*.md` for the user-visible change.

## TDD sequence (one group)

1. **Red, adapter.** In `tests/agent_message_delta.rs`, set the partial interval to 0, then cover these cases:
   - Replaying the fixture records partials with growing accumulated text, all under the agent message's item id. Their last text equals the completed text. The single `on_message` that follows carries `vendor_id` equal to that item id.
   - A completion with no deltas records zero partials and the same `on_message` as today.
   - These deltas record nothing: a child-thread delta (registered in `sub_agent_cards`, with the child card's completed rendering unchanged), an unknown-thread delta, a delta for a previous turn after `turn/started` of a new one, a delta after `turn/completed`, a delta for an already completed item, and malformed payloads (missing `itemId`, non-string `delta`, empty `itemId`).
   - A second item in the same turn starts from empty text.
   - With a large interval, only the first delta of a burst emits.
   - `clear_transient` and a `turn/completed` with status `interrupted` or `failed` leave no in-flight state. A later delta for that turn records nothing.
2. **Red, runtime (end to end).** In the `mainframe-server` test, build a real `EventHandler` with no-op deps (the same shape as `live_vs_cold_reload_golden.rs::NoopDeps`, using the real `prepare_messages_for_client`) and a recording `ChatSurface`. Replay the fixture through `mainframe_adapter_codex::event_mapper::handle_notification` into `build_sink`. Encode each `DisplayRevision` with `encode_revision(messages, streaming)`. Each delta revision has one agent message item, under the item id, with growing text and `_meta` `streaming: true`. The revision after `item/completed` has the same id, the final text once, and no streaming flag. The revision after `turn/completed` has no overlay.
3. **Green.** Make the changes above until both suites pass. The existing `tests/event_mapper.rs`, `collab_*` and `live_vs_history_id_parity` suites must also pass.
4. **Live QA.** Run a Codex chat in the dev app. Text grows visibly before completion and settles without duplication. Reopening the chat (restored history) shows the same message under the same id with no streaming. Mid-stream reconnect relies on #382's merged snapshot path; check it, but do not claim it as this ticket's fix.

## Risks

- **A child item clears the parent overlay.** The runtime's `on_message` takes the session's overlay on any completed message, including a child item through `ParentIdSink`. If a child item completes while the parent is streaming, the parent's text disappears until its next delta. That delta re-sends the accumulated text, so nothing is lost. Concurrent child streaming is explicitly out of scope.
- **Unknown ids degrade safely.** If a future CLI uses different ids for deltas and completion, `on_message` still drops the overlay before appending. The result is an id switch (a reset frame), not duplicated text.
- **Size limits.** `event_mapper.rs` is at 296 lines and `session.rs` is already over the limit, so both edits must add no net lines. New functions stay at or under 50 lines, and new files stay at or under 300 lines.

## Established facts

- Delta payload: `AgentMessageDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string }`, all required. Receipt: `codex app-server generate-ts` on codex-cli 0.155.1, `AgentMessageDeltaNotification.ts`, and `ServerNotification.ts` (`"item/agentMessage/delta"`).
- Live ordering on 0.155.1 (ephemeral thread, 2026-10-03): `turn/started` → `item/started` (agentMessage, `text: ""`) → N × `item/agentMessage/delta` → `item/completed` → `turn/completed`. Every delta's `itemId` equals the completed item's `id` (`msg_…`), and concatenating the deltas equals `item.text` exactly. Receipt: the trimmed capture `.lane-state/todo-378-codex-agent-message-deltas/agent-message-delta-capture-0.155.1.jsonl`, which becomes the fixture.
- The completed message's transcript id is the item id. `render_agent_message` sends `vendor_metadata(id)`, and `MessageCache::create_transient_message_with_vendor_id` uses `vendor_id` as the `ChatMessage.id`. Receipts: `mainframe-adapter-codex/src/thread_item_render.rs::render_agent_message`, `src/history.rs::vendor_metadata`, `mainframe-chat/src/message_cache.rs::create_transient_message_with_vendor_id`.
- The runtime keys the overlay by `(chat, session)` and keeps `started_at` for the same message id. `on_message` takes the overlay before appending. `on_result`, `on_exit` and retry drop it and re-emit. Receipts: `mainframe-chat/src/event_handler/partial_overlay.rs::PartialOverlays`, `event_handler.rs::SessionSinkImpl::{on_message, on_result, on_exit, on_message_partial}`.
- Display projection marks streaming only while an overlay is present, and `encode_revision` writes `ItemMeta.streaming` on the open segment. Receipts: `mainframe-chat/src/event_handler/display_projection.rs::project_display`, `mainframe-acp/src/encoder.rs::encode_revision`, `encoder/tests/streaming_tests.rs::item_streaming`.
- Codex chats use the shared display pipeline. Receipt: `mainframe-server/src/chat_deps.rs` (`prepare_messages_for_client` from `mainframe_adapter_claude::messages::display_pipeline`).
- Claude's adapter-side 50 ms emission floor is per-session state, and completion is ungated. Receipt: `mainframe-adapter-claude/src/partial_stream.rs::{PARTIAL_EMIT_INTERVAL_MS, emit_due, accumulate_delta}`.
- Owner resolution: `Parent` covers our thread, untagged notifications and anything before `thread/started`. `Child` requires a registered card. Anything else is `Unknown`. Receipt: `mainframe-adapter-codex/src/event_mapper.rs::resolve_owner`.
- `current_turn_id` is set only by a parent `turn/started` and cleared by a parent `turn/completed`. Receipt: `src/turn_lifecycle.rs::{handle_turn_started, handle_turn_completed}`.
- `ParentIdSink` does not override `on_message_partial` (default no-op), and `PrDetectionSink` forwards it. Receipts: `mainframe-adapter-codex/src/parent_id_sink.rs`, `mainframe-adapter-api/src/pr_detection/sink.rs::on_message_partial`.
- `mainframe-server` integration tests can depend on both `mainframe-adapter-codex` and `mainframe-chat` and build a real `EventHandler`. Receipts: `mainframe-server/Cargo.toml`, `tests/live_vs_cold_reload_golden.rs::run_live_pipeline`.

## Exit gates

- The new adapter and runtime tests fail before the change and pass after it. The existing Codex adapter and `mainframe-chat` partial-overlay suites pass.
- `mainframe-adapter-codex` and `mainframe-server` build, test and pass clippy with no new warnings. Formatting is clean.
- A patch changeset is present, and CONSUMED-SURFACE is updated. `event_mapper.rs` stays at or under 300 lines, `session.rs` does not grow, and new and touched functions stay at or under 50 lines.
- Live Codex QA is recorded: streamed growth, a single final text, and restored history without streaming.
