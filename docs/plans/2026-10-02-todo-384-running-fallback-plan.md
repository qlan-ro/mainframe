# Authoritative streaming and compact activity grouping — implementation plan

Approved brief: todo #384, `brief.md` in the external lane state. Size: medium; no separate spec. Base: `8145d3051b656a7fe5df7bc3fcb02ba3052376f9`, branch `todo/384-running-fallback`.

Keep a completed answer settled when a new turn starts on a daemon that advertises authoritative item streaming. Preserve the existing nearest-assistant fallback for unknown and legacy daemons, including an acknowledgment after the streaming assistant. Do not change transcript ordering, transport throttling, animation timing, or mobile.

## Consolidated scope and completed baseline

The user folded Codex activity-grouping research and #374 outer disclosure into #384 on 2026-10-03. The executable extension is [G4–G8 in the grouping addendum](2026-10-03-todo-384-grouping-addendum.md), based on the [accepted source research](../research/2026-10-03-codex-activity-grouping.md). It supersedes the original exclusion of grouping/animation changes only where that addendum explicitly requires them. The streaming fallback fix and legacy compatibility remain required.

G1 completed at `6e263dc0`; G2 at `5da834e3`; G3 at `283fbe21`. Parent reports G3 validation: 200 tests passed. Integration with main `e6af2bfa` completed cleanly at `98466ca8e27285bd2bdabb52c2e7acf18287eabc`, with 83 focused tests and UI typecheck passing. These are execution receipts from the parent lane, not tests rerun by this plan author.

The sections below preserve the original G1–G3 decisions, baseline facts and verification intent as historical context. Do not rerun their planning stages or implement them again. Execute G4→G5→G6→G7→G8 from the integrated checkout; each new group owns its tests and exact file list. Parent owns independent review of the additions and combined code review/QA.

## Established facts

- `packages/ui/src/features/chat/controller/project-messages.ts`, `projectChatThreadMessages`: running and cancelling trigger a backward assistant search when no server message is explicitly running. The search crosses a trailing user message; queued and pending messages are appended afterward. `projectChatThreadRepository` uses this same projection.
- `packages/ui/src/features/chat/controller/__tests__/project-messages-ack-during-stream.test.ts`, `asst` and the acknowledgment test: the protected fixture has no explicit assistant status. Stopping at the last user would break this legacy contract.
- `packages/ui/src/features/chat/view-model/convert-acp-item.ts`, `partStatus` and `assistantContainer`: `streaming === true` supplies running part/message status; replay-origin nonstreaming parts are complete; live nonstreaming parts have no explicit status. Preserve these semantics.
- `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`, `emit_display_for`, `streaming_leaf_kind`: only a nonempty partial text/thinking overlay matching the prepared assistant tail produces `StreamingLeafKind`. The overlay commit drops that marker, as tested by `the_streaming_flag_rides_the_overlay_and_drops_on_commit` in `event_handler/partial_overlay_tests.rs`.
- `packages/core-rs/crates/mainframe-server/src/acp_ws/hub/handlers.rs`, `FacadeHub::handle_display_revision`, calls `encoder::encode_revision`. In `packages/core-rs/crates/mainframe-acp/src/encoder.rs`, `encode_revision` marks the open matching segment of the last nonqueued top-level container; `encode` used for history has no overlay. The capability can promise authoritative overlay status, not continuous animation for every running turn or nested tool.
- `packages/core-rs/crates/mainframe-acp/src/session_state/tests.rs`, `a_streaming_drop_is_a_meta_patch_in_the_same_diff`, proves removing the streaming marker is a metadata patch. Existing encoder, hub, and throttle tests cover forwarding and final metadata replacement.
- `packages/types/src/acp/extensions.ts`, `MainframeCapabilitiesSchema`, and `packages/core-rs/crates/mainframe-types/src/acp/extensions.rs`, `MainframeCapabilities`, define optional extension flags. `packages/core-rs/crates/mainframe-acp/src/capabilities.rs`, `mainframe_capabilities`, advertises them. None currently identifies authoritative item streaming; neither replay nor creation support implies it.
- `packages/ui/src/lib/daemon/acp-client.ts`, `AcpFacadeClient.connect`, parses capabilities after initialize and advances `connectionGeneration`. Capabilities currently survive socket close; reconnect gap callbacks occur later. There is no capability-change subscription.
- `packages/ui/src/features/chat/controller/acp-session-attachment.ts`, `bindClient`, `detach`, `syncConnectionGeneration`: client binding outlives active transcript subscriptions. A reconnect initiated by another chat can precede this attachment's gap callback. Capability propagation must follow binding and successful handshake, not only session frames or gaps.
- `packages/ui/src/features/chat/controller/chat-actions.ts`, `sendChatMessage`, queues the optimistic message and dispatches `run.started` before awaiting load. `chat-plane-loader.ts`, `ChatPlaneLoader.seedAndBind`, connects before binding. Already-loaded threads therefore need negotiated support stored before the next optimistic send.
- `packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts`, `useChatThreadRuntime`, uses repository projection; `packages/ui/src/features/chat/zones/ChatZone.tsx`, `ChatZone`, uses message projection with `ExternalThread`. Installed `packages/ui/node_modules/@assistant-ui/core/src/store/clients/external-thread.ts`, `derivePartStatus`, defaults absent message status to complete, independently of thread `isRunning`; it does not add a second tail fallback.
- `packages/ui/src/features/chat/parts/use-held-displayed-text.ts`, `useHeldDisplayedText`, delegates reveal to native `INTERNAL.useSmooth`. `parts/__tests__/streaming-smooth.test.tsx`, `Harness`, exercises real conversion/projection and native smoothing. Its settle-delay fallback case describes legacy behavior, not a guarantee that should carry into authoritative mode.

