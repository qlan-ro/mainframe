# Plan: Codex stream failure message and Reconnecting indicator (todo #406)

- Spec: `docs/specs/2026-11-10-todo-406-codex-stream-failure-reconnecting.md` (approved at `f2cddf1b`). The spec owns behavior and acceptance criteria; this plan picks mechanisms.
- Design direction (binding for G2): the reconnect indicator is variant A, toned down. The failed-turn card is variant A. Both are on todo #406.
- Size m, two sequential groups: **G1 core + wire contract**, then **G2 UI**.

## Established facts

Verified against source while planning. Downstream stages trust these instead of re-deriving them.

**Codex protocol (codex-cli 0.163.0; source `~/.agents/sources/codex` @ `3e9264f`)**

- F1. `codex app-server generate-json-schema` (0.163.0, run 2026-11-10), `v2/ErrorNotification.json`:
  - Required fields: `error: TurnError`, `threadId: string`, `turnId: string`, `willRetry: boolean`.
  - `ServerNotification.json` routes method `"error"` to it.
- F2. Same schema, `TurnError`:
  - `message: string` is the only required field.
  - `codexErrorInfo` is `CodexErrorInfo | null`.
  - `additionalDetails` is `string | null` (default null). `misalignment` is optional.
- F3. Same schema, `CodexErrorInfo` mixes three shapes:
  - a string enum (`serverOverloaded`, `other`, `contextWindowExceeded`, …)
  - single-key objects (`responseStreamDisconnected`, `responseTooManyFailedAttempts`, `httpConnectionFailed`, `responseStreamConnectionFailed`, …)
  - a final catch-all arm typed `["string","object"]`

  Lenient decoding is therefore required by the schema itself.
- F4. `codex-rs/app-server/src/bespoke_event_handling.rs`:
  - `EventMsg::StreamError` becomes `ServerNotification::Error { will_retry: true }`, carrying `message`, `codex_error_info` and `additional_details`.
  - The terminal path (`handle_turn_error` area) sends `will_retry: false` with the same `TurnError` that `turn/completed` carries.
- F5. Codex's retry messages:
  - `codex-rs/core/src/responses_retry.rs` emits `Reconnecting... {retry_count}/{max_retries}` and `Reconnecting... waiting for network`.
  - `codex-rs/core/src/compact.rs` emits the same `N/M` form during compaction. `Compacting` outranks the status there.
- F6. `codex-rs/protocol/src/error.rs` displays `ServerOverloaded` as `Selected model is at capacity. Please try a different model.`

**Mainframe, current code**

- F7. `mainframe-adapter-codex/src/event_mapper.rs::handle_notification`:
  - Its `decode` drops parse failures silently.
  - It has no `"error"` arm, so `"error"` falls to `handle_unmapped`.
  - `resolve_owner` returns `Owner::{Parent, Child, Unknown}`.
  - `owner_sink` is private.
  - The file is 294 lines and not ratcheted.
- F8. `ParentIdSink` (`src/parent_id_sink.rs`) does not override `on_api_retry`. It falls to the `SessionSink` default no-op (`mainframe-adapter-api/src/adapter/session_sink.rs`), so a child retry routed through `owner_sink` would vanish.
- F9. `notification_types.rs::TurnError` holds only `message`.
  - Its one consumer is `turn_lifecycle.rs::finish_parent` → `explain_turn_error(e.message)`.
  - `CodexSessionState::mainframe_chat_id` is available for logs.
- F10. `turn_error.rs::explain(raw, subscription, now)`:
  - Parses an OpenAI envelope and returns `raw` unchanged when parsing fails.
  - `turn_error_tests.rs` calls `explain` directly, with this signature.
