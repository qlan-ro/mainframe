# Per-tool-call timestamps implementation plan

Goal: Give each observed tool call stable daemon-owned start and completion timestamps, exposed through ACP and assistant-ui.

Architecture: Record call timing at the shared session sink and retain it with cached raw calls. Display preparation and ACP encoding only copy known timing. The UI maps the optional wire field to native tool-call timing.

Stack: Rust daemon, serde, ACP, TypeScript, Zod, assistant-ui.

Approved brief: `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/.lane-state/todo-373-tool-call-timing/brief.md`. This is the implementation artifact for approved todo #373, `size:m`, `route:no-spec`; the acceptance contract is reproduced below.

Base: `0ea3eb85d956abb2e126561970ee54337a8f918e`, branch `todo/373-tool-call-timing`. Execute in `.worktrees/todo-373-tool-call-timing`. Parent owns implementation dispatch, independent review, QA, and delivery gates. Do not start another review loop from a task group.

## Scope and acceptance

- Two calls in one container retain independent start and completion timestamps.
- Duplicate events, replay, regrouping, and reconnect do not change established timestamps.
- Successful empty results, failures, and observed cancellation terminate timing.
- Concurrent and nested calls retain their own identities and timing.
- Optional timing round-trips through raw Rust data, display preparation, ACP, Zod, and the UI converter.
- Injected-clock tests cover transitions and history without timing. Runtime verification records reconnect behavior and persistence limits.
- No timer UI, reasoning timing, layout work, total-turn duration changes, provider duration calculations, Node runtime changes, mobile changes, or new transcript database.
- Todo #372 and open PR #742 remain independent. Do not cherry-pick them. Their future `ItemMeta.commandExecution = { commandActions, reportedDurationMs }` and `providerMetadata.codex` fields must coexist with this plan's `toolCallTiming` field.

## Established facts

