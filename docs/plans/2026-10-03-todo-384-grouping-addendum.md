# #384 Codex-style activity and turn grouping — implementation addendum

Approved user-directed extension to [the canonical #384 plan](2026-10-02-todo-384-running-fallback-plan.md). G1–G3 are complete. Integration commit `98466ca8e27285bd2bdabb52c2e7acf18287eabc` includes main `e6af2bfa`, merged PR #746 and PR #745. G4 completed at `0eee3f88`. Integration `8d7c1dd8f60b6dedaecba7c5402204748d326eb6` adopted PR #750 head `f4c5d2855b64529426b1a41b00231b99e4a58d01`, including #378 delta streaming. Execute only G5–G8 below; retain G4 as the completed contract. No separate #371 revision or #374 lane.

Source direction: `docs/research/2026-10-03-codex-activity-grouping.md`, installed Codex app `26.924.22138`; its accepted grouping research is not repeated here. The user superseded same-kind-only rows, always-visible routine steps, and never-collapse-before-turn-completion. Verbose stays unchanged. Compact gains mixed activity disclosures plus a separate turn-work disclosure.

## Additional established facts

- PR #746 `view-model/compact/build-compact-rows.ts::buildCompactRows` merges successful same-kind tools only; `messages/compact/CompactParts.tsx::compactGroupBy` separates reasoning and tools. Both operate inside one assistant message.
- `messages/compact/CompactToolDetails.tsx::CompactToolDetails` uses native `MessagePrimitive.PartByIndex`; `CompactToolOverride` preserves native cards and nested transcripts. Keep these details, permissions and actions rather than introducing a second card renderer.
- `messages/compact/disclosure-store.ts::disclosureStore` stores booleans by root thread, ancestor chain, message and tool identity; absent and explicitly closed are not distinguished. Outer automatic defaults need an explicit unset state.
- `thread/ChatThreadViewport.tsx::ChatThreadViewport` renders the shared list for main/side chat; `tools/cards/SubagentTranscript.tsx::SubagentTranscript` renders a separate readonly native list. Installed `@assistant-ui/core/src/react/primitives/thread/ThreadMessages.tsx::ThreadPrimitiveUnstable_MessageById` supports stable-ID scoped custom lists; `MessageByIndex` also exists. Use the native scope instead of fabricating message stores.
- At integration `8d7c1dd8`, `mainframe-adapter-codex/src/agent_message_partial.rs::AgentMessagePartialState` owns cumulative thread/turn/item text, a 50 ms emission throttle and completed-item guards. `event_mapper.rs::handle_notification` routes agent deltas to `handle_agent_message_delta`, which rejects child/unknown ownership and stale turns. `thread_item_render.rs::render_agent_message` marks completion before delivering the final item. `session_state.rs::CodexSessionState::clear_transient` and `turn_lifecycle.rs` already perform lifecycle cleanup. Reuse these implementations and their adapter/server regressions.
- `mainframe-adapter-codex/src/thread_item_variants.rs::AgentMessageItem` parses optional phase, but `event_mapper.rs::handle_item_started` still ignores agent starts and `thread_item_render.rs::render_agent_message` drops phase. `history_load.rs::load_history_inner` flattens `ThreadReadTurn` items, losing turn identity; `history_convert.rs::convert_thread_items` drops agent phase too. These presentation gaps remain G5 work.
- A bounded schema generation from installed `codex-cli 0.155.1` succeeded. `/tmp/codex-384-grouping-schema/v2/AgentMessageDeltaNotification.ts` defines `threadId`, `turnId`, `itemId`, `delta`. `ThreadItem.ts` agent messages have nullable `phase`, `delivery`, `questions`; root `MessagePhase.ts` is `commentary | final_answer` and explicitly warns that providers may omit it. `AgentMessageDelivery.ts` defines `async`. `Turn.ts` supplies optional/null `startedAt`/`completedAt` in seconds and `durationMs`. This is schema evidence, not a real streamed-run capture.
- Completed G4 `mainframe-adapter-api/src/adapter/session_sink.rs::SessionSink` adds contextual message/partial callbacks with backward-compatible defaults and `on_presentation_update`. `mainframe-chat/src/event_handler/presentation.rs` applies exact-membership updates and monotonic invalidation. Its parent-owned overlay accepts contextual parent text while child completed messages preserve that overlay. The final callback/schema contract is recorded in external `steps/G4.json`.
- `mainframe-adapter-claude/src/messages/message_grouping.rs::group_messages` is the actual shared display grouping used by `mainframe-server/src/chat_deps.rs::prepare_messages_for_client`; the similarly named mainframe-display file is a placeholder. It merges consecutive assistant/tool-use content while retaining the first message metadata. Preserve this container behavior: source boundaries must survive additively alongside its merged content, not by splitting containers.
- `mainframe-acp/src/encoder/content.rs::push_text` coalesces adjacent text leaves; `encoder/accum.rs::Accum::build` emits the same item/segment IDs and blocks. Therefore a single encoded text block can contain both commentary and final text. A container-level phase cannot identify that boundary.
- `mainframe-types/src/acp/extensions.rs::ItemMeta` supports additive item metadata. `convert-acp-item.ts::messageParts` and `textOf` map encoded blocks to native parts; `MainframeMessageMeta` currently lacks source membership. Preserve that part layout and add a sidecar map of source spans, including their original native part indices.
- Installed `@assistant-ui/react@0.15.13` re-exports `@assistant-ui/core@0.3.12`'s `src/react/providers/TextMessagePartProvider.tsx::TextMessagePartProvider` with `text` and `isRunning`; it extends the existing native scope and overrides only the text part. Compact text fragments can therefore retain the original message/action scope without altering the repository or Verbose text parts.
- Claude `partial_stream.rs::handle_stream_event` retains `api_message_id` from `message_start` through `message_delta`, but currently ignores `delta.stop_reason`. `assistant_event.rs::handle_assistant_event` maps the first block to API message ID and later blocks to transcript UUIDs. Existing `__fixtures__/queued-command-attachment.jsonl` contains explicit assistant `message.stop_reason: end_turn` with `message.id`; `docs/research/adapters/claude/PROTOCOL_REVERSED.md` documents both stop reason and result `duration_ms`.
- Claude `events.rs::handle_result_event` drops result text apart from slash-command errors and has no final-item ID. `chat_manager/send_entry.rs::mark_turn_accepted` overwrites the daemon start stamp even for queued acceptance; `event_handler.rs::on_result` emits duration, and display grouping assigns it by backward assistant search. That existing footer path is not an authoritative cross-message fold identity or clock.

## Contract and product decisions

1. Preserve G1–G3's dedicated authoritative-streaming capability and legacy fallback. Grouping never synthesizes message running status. New presentation metadata is independently optional and validated; absence never disables the original streaming fallback or hides unknown work. Keep invalidation monotonic for a candidate epoch: later stale final/terminal events cannot restore folding for it.
2. Define shared `TranscriptPresentation` version 1 with provider-scoped stable `turnId`, stable provider `sourceMessageId`/item identity, `phase` (`work`, `commentary`, `final_answer`, or omitted), explicit turn state (`running`, `completed`, `cancelled`, `failed`, `invalid`, or unknown), and optional verified turn timing. Record it per stable source block, not as one phase for an entire merged container. Carry a versioned `presentationSources` sidecar alongside display content and under `ItemMeta` for each encoded item; no new notification or mode-dependent transport. Include final eligibility explicitly: async deliveries, pending user-input questions and unsupported structured output are never treated as ordinary final text. Unknown fields/phases do not become final by default.
3. Keep legacy container grouping, IDs, content order, text coalescing, native part layout and Verbose copy/action/footer scope unchanged. Track stable source-block membership while concatenating the original content; preserve turn/phase boundaries only in that additive sidecar. Each encoded item source entry identifies `sourceMessageId`, source block ordinal, presentation context, explicit overlay-owned `streaming` when known, and exact target: whole tool/image, or `{ contentBlockIndex, startUtf16, endUtf16 }` for text/reasoning. Use half-open UTF-16 code-unit offsets in the post-transformation emitted text: Rust counts `encode_utf16()` units, JS slices by those units; never reuse Rust UTF-8 byte indices. Spans cannot bisect surrogate pairs. Any inserted separators must have explicit source membership or remain visible as unmapped text; stripping/coalescing recomputes offsets in lockstep. Never recover boundaries by text matching. Adjacent commentary/final text may remain one encoded block/native part. Conversion remaps these spans to native part indices without splitting parts. Invalid, overlapping or unaccounted spans leave the affected content visible. Never infer a turn from adjacent UI messages, last assistant, timestamps, user content or elapsed run state.
4. Codex identity is the tuple of provider thread ID and explicit turn ID, additionally scoped by root chat/ancestor in UI. Capture phase/eligibility from `item/started` and reconcile from `item/completed`. Reuse #378's thread/turn/item accumulator and cumulative partial emission through the existing overlay path; add presentation context at that emission point. First nonempty eligible final text permits folding while still streaming. Completed item replaces its partial under the same ID, never appends a duplicate. Missing start/phase keeps the text visible and may become eligible only when a later authoritative completed item arrives.
5. Codex timing comes only from verified provider turn timestamps/duration, normalized once from seconds to milliseconds. Do not use item `startedAtMs` as turn start. Missing or invalid timing yields an untimed “Work details” header. A supplied running start may drive a local header-only 1-second clock; completion freezes from provider values. Do not sum tools or reuse unassociated daemon footer timing.
6. Claude support is narrower: an explicit parent `end_turn` tied to `message.id` marks the exact final API-message blocks; first-token final detection is unavailable. Publish a completed fold only after the matching successful parent result confirms an unambiguous epoch. Keep a provider-local candidate epoch anchored by stable first parent API-message ID, with explicit result/end-turn closure and source membership; tool-result messages do not open turns. A queued acceptance is not a start. Unpaired queue replay, non-tool steering, retry/exit/cancellation, conflicting ownership or uncertain history lineage changes that span to explicit invalid state and revokes any previously published candidate metadata. The UI treats invalid as unfolded regardless of stale final phase or a remembered closed choice. Never advance to a guessed epoch. Preserve precise block IDs when one API message emits several entries.
7. Claude result `duration_ms` may be attached only to that exact confirmed epoch; missing/invalid/unmatched values remain absent. History must reproduce the same stable membership using actual parent lineage and terminal stop markers. A reload lacking terminal or lineage evidence stays unfolded; do not reconstruct IDs from row position or wall time. If producer fixtures cannot prove a particular lineage case, omit its metadata and document the visible fallback. Do not claim universal Claude/history folding.
8. Inner activity groups contain consecutive routine mixed read/search/list/edit/write/shell/web/MCP calls, independent of kind and completion. Commentary/nonempty text, images, compaction, unsupported/interactive cards, subagents and error containers are boundaries. Routine reasoning stays available inside aggregate details, but does not split mixed tool groups or create a separate top-level row on each occurrence. Reasoning-only work can use a collapsed Thinking/Thought summary; unknown duration remains omitted. Full cards, pending approvals, declined/stopped calls and failed-call signals remain outside routine aggregation. Unknown dynamic tools remain standalone; no invented Codex presentation flags.
9. Only the latest open group in an explicitly active work slice uses an active label. Prefer known running exploration, then scan backward for a running member; retain the latest known exploration label while that slice remains open; otherwise “Thinking”. Do not keep older groups active across commentary/final boundaries. With missing turn metadata use local explicit part state and message boundaries conservatively. Identity changes wait until 1,000 ms after the last displayed identity change; same-identity text changes and transition to completed summary are immediate. Timer cleanup and reentrant updates are tested.
10. Completed summaries deterministically aggregate supported categories in fixed order: named MCP integrations, unnamed calls, file changes, exploration (“Read files” for read/search/list), commands, web searches. Deduplicate paths internally; command singular/plural comes from count; empty summary is “Worked”. Reuse #371's structured command semantics and conservative command fallback; never parse output to infer purpose/status. Do not add categories/presentation options for data Mainframe does not have.
11. Inner groups start collapsed, with existing rows/cards as ordered details and bounded height. Keep running details available on expansion rather than importing Codex's read-row omission; permissions stay operable. Retain single-item groups to prevent completion from destroying disclosure identity. Keys use member tool IDs plus transcript scope, not labels/index/count; preserve an explicitly expanded member as the group grows.
12. Outer work disclosure uses authoritative turn identity across messages. It collapses by default when eligible final content exists (Codex first final text; Claude confirmed terminal path), renderable work exists, and no exception applies. Cancelled/error/ambiguous turns remain expanded; compaction-only work has no wrapper. Final answers, user steering, failure signals, permission/question/plan/workflow cards and subagents remain visible in chronological slots outside hidden work. Active nested agents, focused/selected content and explicitly expanded tool details prevent automatic collapse. User outer choice wins except a safety-required active control must remain exposed. New content must never conceal an active interaction.
13. Per-chat/ancestor/turn disclosure has three states: unset, user-open, user-closed. Inner state remains independent. Preserve choices across switching/remount within this app session; no restart persistence. Outer collapse must not reset inner choices or reorder/duplicate content. Unknown turn metadata uses inner grouping only and no outer fold.
14. One shared list presentation serves main/split and readonly nested transcripts. Build from source message/part references, render through native message/part scopes, retain source message IDs/actions and selection paths. A source part is rendered exactly once; fragment rendering must not duplicate footers, message IDs or copy actions. Native repository status, message/part layout and streaming identity remain untouched. Verbose retains its existing list, content, selectors, copy scope and single footer per container. Compact-only text fragments use stable source keys and native text-part providers; explicit source streaming is carried from the overlay membership, never inferred from the whole coalesced part. Unknown/unmapped text remains visible.

## Sequential task groups

### G4 — Neutral presentation contract and lossless display transport

Kind: core. Depends on: G3 (completed; integrated at `98466ca8`). parallel_safe: false. Tests coupled.

Owned files:

- `packages/types/src/transcript-presentation.ts` (new)
- `packages/types/src/index.ts`
- `packages/types/src/__tests__/transcript-presentation.test.ts` (new)
- `packages/core-rs/crates/mainframe-types/src/transcript_presentation.rs` (new)
- `packages/core-rs/crates/mainframe-types/src/lib.rs`
- `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`
- `packages/core-rs/crates/mainframe-adapter-api/src/pr_detection/sink.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/presentation.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/event_handler/partial_overlay.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/presentation_tests.rs` (new)
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/message_grouping.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/presentation_grouping.rs` (new)
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/presentation_grouping_tests.rs` (new)
- `packages/types/src/acp/extensions-payload.ts`
- `packages/core-rs/crates/mainframe-types/src/acp/extensions.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_helpers.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/presentation_display.rs` (new)
- `packages/core-rs/crates/mainframe-acp/src/encoder.rs`
- `packages/core-rs/crates/mainframe-acp/src/encoder/content.rs`
- `packages/core-rs/crates/mainframe-acp/src/encoder/accum.rs`
- `packages/core-rs/crates/mainframe-acp/src/encoder/tool_call.rs`
- `packages/core-rs/crates/mainframe-acp/src/encoder/presentation.rs` (new)
- `packages/core-rs/crates/mainframe-acp/src/encoder/tests/presentation_tests.rs` (new)
- `packages/core-rs/crates/mainframe-acp/src/encoder/tests.rs`

Add typed context-aware sink methods with backward-compatible defaults delegating to existing message/partial methods, plus a turn-state update that targets exact recorded membership. Forward them in sink decorators. The chat sink stores context on raw messages/overlays and applies terminal updates by exact scoped turn identity. Keep old adapters working without metadata. Scope partial overlays by parent/child ownership; do not let a child contextual callback clear or overwrite its parent's overlay. Preserve legacy grouping and metadata semantics; append a lossless source-membership sidecar when merging raw blocks. Carry membership through the actual display conversion/tool-group transforms in lockstep with emitted output, including stripping and nested attribution, then remap to item/block spans while the encoder coalesces text. Add typed optional `ItemMeta.presentationSources`; do not stamp one source phase onto the whole container, split containers/items/parts, change IDs or fork transport by preference. Existing fields and content bytes must match output without presentation metadata. Extract provenance transforms into focused helpers; never locate sources by comparing output text. Register `SessionSink`/`AdapterSession` child modules under `adapter.rs` and re-export there, leaving the 456-line adapter-api `lib.rs` untouched. Register the display/provenance sibling modules from the small `messages.rs` module root; no registry extraction is needed.

Mechanical extraction ownership (new files; keep existing public import paths via re-exports):

- `packages/core-rs/crates/mainframe-adapter-api/src/adapter/session_sink.rs`
- `packages/core-rs/crates/mainframe-adapter-api/src/adapter/adapter_session.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/deps.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/display_emission.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_messages.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_tools.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_permissions.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_result.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_result_notifications.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_queue.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_exit.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_metadata.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_notifications.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/tests/support.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/tests/paths.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/tests/queues.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/tests/results.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/tests/quotas.rs`
- `packages/core-rs/crates/mainframe-chat/src/event_handler/tests/streaming.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_assistant.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_user.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_tool_groups.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline_markers.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline_tests/basic.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline_tests/markers.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline_tests/attachments.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_helpers_tests.rs`

Move the existing responsibilities named by these modules out of the oversized parent, including its inline tests. Split long handlers into short orchestration plus domain helpers; retain state/ordering semantics. Existing test registrations stay with the parent. This is part of this group, not a separate refactor handoff.

Verification intent: schema rejection/default tests, old-adapter default behavior, precise live→commit→cancel metadata updates, parent/child isolation, stable display/ACP IDs and legacy content/part boundaries, replay equivalence and source-span preservation. Include one ordinary legacy container containing adjacent commentary and final text (coalesced into one text block), plus text→tool→final, astral Unicode, combining marks, inserted separators and stripped/transformed content. Strip only new metadata and assert exact legacy display/ACP output equality; prove spans cover the same text once through streaming growth, terminal patch, invalidation and replay. Existing unrelated streaming capability tests remain green.

### G5 — Codex presentation context over upstream delta streaming

Kind: core. Depends on: G4, completed at `0eee3f88`, and upstream integration `8d7c1dd8`. parallel_safe: false. Tests coupled.

Owned files:

- `packages/core-rs/crates/mainframe-adapter-codex/src/lib.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/types.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_variants.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/event_mapper.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_render.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/turn_lifecycle.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/session_state.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/parent_id_sink.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/history_load.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/history_convert.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/transcript_presentation.rs` (new)
- `packages/core-rs/crates/mainframe-adapter-codex/src/agent_message_partial.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/tests/agent_message_presentation.rs` (new)
- `packages/core-rs/crates/mainframe-adapter-codex/src/presentation_history_tests.rs` (new)

Normalize generated-schema-backed fields; keep old missing fields accepted. Preserve turn objects while converting history rather than flattening context away. Pass context for routine tools, reasoning, commentary and final items; retain child ownership. Reuse `AgentMessagePartialState`, its 50 ms throttle, delta parser, ownership guards and lifecycle cleanup. Add validated thread/turn/item context at the existing partial emission and completion paths. Capture phase/eligibility at item start, reconcile at completion, and use exact G4 membership updates for late metadata without appending text again. Missing context keeps the existing text-delivery path and remains visible. Do not add `text_stream.rs`, another accumulator or timer.

Keep presentation state in `transcript_presentation.rs` and clear it through existing lifecycle helpers, including `clear_transient`; upstream kill/exit call sites in `session.rs` remain unchanged. Preserve mark-before-completion ordering and interruption guards. Forward context and parent attribution through `ParentIdSink`; child deltas remain ignored and child text renders at completion. Preserve G4 parent-overlay isolation during child completion. Keep legacy containers/content/IDs and additive UTF-16 spans unchanged. Reuse upstream `tests/agent_message_delta.rs`, `tests/common/mod.rs`, `tests/fixtures/agent-message-delta-0.155.1.jsonl` and `mainframe-server/tests/codex_agent_message_streaming.rs` without new G5 edits. Put new contextual cases in the owned focused test file; do not grow the upstream 480-line test or duplicate its feature changeset. G8 retains the consolidated release note.

Mechanical extraction ownership (new files; keep existing public import paths via re-exports):

- `packages/core-rs/crates/mainframe-adapter-codex/src/notification_types.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/thread_read_types.rs`
- `packages/core-rs/crates/mainframe-adapter-codex/src/types_tests.rs`

Move the existing responsibilities named by these modules out of the oversized parent, including its inline tests. Split long handlers into short orchestration plus domain helpers; retain state/ordering semantics. Existing test registrations stay with the parent. This is part of this group, not a separate refactor handoff.

Verification intent: run the reused adapter delta and server streaming regressions against G4/G5; prove first eligible final text carries presentation context and completion remains exactly once. Add parent partial→child completion→continued parent partial→parent completion coverage proving parent overlay preservation and child ownership. Cover commentary→tools→final within a legacy container and across existing container boundaries; absent/late phase; async/questions exclusion; cancellation/error; reconnect/full/cursor replay; two turns and concurrent child ownership; provider timestamps and old schema omissions. Rollout-only nested history currently lacks trustworthy turn context: retain visible outer fallback rather than broadening rollout parsing without source evidence.

### G6 — Claude explicit terminal association and conservative history

Kind: core. Depends on: G5. parallel_safe: false. Tests coupled.

Owned files:

- `packages/core-rs/crates/mainframe-adapter-claude/src/lib.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/partial_stream.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/assistant_event.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/user_event.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_converters.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/transcript_presentation.rs` (new)
- `packages/core-rs/crates/mainframe-adapter-claude/src/presentation_history.rs` (new)
- `packages/core-rs/crates/mainframe-adapter-claude/src/presentation_tests.rs` (new)

Capture `message_delta.delta.stop_reason == end_turn` against retained API-message ID and recognize explicit completed-assistant stop reason when present. Associate all exact blocks of that API message without relabeling earlier commentary. Maintain a candidate parent epoch, confirm only on matching successful result, and attach result `duration_ms` only there. Preserve tool-result continuation and distinguish actual queued replay from accepted-but-not-started prompts. Invalidate ambiguity instead of attributing a result to the latest send. History conversion uses the same reducer/identity rule over explicit source lineage; no UI reconstruction.

Mechanical extraction ownership (new files; keep existing public import paths via re-exports):

- `packages/core-rs/crates/mainframe-adapter-claude/src/session_state.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_process.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_spawn.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_controls.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_prompt.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_adapter.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_lifecycle.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_tests/support.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_tests/spawn.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_tests/controls.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/session_tests/lifecycle.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/event_system.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/event_control.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/event_result.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests/support.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests/init.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests/control.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests/results.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests/notifications.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests/stderr.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/user_event_tools.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/user_event_content.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_discovery.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_paths.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_tests.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_entry_helpers.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_assistant_entry.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_user_entry.rs`
- `packages/core-rs/crates/mainframe-adapter-claude/src/history_converters_tests.rs`

Move the existing responsibilities named by these modules out of the oversized parent, including its inline tests. Split long handlers into short orchestration plus domain helpers; retain state/ordering semantics. Existing test registrations stay with the parent. This is part of this group, not a separate refactor handoff.

Verification intent: multi-block final message, tool-use rounds, tool-result user entries, non-tool steering, queue acceptance/replay mismatch, subagent parent IDs, retry, interruption, drain turn, missing stop reasons/results, duplicated events and live/reload identity agreement. Stop condition: if exact ownership cannot be proven in a fixture representing an actual producer case, that case must emit no foldable metadata, keep work visible and appear in the delivered limitations. No guessed final marker or copied result prose is permitted.

### G7 — Mixed inner groups and stable activity summaries

Kind: ui. Depends on: G6. parallel_safe: false. Tests coupled.

Owned files:

- `packages/ui/src/features/chat/view-model/compact/types.ts`
- `packages/ui/src/features/chat/view-model/compact/build-activity-groups.ts` (new)
- `packages/ui/src/features/chat/view-model/compact/activity-summary.ts` (new)
- `packages/ui/src/features/chat/view-model/compact/activity-label.ts` (new)
- `packages/ui/src/features/chat/view-model/compact/__tests__/activity-groups.test.ts` (new)
- `packages/ui/src/features/chat/view-model/compact/__tests__/activity-summary.test.ts` (new)
- `packages/ui/src/features/chat/messages/compact/CompactParts.tsx`
- `packages/ui/src/features/chat/messages/compact/CompactRows.tsx`
- `packages/ui/src/features/chat/messages/compact/CompactActivityGroup.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/use-stable-activity-label.ts` (new)
- `packages/ui/src/features/chat/messages/compact/__tests__/CompactActivityGroup.test.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/__tests__/stable-activity-label.test.tsx` (new)

Add an aggregate model above the existing detail-row model. Its member references include stable source message ID and original part index/tool ID; consecutive members may span containers only when their authoritative turn/ancestor identity matches. Missing identity limits grouping to the current message. The same pure model serves message-local rendering now and the G8 list partition; details scope each referenced source message natively. Commentary and protected standalone content end runs; routine reasoning joins details without ending a mixed run. Reuse existing status resolution, command actions/labels and detail renderers; ordinary mixed tools share the aggregate. Stabilize active identity for one second without delaying same-item text or completion. Keep hooks local to headers; no transcript-wide clock. Tests must exercise real native part scoping, group growth/reclassification, failure/approval visibility and disclosure identity. Existing same-kind rows remain useful inside details; they no longer define top-level aggregate membership.

Verification intent: mixed shell/read/edit/MCP, concurrent active selection, commentary boundaries, missing metadata, failed/declined/stopped/pending controls, explicit details, timer ticks/cleanup and native action preservation. Main/split/nested scope tests use real components; no new tool status heuristics.

### G8 — Outer work partition and native-scoped transcript rendering

Kind: ui. Depends on: G7. parallel_safe: false. Tests coupled.

Owned files:

- `packages/ui/src/features/chat/view-model/convert-acp-item.ts`
- `packages/ui/src/features/chat/view-model/message-meta.ts`
- `packages/ui/src/features/chat/view-model/transcript-presentation.ts` (new)
- `packages/ui/src/features/chat/view-model/__tests__/transcript-presentation.test.ts` (new)
- `packages/ui/src/features/chat/view-model/compact/build-turn-disclosures.ts` (new)
- `packages/ui/src/features/chat/view-model/compact/__tests__/turn-disclosures.test.ts` (new)
- `packages/ui/src/features/chat/messages/compact/CompactTranscript.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/CompactTurnDisclosure.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/CompactMessageSlice.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/CompactTextSlice.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/turn-disclosure-store.ts` (new)
- `packages/ui/src/features/chat/messages/compact/transcript-scope.tsx`
- `packages/ui/src/features/chat/messages/compact/__tests__/CompactTurnDisclosure.test.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/__tests__/CompactTurnTranscript.integration.test.tsx` (new)
- `packages/ui/src/features/chat/messages/compact/__tests__/VerboseCompactParity.test.tsx` (new)
- `packages/ui/src/features/chat/messages/MessageTiming.tsx`
- `packages/ui/src/features/chat/thread/ChatThreadViewport.tsx`
- `packages/ui/src/features/chat/tools/cards/SubagentTranscript.tsx`
- `.changeset/settled-previous-answer.md` (extend existing)

Parse per-item source spans once into `MainframeMessageMeta.partSources`, a sidecar indexed by the original native part index with source IDs/context and mapped text ranges. Preserve `convertAcpItems` message count, IDs, parts, content and status; this additive mapping is ignored by Verbose. Partition these exact source refs into one authoritative turn disclosure, persistent units and final answers, preserving source order even when work and final share a native message and a text part. Unknown/system/user boundaries are explicit model inputs; no whole-message hiding if it contains persistent parts. `CompactMessageSlice` renders whole original parts with native `PartByIndex`; `CompactTextSlice` renders a source text range through `TextMessagePartProvider` from the installed public `@assistant-ui/react` export inside the original message scope. The slice key is source identity, never changing offsets/phase/text. Its status comes from explicit source membership; use existing MarkdownText for smoothing/selection. Keep source actions/footer exactly once with full original message copy scope. Keep final text in a stable sibling slot outside collapsible work from its first visible fragment onward; revealing/hiding work must not reparent or remount it. Do not render the same source message through both the old list and new list.

Use a tri-state outer store keyed by chat, ancestor chain and stable turn ID. Reuse scroll interaction locks/anchors; auto-collapse must defer when focus/selection/explicit inner expansion would be hidden. Pending permission/question controls remain outside collapsible content. Keep nested scope recursion; when its metadata is missing, nested content gets inner grouping only. Suppress duplicate footer duration only when the outer header carries the same authoritative interval; retain an accessible cost-only presentation.

Verification intent: exactly one fold for a multi-message turn, first-final-text folding while final text continues, Claude confirmed terminal fold, final never duplicated/retyped, invalid metadata no fold, cancel/error/default expansion, active nested agents and controls, per-chat persistence, repeated turns, system/steering chronology, disclosure/selection/scroll/focus, cost access, main/split/nested native paths and unchanged Verbose selectors. A shared mixed-work-plus-final fixture must assert legacy Verbose has the same single message root, part content, copy payload, actions and one timestamp/timing/footer; Compact hides only mapped work, renders final text exactly once and retains its DOM/native slice identity while text grows, collapse toggles and terminal/replay metadata updates arrive. Test adjacent text within one part, not only text separated by tools. The shared parity fixture includes astral Unicode and inserted coalescing separators after transformations, asserting complete byte-for-byte displayed/copy text with no lost or duplicated characters and exactly one original message footer. Extend the existing changeset to describe consolidated grouping and provider limitations.

## Bounds and final integration requirements

- Graph: G5→G6→G7→G8 after completed G1–G4 and upstream integration `8d7c1dd8`. All groups own implementation and tests. These group verification statements describe intent; no new grouping implementation or runtime was performed while authoring this plan.
- All touched implementation files must finish within 300 lines and functions within 50. Mechanical extractions below belong to the owning code group, preserve public re-exports and move existing tests with behavior unchanged. Their purpose is to accommodate the required context path without growing existing large modules; no unrelated behavior changes.
- Source paths and module registrations were checked against integrated `98466ca8`. Register child modules from their existing parent files. Preserve G1–G3 facts/checks; there is no new planning/review loop for already completed groups.
- Parent runs fresh combined independent code review, then affected live QA. Exercise Codex first-final-text and Claude explicit-terminal cases, ambiguous/missing-metadata fallback, both providers, main/split/nested, long turns, narrow widths/themes, controls, scrolling and persistent choices. Separate controlled wire/schema fixtures from real provider runs. A final screenshot alone cannot prove first-text collapse or label timing.
- Run affected Rust/TS tests, shared types/UI typechecks, lint/format and normal hooks; record actual commands/results during implementation, not predictions. Retain G1–G3 regressions. No mobile, dependency upgrade, output parsing, new protocol guesses, or product QA route.
- The accepted research is copied into `docs/research/2026-10-03-codex-activity-grouping.md`; only its closing delivery implications change. No bundled/minified app source or generated vendor schema is committed. Parent owns independent plan review and the combined final review/QA.