- F11. `tests/turn_error.rs::plain_text_error_is_unchanged` asserts that `"stream disconnected before completion"` passes through raw. Under spec Behavior 4.2 that text becomes a stream failure, so this test must change. It is not an envelope test.
- F12. `tests/common/mod.rs::Recorded` has no retry capture. PR #898 adds `cancellations` after `permissions` and `on_permission_cancelled` after `on_permission`. `tests/event_mapper.rs` is ratcheted at 1179 lines and must not grow.
- F13. The retry path into the chat sink:
  - `mainframe-chat/src/event_handler/sink_notifications.rs::handle_api_retry` emits `ChatSurfaceEvent::Retry` first, then a clearing display revision when a partial overlay existed. This applies to Claude and Codex alike.
  - `mainframe-server/src/acp_ws/hub/handlers.rs::handle_retry` only applies `StreamOp::Retry`.
  - `mainframe-acp/src/stream.rs::on_retry` parks the marker until the next eligible upsert.
  - `on_turn_finished` clears the parked marker.
- F14. `FacadeHub::push_notification` → `push_raw_to_attached` → `StreamOp::Raw` uses the same per-session FIFO as content. It is buffered and drained across a resume, as compaction and queue_state are.
  - `handlers.rs` is 281 lines.
  - `hub.rs` declares the hub submodules.
- F15. `hub/fanout.rs` is ratcheted at exactly 326 lines in `packages/core-rs/tools/file_length_ratchet.json` and holds `RawFrameKind`. Adding a variant there would grow a ratcheted file.
- F16. Notification builders and wire types:
  - Builders live in `mainframe-acp/src/capabilities.rs` (`compaction_notification`, …) and are re-exported from `lib.rs`.
  - Param types live in `mainframe-types/src/acp/extensions.rs`, which is 293 lines.
  - That file has submodules `extensions/{capabilities,history,prompt,replay}.rs` re-exported with `pub use`.
  - Both `mainframe-acp` and `mainframe-adapter-codex` depend on `mainframe-types`.
- F17. Golden fixtures in `mainframe-types/tests/fixtures/acp/*.json` are validated by both test suites, and each suite throws on a fixture with no dispatch arm:
  - `mainframe-types/tests/acp_golden_fixtures.rs`
  - `packages/types/src/__tests__/acp-golden-fixtures.test.ts`
- F18. Existing hub tests that touch retry:
  - `hub_tests_notification_tests.rs::a_retry_marker_lands_on_the_next_upsert_for_attached_sessions` asserts `frames.len() == 1` after a retry plus a revision. That count changes.
  - `hub_tests_awaiting_seed_lifecycle_tests.rs::a_retry_raised_during_the_await_marks_the_first_frame_after_the_replay` finds the marked frame with `.find`, so it is unaffected.
- F19. Client notification path. Compaction is the template:
  - `CompactionParamsSchema` (`packages/types/src/acp/extensions-notifications.ts`)
  - → `NOTIFICATIONS` row + `ListenerSignatures` + `onCompaction` (`ui/src/lib/daemon/acp-notification-router.ts`)
  - → `AcpFacadeClient.onCompaction` (`acp-client.ts`, **exactly 300 lines**)
  - → `AcpSessionClientPort` (`acp-session-attachment-types.ts`)
  - → `wireAcpSessionListeners` (`acp-session-listeners.ts`)
  - → reducer `compact.started/done` → `ChatThreadState.compacting`
  - → `turn-phase.ts::turnPhase` and `turn-status-host.ts`

  No client code reads the upsert `RetryMarker` today.
- F20. Client state and update handling:
  - `acp-session-plane.ts` (297 lines) defers `run.stopped` behind a settle delay (`acp-run-stop-settle.ts`). A new `run.started` cancels that delay.
  - `SessionUpdate` kinds are in `packages/types/src/acp/update.ts`.
  - Content kinds: `agent_message(_chunk)`, `agent_thought(_chunk)`, `tool_call`, `tool_call_update`, `tool_call_content_chunk`.
  - Non-content kinds: `user_message(_chunk)`, `state_update`, `usage_update`.