## Decisions

1. Add optional wire capability `authoritativeItemStreaming` (`authoritative_item_streaming: Option<bool>` in Rust). Only literal `true` selects authoritative mode. Missing, false, malformed/unparsed, and never-negotiated capabilities retain legacy behavior. Do not infer support from a daemon version, `replayComplete`, or `itemCreationMarkers`.
2. Advertise true from the current daemon because its verified overlay producer, encoder and metadata-diff path supply the required semantics. A missing/false item marker means no active overlay for that item. Committed text may arrive complete; do not manufacture a clock or keep a settled message running to extend its animation.
3. Store `authoritativeItemStreaming: boolean`, initially false, in `ChatThreadState`, updated by a dedicated reducer event. Maintain the last successful negotiation during a transient disconnect of the same bound client. On every successful initialize, replace capabilities and synchronously notify subscribers after installing connection/generation/capabilities but before returning or delivering subsequent session traffic. Failed initialization cannot install new support. Bind to a different client from its own snapshot, including null/absent → false; never inherit the old client's support.
4. Subscribe for the lifetime of the binding, including dormant detach. Unsubscribe on replacement/disposal; reject stale old-client callbacks. Rebinding the same client must refresh its current snapshot. Preserve existing connection-generation replay coordination and delayed gap behavior. The capability notification itself must not send resume traffic.
5. In authoritative mode, preserve every explicit assistant status, including running behind a user acknowledgment; give assistants lacking status the native complete message status. Do not assign status to user/system messages or rewrite parts. In legacy mode retain the existing fallback exactly, including cancelling and the acknowledgment search. Thread-level run/cancel indicators remain governed by run state in both modes.
6. Main and split chat continue using the shared projection. Prove both actual native provider paths consume the result correctly; no runtime-specific duplicate fallback, global animation switch, or changes to selection/scroll handling.

## G1 — Completed: advertise and pin the streaming contract

Kind: `core`. Depends on: none. `parallel_safe: false`. Tests belong to this group.

Owned files:

- `packages/types/src/acp/extensions.ts`
- `packages/types/src/__tests__/acp-authoritative-streaming.test.ts` (new)
- `packages/core-rs/crates/mainframe-types/src/acp/extensions.rs`
- `packages/core-rs/crates/mainframe-types/src/acp/extensions/capabilities.rs` (new)
- `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/extensions.capabilities.json`
- `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/initialize.response.json`
- `packages/core-rs/crates/mainframe-acp/src/capabilities.rs`
- `packages/core-rs/crates/mainframe-acp/src/encoder/tests/streaming_tests.rs`
- `packages/core-rs/crates/mainframe-server/src/acp_ws/hub/tests.rs`

Implementation:

1. Add the optional capability to both canonical schemas and current-daemon advertisement. Move Rust `MainframeCapabilities` plus its omission test to the focused child module and re-export from `extensions` so callers retain their current imports. This brings the existing 349-line extensions file below 300 without broad protocol restructuring.
2. Update the shared current-capability and initialize fixtures. Add TS schema tests for true, false, missing, invalid value and an unrelated-capabilities-only object. Retain Rust absent-field serialization coverage and assert the advertised true value against fixtures.
3. Extend encoder/hub coverage with a completed previous answer, turn-start without an overlay, a subsequent explicit text/thinking overlay, and marker removal on commit. Assert only the overlay item streams and the old answer remains unmarked. Use the existing partial-overlay and metadata-drop tests as producer/settlement evidence; do not change transport scheduling or overlay ownership.

Verification intent: run the shared TS/Rust golden fixtures and focused capability, encoder, metadata-drop, throttle and hub tests; typecheck/build shared types and check affected Rust crates. The advertised guarantee must be demonstrated by production encoding tests, not capability fixtures alone. If an uncovered producer path contradicts this narrow contract, report it before advertising broader support.

## G2 — Completed: carry negotiation through client binding and reconnect

Kind: `ui`. Depends on: `G1`. `parallel_safe: false`. Tests belong to this group.

Owned files:

- `packages/ui/src/lib/daemon/acp-client.ts`
- `packages/ui/src/lib/daemon/acp-capability-state.ts` (new)
- `packages/ui/src/lib/daemon/__tests__/acp-client-capabilities.test.ts` (new)
- `packages/ui/src/features/chat/controller/acp-session-attachment.ts`
- `packages/ui/src/features/chat/controller/acp-session-attachment-types.ts`
- `packages/ui/src/features/chat/controller/acp-session-capabilities.ts` (new)
- `packages/ui/src/features/chat/controller/chat-thread-state.ts`
- `packages/ui/src/features/chat/controller/chat-thread-reducer.ts` (new)
- `packages/ui/src/features/chat/controller/__tests__/acp-session-capabilities.test.ts` (new)
- `packages/ui/src/features/chat/controller/__tests__/chat-thread-capabilities.test.ts` (new)

Implementation:

1. Extract capability parsing/storage/listener publication into `acp-capability-state.ts`; expose a getter and `onCapabilitiesChanged` from `AcpFacadeClient`. Keep notifications synchronous with successful initialization, including true → absent/false and false → true reconnects. Preserve the prior value on transient close and failed reconnect until a replacement handshake succeeds. Keep the client below 300 lines by moving existing parsing/storage, not by adding another parallel snapshot.
2. Add an optional capability subscription to the narrowed session client port so older test/client ports still work from their snapshot. Production always supplies it. Own the binding subscription in `acp-session-capabilities.ts`; call it from attachment bind and disposal, separate from transcript listeners removed by dormancy. Suppress redundant state dispatches, refresh on same-client bind, and guard against callbacks from a replaced/disposed binding.
3. Add the state field/event. Extract the existing reducer into `chat-thread-reducer.ts`, re-exporting from the current module to keep call sites stable; divide lifecycle, interaction and delegated-event handling into functions of at most 50 lines. Preserve all old event semantics and exhaustive handling. Avoid growing the existing attachment/plane or oversized test kit: the helper owns capability logic; tests reuse the test kit without editing it.
4. Test real client handshakes with socket doubles: notification occurs before connect resolves/new traffic, reconnect initiated elsewhere before this chat's gap, true → absent/false and legacy → true, failed initialization, disconnect retention, and listener cleanup. Attachment tests cover initial bind, dormant detach/reactivate, same-client refresh, different-client reset, old callback rejection and disposal. Reducer tests cover initial false, idempotence, true/false transitions and preservation across unrelated run/transcript updates.

Verification intent: run focused client, attachment and reducer tests plus existing reconnect/gap/staged-replay tests. Assert observed reducer events and their order, not just the client getter. No transcript traffic is required to deliver a newly negotiated capability to an already-bound dormant or active chat.

## G3 — Completed: gate the fallback and prove both rendered paths

Kind: `ui`. Depends on: `G2`. `parallel_safe: false`. Tests belong to this group.

Owned files:

- `packages/ui/src/features/chat/controller/project-messages.ts`
- `packages/ui/src/features/chat/controller/__tests__/project-messages-authoritative.test.ts` (new)
- `packages/ui/src/features/chat/controller/__tests__/project-messages-ack-during-stream.test.ts`
- `packages/ui/src/features/chat/parts/__tests__/authoritative-streaming-support.tsx` (new)
- `packages/ui/src/features/chat/parts/__tests__/authoritative-streaming-main.test.tsx` (new)
- `packages/ui/src/features/chat/parts/__tests__/authoritative-streaming-split.test.tsx` (new)
- `.changeset/settled-previous-answer.md` (new)

Implementation:

1. Extract a small server-message status helper from `projectChatThreadMessages` so each function remains within 50 lines. Authoritative mode supplies complete only where assistant status is absent and never runs the fallback. Legacy mode keeps the existing nearest-assistant logic. Preserve input immutability, ordering, IDs, queued dedup and pending-message projection.
2. Retain the original acknowledgment regression as unknown/legacy coverage; add false and unrelated-capability cases through negotiated state tests. Projection tests cover authoritative new-turn wait, pending sends, confirmed user echoes, cancelling, explicit streaming behind a user, no assistant, idle, existing nonrunning explicit status, and transition back to legacy. Exercise repository projection as well as message arrays.
3. Create a focused test helper using real `convertAcpItems`, state reducer, shared projection and production `MarkdownText` rendering. Provide the real main `useExternalStoreRuntime`/repository wrapper and split `AuiProvider`/`ExternalThread` wrapper. Do not mock status normalization or `useSmooth`; mock only unrelated platform dependencies if required. Keep wrapper/fixture construction outside test bodies and files below 300 lines.
4. In both wrappers, finish a live-origin answer, start another turn before any new overlay, then unmount/remount its text part. Assert the entire old answer is visible immediately and remains unchanged across animation frames. Repeat with a confirmed user echo and cancelling. Then supply a distinct explicitly streaming item, including a trailing user acknowledgment, and assert it reveals progressively while the previous answer remains complete. Check partial → committed transitions settle without truncation. Keep legacy smoothing/settle-delay and selection-hold regressions passing; their fallback expectations must not be silently changed to authoritative behavior.
5. Add the implementation changeset with patch entries for the fixed shared-types/UI package group, explaining the user-visible settled-answer behavior and dedicated capability.

Verification intent: new projection and both native-wrapper tests fail against the old fallback, pass with the change, and retain the existing acknowledgment and streaming-smoothing tests. Run affected conversion, pending/queued/reconcile, runtime, split-zone and selection tests; complete UI/shared-types typechecks and repository lint/format checks applicable to touched source. No product runtime wrapper should need changing; if native-path tests expose a required change, amend exact ownership before implementation rather than hide it in test fixtures.

## Exit criteria and handoff

Original sequence `G1 → G2 → G3` is complete; the new execution sequence is in the addendum. Each author owns implementation and its regression tests; do not hand off a deliberately failing test group. The parent owns independent code review, then runtime QA, before final acceptance.

- All changed/new implementation files stay at most 300 lines and functions at most 50. The identified extractions are part of their code groups; avoid extending existing oversized test files. No dependency or lockfile changes are needed.
- Run the relevant TS/Rust tests, typechecks/build checks, lint and formatting; report actual commands/results at execution time. Planning verification below is not an implementation gate result.
- Parent QA exercises the next-turn wait/remount with the real current daemon and main/split views, including explicit streaming after the wait. Capture time-sensitive visible text/status evidence, not only final screenshots. Controlled wire tests cover missing/false capability and reconnect negotiation separately; label these as fixtures, not an older-daemon runtime proof. Follow the accepted six-group QA proposal without expanding product scope.
- A fresh runtime reproduction of retyping has not been performed during planning. Confirm the regression using the live-origin remount test; distinguish its automated evidence from later app QA.
- Preserve known limitations: unknown/legacy keeps the old fallback by design; authoritative overlay completion may stop progressive reveal earlier than the legacy settle fallback; no new streaming guarantee is made for nested tool transcripts or providers that deliver complete blocks only.
- Include the changeset in implementation, preserve mobile/other worktrees, scan staged files for secrets, and commit through normal hooks. This planning commit contains only this document.

## Planning verification

Source inspection confirmed the producer → encoder → metadata update → conversion → projection chain and installed main/split runtime behavior. Baseline focused acknowledgment, streaming-projection and native-smoothing tests are recorded in the external plan receipt. No daemon/app was launched and no product code was changed. All group verification above describes future implementation intent.