| Path and symbol                                                                                                                                                                 | Verified behavior and consequence                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`, `SessionSink`                                                                                                   | Provider-neutral callbacks include `on_message`, `on_tool_result`, and `on_subagent_child`. There is no separate neutral execution-start event.                                                                                                                                      |
| `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`, `SessionSinkImpl`                                                                                                | Top-level uses arrive in `on_message`; results arrive in `on_tool_result`. Nested Claude uses and results enter `on_subagent_child`. Stamp before display emission and before the result handler skips error-specific side effects.                                                  |
| `packages/core-rs/crates/mainframe-adapter-claude/src/partial_stream.rs`, `accumulate_delta`                                                                                    | Current partial streaming handles text/thinking, not tool argument deltas. It does not expose an earlier tool start.                                                                                                                                                                 |
| `packages/core-rs/crates/mainframe-adapter-codex/src/event_mapper.rs`, `handle_item_started`; `thread_item_render.rs`, `render_command_execution`                               | Started events render compaction and collaboration calls. Bash emits its use and result from `item/completed`. The measured Bash interval can be zero or very short. It is observation timing, not command execution duration.                                                       |
| `packages/core-rs/crates/mainframe-chat/src/message_cache.rs`, `MessageCache::{set,append,release,evict_if_needed}`                                                             | The cache stores raw messages in memory. Active registry chats are pinned. `set` replaces messages; release/eviction can remove them. Timing must survive ordinary replacement while following explicit cache teardown.                                                              |
| `packages/core-rs/crates/mainframe-chat/src/chat_manager/history.rs`, `get_resume_snapshot`; `lifecycle_manager.rs`, `do_load_chat`                                             | Reconnect reads display data from cached raw messages. A history load can replace the raw cache before resync. Preserve established timing by call identity during that replacement.                                                                                                 |
| `packages/core-rs/crates/mainframe-types/src/chat.rs`, `MessageContentNode::ToolUse`; `display.rs`, `DisplayNode`, `TaskProgressItem`                                           | Raw uses, displayed uses, task-group parents, and progress items have no timing. Results use `tool_use_id`; rendered ACP IDs use the corresponding call ID, not container position.                                                                                                  |
| `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline.rs`, `prepare_messages_for_client`                                                              | This shared preparation path groups raw messages and converts to display nodes for the daemon. `display_helpers.rs` reconstructs calls through `PartEntry`, including task/progress wrappers. Copy timing after grouping by stable call ID to avoid losing it during reconstruction. |
| `packages/core-rs/crates/mainframe-acp/src/encoder.rs`, `Container::base_meta`, `tool_call_item`, `task_group_item`                                                             | Item timestamps currently copy the container timestamp. The encoder is pure. `status_for` uses result presence, including empty successful results.                                                                                                                                  |
| `packages/core-rs/crates/mainframe-acp/src/session_state/tool_patch.rs`, `diff_meta`; `packages/ui/src/features/chat/view-model/acp-item-accumulator.ts`, `applyToolCallUpdate` | ACP emits changed metadata as a replacement. The client keeps omitted metadata and replaces supplied metadata. No separate timing patch protocol is needed.                                                                                                                          |
| `packages/ui/src/features/chat/view-model/convert-acp-item.ts`, `toolPart`; `tool-call-result.ts`, `toolCallResult`                                                             | Conversion rebuilds nested Task messages recursively. A result with zero content entries currently returns `undefined`, so verify terminal empty content independently of timing.                                                                                                    |
| Installed `assistant-stream@0.3.37/src/core/utils/types.ts`, `ToolCallTiming`; `@assistant-ui/core@0.3.12/src/runtime/utils/thread-message-like.ts`, `ThreadMessageLike`        | Native timing is `{ startedAt: number; completedAt?: number }`, measured in epoch milliseconds. The external-store message input accepts it directly. No library change is required.                                                                                                 |
| Installed `@assistant-ui/react@0.15.13/src/hooks/useToolCallElapsed.ts`, `useToolCallElapsed`                                                                                   | A completed timestamp returns a fixed difference; an absent completion ticks only while the part runs. Missing timing returns `undefined`. No local timestamp fallback is needed.                                                                                                    |

Read the assigned checkout's `CLAUDE.md` and `packages/ui/CLAUDE.md`. The primary checkout's `docs/guides/development.md` and `docs/guides/rust-builds.md` supply current commands and build constraints; those guides are absent from this pinned base. Keep workspace-local Cargo targets and the existing build profiles.

## Timing contract and lifecycle decisions

Use one canonical Rust `ToolCallTiming` and one canonical Zod `ToolCallTimingSchema`, with matching JSON:

```json
{ "startedAt": 1790899200000, "completedAt": 1790899200125 }
```

`startedAt` is required inside a present timing object. Both values are nonnegative integer epoch milliseconds within JavaScript's safe integer range. `completedAt` is optional. Add optional `timing` to raw `ToolUse`, displayed `ToolCall`, `TaskGroup`, and `TaskProgressItem`. Add optional `toolCallTiming` to `ItemMeta`. Old data omits these fields, rather than serializing null or zero. TS raw/display contracts mirror Rust. Native `part.timing` receives the same values without unit conversion.

Use the chat ID plus the existing provider-stable call ID as identity, matching ACP's current uniqueness requirement. Parent IDs describe attribution, not elapsed time or grouping identity. Keep the sink's session identity on the active observation record so an obsolete sink cannot complete calls owned by its replacement. Rebuilding a sink for the same session does not reset timestamps. Different chats with the same call ID remain independent.

The cache owns a small `ToolTimingStore` beside its raw-message collection. It tracks known identities, optional timing, terminal state, and the session that observed an active call. A known historical identity without timing must remain known so live replay cannot turn it into a new start. Copy canonical timing back onto cached raw uses, including duplicate copies. Display consumers should not need to know about this store.

| Input                                       | Timing action                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New live `ToolUse`                          | Record one injected-clock reading as `startedAt`; register current session ownership.                                                                                                      |
| Repeated use or completed-call replay       | Preserve established values and terminal state. Never reopen a completed call.                                                                                                             |
| Live result for a known observed call       | Set completion once, before branching on `is_error` or output text. Empty content and error results are terminal.                                                                          |
| Result with no observed start               | Track terminal identity, but do not invent a timing object. A later replayed use must not acquire a fresh start.                                                                           |
| Nested block batch                          | Apply the same transitions by each child's call ID. The Task parent has its own timing. Process mixed use/result batches in source order.                                                  |
| Cancelled/error turn or owning session exit | Complete only outstanding calls observed under that session. Emit changed display timing before publishing terminal session state or releasing cached data. Keep already completed values. |
| Ordinary successful turn boundary           | Do not infer completion for an unresolved background/subagent call. Actual results or definitive session teardown close it.                                                                |
| Diagnostic `on_error` or retry              | Do not treat a recoverable diagnostic alone as terminal. Use the existing terminal result/exit classification.                                                                             |
| History `set`/reload                        | Never read the clock. Preserve known timing; accept valid explicit timing on normalized calls; preserve missing values when no trustworthy timing exists.                                  |
| Cache release/eviction or daemon restart    | Remove matching timing bookkeeping with raw data. A later load retains only explicit trustworthy history timing. No new persistence sidecar.                                               |

Inject a `now_epoch_ms` dependency at the timing owner, defaulting to the daemon wall clock. Read once per callback batch. First observed start and first terminal completion win. If the wall clock moves backward, clamp an observed completion to its known start; do not rewrite the start. Reject malformed historical timing independently of the containing call. No container timestamp, turn duration, provider duration, or history-read time may fill missing timing.

The normalized optional timing field is the trusted history boundary. Preserve it through serde, cached replacement, and normalized raw-message snapshots. Provider transcript copies used by forks retain only what their source file actually contains. Current provider transcript readers do not establish per-call timing provenance. Keep their defaults absent; do not derive timing from message timestamps or a provider's reported duration. Document that offload/eviction can lose daemon-only timing just as restart can, while reconnect to the retained session preserves it.

Cancellation ends timing without inventing provider output or successful results. This ticket need not add a new ACP status enum. The native elapsed hook stops from `completedAt` even when cancellation supplied no result body. Existing session cancellation/error status continues to describe the terminal outcome.

## Review focus

- History replacement followed by live duplicate events must not create fresh starts. G1 pins both timed and untimed history.
- A late exit from an old sink must not finish a newer session's calls. G1 tests session ownership and callback order.
- Empty results must stop timing even when no result text exists. G1 tests receipt; G2 and G3 test wire and native conversion.
- Regrouped nested calls must retain distinct timing. G2 tests ToolGroup, TaskGroup, progress items, and parent/child independence.
- Reconnecting during one of two overlapping calls must retain both identities and values. G3 verifies fresh accumulator replay against daemon snapshots.

## Task graph

`G1 -> G2 -> G3`. All groups are sequential because the contracts and fixtures overlap. Each group owns its regression tests and implementation. Mechanical constructor updates belong to the group that adds the field. Keep new files at most 300 lines and new functions at most 50 lines; extract focused helpers instead of expanding the large existing event handler or display helper files.

### G1: Own observed timing in the daemon cache

Kind: `core`. `parallel_safe: false`. `depends_on: []`.

Files:

- Create `packages/core-rs/crates/mainframe-types/src/tool_call_timing.rs`; export from `src/lib.rs`.
- Modify `packages/core-rs/crates/mainframe-types/src/chat.rs` for optional raw-call timing.
- Create `packages/core-rs/crates/mainframe-chat/src/tool_call_timing.rs` and `src/tool_call_timing/tests.rs` for the store and transitions; register from `src/lib.rs`.
- Modify `packages/core-rs/crates/mainframe-chat/src/message_cache.rs` and create `src/message_cache/timing_tests.rs` for history merge and cleanup.
- Modify `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`; create `src/event_handler/tool_timing.rs` and `src/event_handler/tool_timing_tests.rs` for focused sink integration and injected-clock coverage.
- Modify `packages/core-rs/crates/mainframe-chat/src/chat_manager/history.rs` and `src/lifecycle_manager.rs` only where callers return or compare the pre-merge history instead of the actual merged cache.
- Update raw `ToolUse` constructors and exhaustive matches in the Rust workspace for the new optional field. Provider readers default to `None`; preserve explicitly supplied normalized timing where typed data already carries it. Include Claude `history_converters.rs`, `history_subagents.rs`, Codex `history.rs`, mock helpers, and their affected fixtures. Do not change provider event semantics.
- Create `packages/types/src/tool-call-timing.ts`; modify `src/chat.ts` and `src/index.ts` for the mirrored canonical schema/type/export. Put schema validation tests in `src/__tests__/tool-call-timing.test.ts`.

Produces `ToolCallTiming`, its TS schema, and raw calls enriched with canonical timing. `MessageCache::set` remains a clock-free replacement API that merges established call timing and seeds missing-history identities. Sink timing helpers take chat ID, session ownership, blocks, and injected milliseconds; cache mutation and timing transition use the same lock.

- [ ] Add failing clock-driven tests before implementation. Use start A=1000, start B=1100, empty result A=1200, error result B=1300. Assert A=`{1000,1200}`, B=`{1100,1300}`; repeat callbacks at 9000 and assert exact equality.
- [ ] Test parent P and child C independently; a mixed nested use/result batch; result-before-use with no fabricated start; same ID in different chats; duplicate/replayed terminal calls; a sink replacement and stale exit; backward clock completion; cancellation/error exit with no result body. Normal turn completion must not close a still-live background child.
- [ ] Test `set` replacing live timed raw calls with equivalent untimed history, valid explicit timed history, and legacy untimed history. Replaying each at a later clock value must preserve its known or absent timing. Verify release/eviction clears bookkeeping and reconnect reads do not.
- [ ] Implement the timing store and cache merge. Ensure history callers return the merged cache, not the old unmerged `remapped` vector. Treat malformed explicit timing as absent without discarding the call. Avoid a second independently mutable timing store on each sink.
- [ ] Wire live top-level and nested callbacks, terminal result classification, and guarded exit. Emit timing changes before terminal notification/cache release. Cancellation intent alone and failed interrupt requests do not prove completion.
- [ ] Run focused timing tests and workspace compilation. Keep constructor changes mechanical and inspect all changed provider paths. Confirm no changes to Codex `item/started` behavior or total-turn duration.

Verification intent: `cargo test --manifest-path packages/core-rs/Cargo.toml -p mainframe-chat tool_timing`, the new cache timing test filter, `cargo test --manifest-path packages/core-rs/Cargo.toml -p mainframe-types tool_call_timing`, and `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/tool-call-timing.test.ts`. Name new tests to match these filters and inspect executed test counts.

### G2: Carry timing through display and ACP

Kind: `core`. `parallel_safe: false`. `depends_on: [G1]`.

Files:

- Modify `packages/core-rs/crates/mainframe-types/src/display.rs`, `src/acp/extensions.rs`, and TS `packages/types/src/display.ts`, `src/acp/extensions-payload.ts`.
- Create `packages/core-rs/crates/mainframe-display/src/tool_call_timing.rs` and its focused tests; export the projection helper from `src/lib.rs`.
- Modify `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline.rs` to apply timing to final grouped output from the original raw calls. Update display constructors in `messages/display_helpers.rs` and other affected Rust sites with absent defaults.
- Modify `packages/core-rs/crates/mainframe-acp/src/encoder.rs` and `src/encoder/content.rs`; extract a focused encoder helper if needed for file/function limits.
- Create `packages/core-rs/crates/mainframe-acp/src/encoder/tests/tool_timing_tests.rs`; extend `src/session_state/tool_patch/tests.rs` and register tests.
- Extend shared golden fixtures under `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/` and `packages/types/src/__tests__/acp-golden-fixtures.test.ts` with running/completed timing. Keep old untimed fixtures unchanged.

Consumes raw `ToolUse.timing`. Produces `DisplayNode` timing and `_meta['_mainframe.dev'].toolCallTiming`. The projection helper indexes raw timing by stable call ID and recursively applies it to final ToolCall, TaskGroup parent, children, and TaskProgressItem nodes. It never reads time or infers timing for a virtual group wrapper.

- [ ] Add failing tests for two calls sharing a container timestamp but different timings; grouped/ungrouped revisions; nested Task parent and child; task progress; failed and empty successful results; unchanged legacy history.
- [ ] Implement the pure final-display projection after task subject backfill. Preserve per-call values when grouping moves nodes or chooses a different container ID. Do not propagate a Task parent's timing to its children.
- [ ] Encode optional timing on each corresponding tool item. Keep message `_meta.timestamp` and message-level timing unchanged. All tool encoding paths, including TaskGroup and TaskProgress, must use the same optional contract.
- [ ] Test a metadata-only completion change produces an ACP patch, applying that patch produces the same item as a fresh completed snapshot, and repeating the snapshot emits no new change. Validate all fixture JSON through both serde and Zod.
- [ ] Run focused display/encoder/patch tests plus shared golden tests. Confirm the encoder has no clock reads and `ItemMeta` leaves room for the independent `commandExecution` field.

Verification intent: focused tests in `mainframe-display`, `mainframe-adapter-claude`, and `mainframe-acp` using `tool_timing` filters; existing tool patch tests; `cargo test --manifest-path packages/core-rs/Cargo.toml -p mainframe-types`; `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/acp-golden-fixtures.test.ts`. Rebuild shared types before G3.

### G3: Expose native timing and verify reconnect behavior

Kind: `ui`. `parallel_safe: false`. `depends_on: [G2]`.

Files:

- Modify `packages/ui/src/features/chat/view-model/convert-acp-item.ts` and, for terminal empty-content correctness, `tool-call-result.ts`.
- Create `packages/ui/src/features/chat/view-model/__tests__/convert-acp-item-timing.test.ts`; extend `__tests__/acp-item-accumulator.test.ts`, `__tests__/parse-item-meta.test.ts`, and `__tests__/convert-acp-item-tool-results.test.ts` as needed.
- Extend `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests/resume_snapshot.rs`. Create `packages/core-rs/crates/mainframe-server/tests/acp_ws_tool_timing.rs`, reusing `tests/support/facade.rs::spawn_facade_server_with` and a controllable test adapter in `tests/support/tool_timing_adapter.rs`; register that helper in `tests/support/mod.rs`. This fixture wires a real ChatManager. The plain detach fixture does not and cannot prove cache retention.
- Add one appropriate feature changeset under `.changeset/`. Record public behavior and the reconnect/restart limitation, including Codex's current observation limit.

Consumes `ItemMeta.toolCallTiming`; produces native `ToolCallMessagePart.timing` for ordinary and nested calls. Use the native type without casts that hide a mismatch. No view component or hook implementation changes.

- [ ] Add failing converter tests showing exact milliseconds on live and replay-origin calls, two calls in one container, nested Task messages, malformed timing isolated from valid parent/container metadata, and no `timing` property for legacy history.
- [ ] Map the optional field directly in `toolPart`. Do not call `Date.now`, derive values from `createdAt`, or use total-turn timing. Keep existing and future provider metadata independent.
- [ ] Test terminal `completed`/`failed` calls with zero content entries and with one empty text entry. Represent a genuine terminal empty result as a defined empty result where needed so assistant-ui does not treat it as unresolved. Keep running calls' result absent. Timing completion must stop elapsed measurement even when cancellation has no result body.
- [ ] Drive running and completed metadata patches through `AcpItemAccumulator`, then rebuild a fresh accumulator from resume replay and compare converted timing by tool-call ID. Completion-only metadata updates must retain start and unrelated item metadata.
- [ ] Extend daemon resume tests with an injected clock. In the real facade integration fixture, receive a call start, detach/reconnect, and assert the exact original value from the new snapshot; complete it and repeat. Include two overlapping calls and nested attribution. Run the focused integration test through the repository's existing fixtures.
- [ ] Run live QA with the parent's prepared environment at daemon port `32373`, UI port `6125`, using the primary `.agents/test-env.sh` and the live-qa scenario gate. Capture ACP start, reconnect replay, completion, and second replay values. Use a provider/mock scenario that emits a start before completion; separately record Codex's completion-only Bash behavior. Do not claim command execution duration from that interval.
- [ ] Reload legacy provider history with no per-call timing and confirm absent timing, readable content, and no new client clock values. Restart only the isolated test daemon and report that timing survives only when the loaded data explicitly contains trustworthy timing. Keep runtime evidence under `/tmp/live-qa/todo-373-session-20261002` or lane state, outside the checkout.
- [ ] Run affected package checks, inspect the diff and staged content for secrets, add the changeset, and commit with hooks enabled. Parent performs final independent review, QA acceptance, and PR delivery.

Verification intent: run each affected UI Vitest file separately; types build and `exec tsc --noEmit`; UI `typecheck`; `pnpm exec eslint` on changed TS files; `cargo fmt --manifest-path packages/core-rs/Cargo.toml --all -- --check`; `cargo check --manifest-path packages/core-rs/Cargo.toml --workspace`; focused crate tests and the reconnect integration test. Use package manifests for exact available scripts. Do not set `CARGO_TARGET_DIR`.

## Verification and handoff limits

This document records code inspection and installed-library inspection, not implementation test results. The parent prepared dependencies and the base daemon separately. No product files were changed by the plan author. Each implementer must record commands, executed test counts, outcomes, and runtime evidence after their own changes. Failed checks require repair or an explicit blocker; static inspection does not prove live reconnect behavior.

The main risks are raw constructor spread, missed cache replacement paths, stale session callbacks, and accidental historical timestamp fabrication. The groups above keep those risks with their owning code and tests. Providers that only report completed calls will expose short observation intervals until a separate adapter lifecycle change supplies earlier events.