- F21. Status row and card:
  - `TurnStatusRow.tsx` (190 lines): `usePhase` → `useStableActivityLabel({identity, text})`. The same identity with new text updates immediately; an identity change waits out the 1 s dwell.
  - `RunningStatus` uses `bg-warning` on the dot and `text-warning` on the text only for `Needs your input`. It applies the `ENTER` 180 ms morph class.
  - `TurnStatusTrailing` is mounted by `CompactActivityGroup` (when it hosts the status) and by `CompactToolRow`.
  - `ChatThreadState.chatId` is available through `useChatExtras()`.
  - `AssistantErrorBlock.tsx` (24 lines) renders one destructive `AlertDescription`.
- F22. Mock adapter: `mainframe-adapter-mock/src/dispatch.rs` replays recorded `onApiRetry` and `onResult`.
  - Recordings are NDJSON (`packages/e2e/fixtures/recordings/retry.0.ndjson`).
  - `E2E_RECORDINGS_DIR`, `E2E_RECORDING_KEY` and `E2E_MOCK_MAX_DELAY_MS` (in `pump.rs`; default ceiling 120 ms) control replay.

## Decisions

- D1. **The maximum travels inside the reason and is parsed once, at the wire boundary.**
  - The spec's AC fixes `on_api_retry(attempt, reason)`, so `SessionSink` gains no new parameter.
  - A single parser, `attempt_fraction(text) -> Option<(i64, i64)>`, lives in `mainframe-types` and returns the first `N/M` token in `text`.
  - The Codex adapter uses it for N.
  - The retry-status notification builder sets `maxAttempts` only when the reason's first `N/M` has N equal to the attempt. Claude's `overloaded_error` therefore gets no maximum.
- D2. **The new transient notification is `_mainframe.dev/retry_status`**, with params `{sessionId, attempt, maxAttempts?, reason?}`.
  - `handle_retry` pushes it through `push_notification` (same FIFO, F14) *before* applying the existing `StreamOp::Retry`, which is kept unchanged.
  - It is not persisted or replayed (spec 2.9).
- D3. **The client takes retry state only from `retry_status`.** It never reads the upsert marker, so a later marked upsert cannot re-enable the status after content has arrived.
- D4. **Rule for clearing on content.** In `wireAcpSessionListeners`, the first update that carries actual content dispatches `retry.cleared` (spec 2.8). An idle `state_update` also clears. The rule reads content only, never `_meta`:
  - `agent_message` / `agent_thought` upserts clear only when `content` is a non-empty array. This includes an upsert that carries a `RetryMarker`. In `stream.rs::retry_marker_carrier` the marker rides only non-empty content, so a marked frame is the first new content after the retry.
  - `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update` and `tool_call_content_chunk` always clear, as content or tool progress.
  - Upserts whose `content` is `[]`, `null` or omitted do not clear. These are the overlay removal that `handle_api_retry` emits right after the retry (F13), and metadata-only updates.
  - Non-content kinds (F20) never clear. Turn end clears in every case (D5).
- D5. **Lifecycle cleanup is redundant on purpose.** The reducer clears retry state on each of these:
  - `run.stopped`, `run.failed`, `run.cancelling`, `transcript.cleared`
  - `run.started` when the previous `runState` was not `running` (a new turn)

  The listener also clears on idle `state_update` without waiting for the deferred `run.stopped` (F20). A stale retry can never survive into the next turn.
- D6. **Codex child-thread retries call the unwrapped session sink directly**, not `owner_sink`. `ParentIdSink` would drop them (F8), and the status belongs to the chat, not to an item. `Owner::Unknown` drops them with a debug log, as `owner_sink` does.
- D7. **`additionalDetails` is decoded as a lenient `Option<Value>` and read with `as_str`**, like `codexErrorInfo`. A non-string value can then never fail `turn/completed`. `misalignment` stays ignored, because unknown fields are allowed.
- D8. **Headline rules**, in this order:
  1. An envelope always takes the unchanged #834 path (`explain`). The envelope check runs first.
  2. Stream text, or `responseStreamDisconnected` / `responseTooManyFailedAttempts`, gets the stream headline.
  3. `serverOverloaded` passes through when the text is the capacity sentence; otherwise the capacity headline goes on top.
  4. `other` gets the generic headline.
  5. Anything else stays raw.

  The headline strings are copied verbatim from spec 4.3 and 4.5.
