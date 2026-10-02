# Resume snapshot includes the in-flight partial overlay (todo #382)

Short-form plan: the expected source diff is under ~150 lines, excluding tests. Route: no-spec, working from the approved brief. PR #735 (`fix/long-chat-streaming`) is merged, and this branch is based on `origin/main` (8145d305), so this is not stacked. The lane owns independent review.

## Goal

A `session/resume` snapshot taken mid-stream must match a live display revision taken at the same moment. It includes the same messages, the in-flight partial overlay (once, under its API message id and frozen `started_at`), and the same `StreamingLeafKind`. Only the open segment carries `ItemMeta.streaming`. Snapshots without an overlay stay byte-identical to today's. The overlay stays transient and never enters `MessageCache`.

## Files

- `packages/core-rs/crates/mainframe-chat/src/event_handler.rs` and a new `event_handler/display_projection.rs`: move the overlay-append and streaming determination out of `emit_display_for` (`streaming_leaf_kind`, `overlay_leaf_kind`, `display_leaf_kind`) into one shared pure projection. Its inputs are raw messages, an optional overlay message and a prepare step. Its output is `(Vec<DisplayMessage>, Option<StreamingLeafKind>)`. `emit_display_for` calls it unchanged in behavior. `EventHandler` gains a small accessor that exposes the chat's current overlay message (`PartialOverlays::message_for`) to `ChatManager`. Moving the helpers out also shrinks the oversized `event_handler.rs`.
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/history.rs`: `get_resume_snapshot` returns a named struct with `messages`, `streaming` and `pending`. It projects the raw history from its single `get_messages` call through the shared projection, using the overlay read after that call. It keeps one transcript load, the `reconcile_transcript` side effects and the `pending_permission_as_known` read. `get_display_messages` (HTTP history) stays overlay-free.
- `packages/core-rs/crates/mainframe-acp/src/resume.rs`: `ResumePort::resume_snapshot` returns a mainframe-acp `ResumeSnapshot` struct with the same three fields. `dispatch_resume` encodes with `encoder::encode_revision(&messages, streaming)` instead of `encode`. Update the `encode_revision` doc comment in `encoder.rs` that says resume has no overlay.
- `packages/core-rs/crates/mainframe-server/src/acp_ws/ports.rs`: `ManagerPorts` maps the chat struct to the acp struct. Without a manager, it returns an empty snapshot with no streaming.
- Test fakes for the new port shape: `mainframe-acp/src/resume/tests.rs::FakePort` and `mainframe-server/src/acp_ws/dispatch/resume/tests.rs` (`PanickingPort`, `EmptyPort`). Also update existing `get_resume_snapshot` call sites in `mainframe-chat/src/chat_manager/tests/{resume_snapshot,history_eviction}.rs`.
- New tests: `mainframe-chat/src/chat_manager/tests/resume_snapshot.rs` (or a sibling file if it would pass 300 lines), `mainframe-acp/src/resume/tests.rs`, and `packages/ui/src/features/chat/parts/__tests__/streaming-smooth.test.tsx`.
- One `.changeset/*.md` (patch) describing the user-visible fix.

## TDD sequence (one group)

1. **Red, chat parity.** Build a `ChatManager` with a recording `ChatSurface`. Seed the cache, then drive `event_handler.build_sink("c1", Some(session))` through `on_message_partial`. Assert that `get_resume_snapshot` returns the live `DisplayRevision`'s exact `messages` and `streaming`, for both a text and a thinking partial. Also cover the following cases:
   - A later partial for the same message keeps the overlay's timestamp, matching live.
   - After `on_message` finalizes the same API id, the snapshot has the final text once and `streaming == None`, with no duplicate segment.
   - After retry, `on_result`, `on_exit` of the owning session, and `clear_display_state`, the snapshot has no overlay.
   - A superseded session's `on_exit` does not remove the newer session's overlay from the snapshot.
   - With no overlay, the snapshot equals today's output.
2. **Red, acp replay.** In `resume/tests.rs`, a `FakePort` returns a mid-stream snapshot with `streaming: Some(Text)`. The full replay's last agent message item carries `streaming: true`, and earlier items do not. With `Some(Thinking)`, only the open thought item is marked. With `None`, the updates equal the previous `encode`-based output. `itemCount` and pending-permission redelivery stay unchanged.
3. **Green.** Make the changes above. The shared projection gives live and resume behavior from one code path.
4. **UI guard.** No production UI change is expected. Add a `streaming-smooth.test.tsx` case. A part mounted live as streaming and fully revealed is then re-rendered as a replay-origin item with `streaming: true` and the same text, then the same text plus a suffix. The shown text never becomes shorter, so previously received text is not retyped. If this fails, stop and report. Smoothing changes are out of scope.

## Risks

- **Read order.** Read the overlay after the raw history read. `on_message` removes the overlay before it appends the final message, so this order cannot yield both the final message and the overlay. In the inverse window, the snapshot briefly lacks the text. The append's own display revision is then buffered from `begin_resume`, and the catch-up restores it. Do not instead re-read the cache under its lock after `get_messages`. A concurrent offload can clear the cache and publish an empty snapshot.
- **Cold mount.** A client mounting a streaming part from a fresh replay, such as opening the chat mid-turn, now reveals the open segment from empty. This matches the existing live-mount contract (`streaming-smooth.test.tsx` case 1) and is bounded by useSmooth's drain. Historical segments stay complete because only the open segment is marked.
- **Size limits.** `event_handler.rs` is already oversized (2436 lines). Add no net lines there. New functions stay at or under 50 lines, and new files stay at or under 300 lines.

## Established facts

- Live projection appends the overlay as a synthetic tail and computes streaming from the overlay leaf and the prepared last leaf. Receipt: `mainframe-chat/src/event_handler.rs::emit_display_for`, `streaming_leaf_kind`.
- The overlay is keyed by `(chat_id, session_id)`, keeps `started_at` across partials for the same message id, and is read through `message_for` (first match per chat). Receipt: `mainframe-chat/src/event_handler/partial_overlay.rs::PartialOverlays::{insert,message_for,take,remove_chat}`.
- Cleanup sites: `on_message` (take, then append), the retry handler, `on_result`, `on_exit` (own session only), and `EventHandler::clear_display_state`. Receipt: `mainframe-chat/src/event_handler.rs` (`take_partial_overlay` call sites).
- A finalized block lands under the same item id the overlay used (the API message id), so the display converges in place. Receipt: `event_handler.rs::SessionSinkImpl::on_message` comment.
- Resume currently uses overlay-free history and plain `encode`. Receipts: `mainframe-chat/src/chat_manager/history.rs::get_resume_snapshot` → `get_display_messages`, and `mainframe-acp/src/resume.rs::dispatch_resume`.
- `encode_revision(messages, None)` equals `encode`. It marks only the last non-queued container's open segment. Receipt: `mainframe-acp/src/encoder.rs::encode_messages`, test `encoder/tests/streaming_tests.rs::encode_revision_without_streaming_equals_encode`.
- A dropped `streaming` flag diffs as a meta patch on the same item. Receipt: `mainframe-acp/src/session_state/tests.rs::a_streaming_drop_is_a_meta_patch_in_the_same_diff`.
- Seeding: `reset_session` seeds a fresh `SessionStream` with the snapshot items, then drains revisions buffered since `begin_resume` as catch-up deltas against those items. Receipt: `mainframe-server/src/acp_ws/hub.rs::FacadeHub::reset_session`, `dispatch/resume.rs::start_resume`.
- The UI already marks a replay-origin item with `streaming: true` as running ("streaming wins"). Receipt: `packages/ui/src/features/chat/view-model/convert-acp-item.ts::partStatus`, test `convert-acp-item-streaming.test.ts`.
- `@assistant-ui/react@0.15.13` `useSmooth` starts from `""` when a part mounts running, or when its part identity changes or the text stops extending the displayed prefix. Otherwise it continues from the displayed text. Receipt: `node_modules/.pnpm/@assistant-ui+react@0.15.13*/node_modules/@assistant-ui/react/dist/utils/smooth/useSmooth.js::useSmooth`.
- Tests can reach the handler as `mgr.event_handler.build_sink(...)` and the cache as `mgr.messages`. Receipt: `mainframe-chat/src/chat_manager/tests/resume_snapshot.rs::tool_timing_resume_reads_preserve_running_completed_and_legacy_calls`.
- `mainframe-acp` depends only on `mainframe-types`, not on `mainframe-chat`. Hence there is one struct per side and `ports.rs` maps between them. Receipt: `mainframe-acp/Cargo.toml`.

## Exit gates

- The new chat parity, acp replay and UI guard tests fail before the change and pass after it. Existing `resume_snapshot`, `history_eviction`, `partial_overlay_tests`, `streaming_tests`, `resume/tests` and server `dispatch/resume/tests` pass.
- The affected Rust crates (`mainframe-chat`, `mainframe-acp`, `mainframe-server`) build, test and pass clippy with no new warnings. UI typecheck, lint and the touched vitest files pass.
- A grep finds no `encoder::encode(` left on the resume path. No settled-cache write takes the overlay.
- A patch changeset is present. New and touched functions and files respect the 300/50 limits.