- D9. **`explain`'s signature and `turn_error_tests.rs` stay untouched** (spec 4.1). A new `explain_with_info(raw, kind, subscription, now)` wraps it. `explain_turn_error` takes `&TurnError`.
- D10. **Where the test ids sit.**
  - In the status row, `data-testid="chat-retry-status-<chatId>"` goes on the keyed morph span that wraps the phase text. It is present only while the *displayed* text is the reconnect label, which can lag by up to the 1 s dwell. The existing `chat-thread-running-text` testid stays on the inner span.
  - In `TurnStatusTrailing`, the reconnect segment (a warning dot plus the label in the phase-word style, before the clock) carries the testid.
  - The row and the trailing slot are mutually exclusive through `useTurnStatusHost`, so at most one element carries the id.
- D11. **Ratchet and size moves.**
  - `RawFrameKind` moves from `fanout.rs` into a new `hub/raw_frame_kind.rs`, which gains `RetryStatus`. The `fanout.rs` ratchet entry drops to whatever the gate reports.
  - `acp-client.ts` stays at 300 lines or fewer by moving its module constants (`FALLBACK_HEARTBEAT_INTERVAL_MS`, `DEFAULT_CLIENT_INFO`, `RECONNECT_*_DELAY_MS`) into `acp-client-defaults.ts`.
  - None of PR #898's lines are reformatted. `session_lifecycle.rs`, `approval_handler.rs` and `session.rs` are untouched. In `tests/common/mod.rs`, additions go at the end of `Recorded`, the end of the `Recorder` impl and the end of the `RecordingSink` impl, away from PR #898's hunks.
- D12. **QA uses a mock recording, not a failing OpenAI stream.**
  - The mock replays `onApiRetry(2, "Reconnecting... 2/5")`, held long enough to capture (via `E2E_MOCK_MAX_DELAY_MS`), then an `onResult` error whose text is the stream headline plus a blank line plus the raw message.
  - This exercises the provider-neutral path end to end. The Codex mapping itself is covered by tests.

## Implementation groups

### G1: Codex mapping, headline, retry-status wire contract (core)

- kind: core · parallel_safe: true (no file shared with G2) · depends_on: none
- Files:
  - `packages/core-rs/crates/mainframe-adapter-codex/src/notification_types.rs`: `TurnError` gains `codex_error_info` and `additional_details`, both `#[serde(default)] Option<Value>`, camelCase. Add `ErrorNotificationParams { thread_id, turn_id, will_retry (default false), error }`.
  - `.../src/codex_error_info.rs` (new) plus a `#[path]` sibling `codex_error_info_tests.rs`:
    - `classify(Option<&Value>) -> Option<CodexErrorKind>` covers the string, single-key object and unknown shapes.
    - `describe(raw, kind) -> String` applies D8 rules 2–5 with the verbatim headline constants.
  - `.../src/turn_error.rs`: `explain_turn_error(&TurnError)` and `explain_with_info` (D9).
  - `.../src/turn_lifecycle.rs`: a one-line call-site change in `finish_parent`.
  - `.../src/error_notification.rs` (new):
    - `handle_error_notification(params, sink, state)` decodes the params. Failure logs `warn!(chat_id = %state.mainframe_chat_id, error = %err, …)` and returns.
    - `willRetry: false` returns. Otherwise it resolves the owner (D6).
    - The attempt is `attempt_fraction(message).map(N)`, or 0 when there is none.
    - The reason is the trimmed message, plus `additionalDetails` when it is non-empty.
  - `.../src/event_mapper.rs`: one new `"error" => crate::error_notification::handle_error_notification(params, sink, state),` arm. `lib.rs` gets the module declarations.
  - `.../tests/common/mod.rs`: add `retries: Vec<(i64, Option<String>)>`, a `retries()` accessor and `on_api_retry` (placement per D11).
  - `.../tests/error_notification.rs` (new) and `.../tests/turn_error.rs`: end-to-end ACs through `handle_notification`. Replace F11's input with a non-stream plain-text message.
  - `packages/core-rs/crates/mainframe-types/src/acp/extensions/retry.rs` (new), re-exported from `extensions.rs`:
    - `RetryStatusParams { session_id, attempt, max_attempts: Option<i64>, reason: Option<String> }`, camelCase, with optional fields skipped when absent.
    - `attempt_fraction` (D1), with unit tests.
  - `packages/core-rs/crates/mainframe-acp/src/capabilities.rs`: `retry_status_notification(session_id, attempt, reason)` derives `max_attempts` per D1. Re-export it from `lib.rs`.
  - `packages/core-rs/crates/mainframe-server/src/acp_ws/hub/raw_frame_kind.rs` (new), `hub.rs`, `hub/fanout.rs`, `hub/handlers.rs`: apply D11, then make `handle_retry` push the notification and then apply `StreamOp::Retry` (D2).
  - `packages/core-rs/tools/file_length_ratchet.json`: lower the `fanout.rs` entry.
  - `.../mainframe-server/src/acp_ws/hub_tests_notification_tests.rs`: update F18's count and order, and add a "retry with no following upsert still reaches the client" test.
  - Golden fixtures `retry-status.params.json` and `retry-status.notification.json`, with dispatch arms in both `acp_golden_fixtures.rs` and `packages/types/src/__tests__/acp-golden-fixtures.test.ts`.
  - `packages/types/src/acp/extensions-notifications.ts`: add `RetryStatusParamsSchema` (loose), exported through the existing barrel.
  - `docs/research/adapters/codex/CONSUMED-SURFACE.md`: rows for the `error` notification and for `TurnError.codexErrorInfo` / `additionalDetails`, marked schema-verified (codex-cli 0.163.0 `generate-json-schema`) and not live-verified. Append new rows; do not edit PR #898's CTRL-02 row.
  - `.changeset/codex-stream-failure-reconnecting.md`: patch bumps for `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui`, plus one user-facing sentence.
- Verification intent:
  - Red-before-green for each spec AC on the Codex side:
    - the stream headline under `responseTooManyFailedAttempts`
    - each `codexErrorInfo` shape decodes, with the `serverOverloaded` and `other` outcomes
    - stream text with no info
    - an envelope with info produces the same text as without it
    - `willRetry` true or false, the count-less reconnect, a foreign thread, a child thread, and a malformed notification
  - `turn_error_tests.rs` passes unedited.
  - The hub test shows the `retry_status` frame arriving with no upsert. The golden fixtures round-trip in both languages. The daemon gate (`verify-gate.sh`) passes with the lowered ratchet.
  - Focused `cargo test -p` runs for `mainframe-adapter-codex`, `mainframe-types`, `mainframe-acp` and `mainframe-server`, plus the types package's golden test. One cargo build at a time, no `CARGO_TARGET_DIR` override.

### G2: Reconnect status and two-part failure card (UI)

- kind: ui · parallel_safe: true (no file shared with G1) · depends_on: [G1] (consumes `RetryStatusParamsSchema`; rebuild `@qlan-ro/mainframe-types` first)
- Files:
  - `packages/ui/src/lib/daemon/acp-notification-router.ts`: add `RetryStatusListener = (sessionId, status: {attempt, maxAttempts?}) => void`, a `NOTIFICATIONS` row, a `ListenerSignatures` entry and `onRetryStatus`.
  - `packages/ui/src/lib/daemon/acp-client.ts` and `acp-client-defaults.ts`: add `onRetryStatus` and move the constants (D11).
  - `packages/ui/src/features/chat/controller/acp-session-attachment-types.ts`: an optional `onRetryStatus?` on the port.
  - `.../controller/retry-status-events.ts` (new): `clearsRetryStatus(update)` (D4). It decides from `sessionUpdate` and `content` alone, with no `_meta` parsing.
  - `.../controller/acp-session-listeners.ts`: wire `onRetryStatus` → `retry.status`, and dispatch `retry.cleared` on clearing updates before forwarding.
  - `.../controller/chat-thread-state.ts`:
    - `retry: { attempt: number; maxAttempts?: number } | null`, initialized to null.
    - Events `{type:'retry.status'; attempt; maxAttempts?}` and `{type:'retry.cleared'}`.
  - `.../controller/chat-thread-reducer.ts`:
    - Handles both events. `retry.cleared` and the no-op cases return the same state object.
    - Applies the lifecycle clears from D5.
  - `.../thread/retry-status.ts` (new):
    - `retryStatusLabel(retry)`: `Reconnecting (N/M)…`, `Reconnecting (N)…`, or `Reconnecting…` when attempt < 1 (spec 2.1).
    - The `useRetryStatus()` selector returns the label and `chat-retry-status-<chatId>`.
  - `.../thread/turn-phase.ts`:
    - Add the `'Reconnecting'` phase and a `reconnecting` input.
    - Priority: Stopping, then Needs your input, then Compacting, then Reconnecting, then the stream phase.
  - `.../thread/TurnStatusRow.tsx`:
    - The displayed text is the label while the phase is Reconnecting.
    - The dot is `bg-warning` for attention or reconnecting. The text stays `text-muted-foreground` unless attention.
    - Test ids and the trailing segment follow D10, using the existing `ENTER` class and `Separator`.
    - The row keeps `h-7` and `truncate`.
  - `.../messages/AssistantErrorBlock.tsx`: split at the first `\n\n`.
    - Headline: the current destructive style.
    - Remainder: its own block in `text-muted-foreground font-mono text-xs select-text`.
    - No split (no blank line, or an empty remainder) renders exactly as today.
  - Tests:
    - `lib/daemon/__tests__/acp-notification-router.test.ts`
    - a new `controller/__tests__/chat-thread-state-retry.test.ts`, covering the reducer and `clearsRetryStatus`
    - `thread/__tests__/turn-phase.test.ts`
    - `thread/__tests__/TurnStatusRow.test.tsx`
    - `messages/__tests__/AssistantMessage.test.tsx`, or a new `AssistantErrorBlock.test.tsx`
- Verification intent:
  - Red-before-green for the spec UI ACs:
    - the `(2/5)`, `(2)` and plain labels
    - the status clears on turn complete, turn fail, new content and stop
    - after a retry, the overlay-removal upsert (`content: []`), a `null`-content upsert and an omitted-content (metadata-only) upsert leave the status at Reconnecting
    - the first non-empty `agent_message` upsert that carries a `RetryMarker` clears the status at once; chunks and tool updates clear too
    - a later marked upsert does not re-enable the status (D3)
    - `Needs your input`, `Stopping` and `Compacting` win
    - a hosted group or tool row shows the text and testid once, in the trailing slot
    - a warning dot with normal-colour text
    - the card's two-part split, and unchanged single-paragraph text
    - a retry with no following upsert shows the status
  - `pnpm --filter @qlan-ro/mainframe-ui typecheck` and the types typecheck pass, plus focused vitest files. Touched files stay at 300 lines or fewer, and functions at 50 lines or fewer.

## QA intent (after review)

- Use the browser target from `.agents/test-env.sh` on run-owned ports with an isolated `MAINFRAME_DATA_DIR`. Use the mock adapter with a scratch NDJSON recording per D12.
- Capture these, in light and dark:
  - S1: the `Reconnecting (2/5)…` row, with a warning dot and normal-colour text
  - S2: the two-part failure card
- Confirm in the DOM that `chat-retry-status-<chatId>` appears during the hold and disappears on the result.
- No Playwright or Tauri suites. Tear down by port. Do not touch port 31415 or `~/.mainframe`.

## Risks

- A future daemon frame that removes content with a non-empty array would clear early. D4 keys on non-empty content, and the unit tests pin the current removal shapes (`[]`, `null`, omitted).
- A future Codex retry message without an `N/M` token shows `Reconnecting…`. This is the intended fallback.
- PR #898 merging first: G1 touches only appended regions of `tests/common/mod.rs` and `CONSUMED-SURFACE.md`. Expect at most a trivial rebase.
