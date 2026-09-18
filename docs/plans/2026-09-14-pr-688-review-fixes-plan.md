# Implementation plan: PR #688 review fixes (todo #350)

Spec: `docs/specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md`. Original plan: `docs/plans/2026-08-28-todo-350-wire-protocol-payload-grammar-plan.md`. Branch `todo/350-wire-protocol-payload-grammar`, head `a78c9f5b`.

Goal: close all 39 findings from the three reviews on PR #688 without widening the façade's surface. Ten are blockers: a dequeued prompt's reorder that the wire cannot express, a partial stream that leaves a permanent blank bubble, a plan-mode clear that resurrects the transcript, a live chunk that can overtake replay, a chat controller that keeps talking to the daemon it just left, an always-allow button that does nothing on Codex, a re-reconcile that eats optimistic sends, a leaked socket on every failed `initialize`, and a Codex question gate whose Reject is identical to Allow. The rest are ordering, lifetime, and validation defects plus the file-size cap the branch broke. Seven new spec decisions (28 to 34) are recorded as part of the work.

## Decisions taken as given

The user settled four designs before planning. They are not relitigated here.

- **D1. Queued prompts leave the transcript.** The encoder drops messages carrying `queued` metadata. Queued turns render from the `queued.snapshot` reducer state alone. A dequeue becomes a plain create at the tail. Edit and cancel of a queued prompt stay on REST, keyed by `messageId`.
- **D2. Façade attachment follows the active thread**, gated the way `subscribeLive()` is gated in `use-chat-thread-runtime.ts`. A new `_mainframe.dev/session_detach` notification drops the connection's per-chat stream and gates. Switch-back re-attaches through resume-from-cursor.
- **D3. WS upgrade auth uses `trust_proxy_client_ip`**, the rule HTTP already uses, for `/` and `/acp/{profile}`.
- **D4. Gate options are adapter-supplied.** Claude offers allow-once and reject-once, plus allow-always only when `suggestions` is non-empty. Codex approvals offer accept, acceptForSession, and decline. Codex `requestUserInput` offers its real question choices.

## Plan decisions

1. **`ControlRequest` gains `options: Option<Vec<PermissionOption>>`** in `packages/core-rs/crates/mainframe-types/src/adapter.rs`. `None` keeps today's derivation, so the Claude adapter, the mock adapter, and the decision-27 synthesis path do not change. Codex sets `Some`. `gates::parse_answer` looks the selected `optionId` up in the request's own options and maps its `kind`, instead of matching three hardcoded strings.
2. **An option carries its own effect payload.** `PermissionOption.meta` under `_mainframe.dev` may hold `{updatedInput}`, which `parse_answer` copies into the `ControlResponse` when that option is selected. That is how a plain `{optionId}` selects a real Codex question answer without the client inferring anything.
3. **`ControlResponse` gains `scope: Option<PermissionScope>`** with values `once` and `session`. `parse_answer` sets `session` when the selected option's kind is `allow_always`. Codex `resolve` maps allow plus session to `acceptForSession`. Claude ignores it and keeps using `updated_permissions`.
4. **Cache eviction gets its own notification, `_mainframe.dev/resync`.** Reusing `transcript_cleared` would blank the thread before the replay lands. The client handles `resync` by calling `reattach()` with no reducer wipe.
5. **Only the prompt dispatch is spawned.** Finding R3.6 names the `send_prompt` await as the blocking one. Parse, routing, `initialize`, `session/cancel`, `session/resume`, and gate answers stay inline, so inbound frame order is preserved. A prompt reply now goes through the connection's outbound channel and may trail the `state_update: running` for its own turn. The client tolerates that: `sendPrompt` reads only `_meta.position`, and run state comes from the reducer.
6. **The hub race has no deterministic red test.** Both reviewers established it by code-path analysis under a std mutex with no await. The red test pins frame order on a back-to-back resume-then-revision sequence. The structural fix, publishing inside the same `locked_sessions()` critical section that computes the diff, is what makes the interleaving impossible.
7. **The three Codex history asymmetries are one task, marked separable** into its own PR. The test rename in finding R3.17 is mandatory in this PR either way, so it sits in the hygiene group instead.

## Constraints

- Max 300 lines per file, 50 per function. Test files included; CLAUDE.md grants no exemption. Task 37 is the decomposition.
- `packages/core-rs/crates/mainframe-chat/src/event_handler.rs` is at 2304 lines and must not grow. New sink logic goes in new modules under `mainframe-chat/src/event_handler/`.
- Every task is test-first. A test that reproduces a finding goes in red.
- JSON columns parse through `safeJsonArray`. No `console.*` in core. Every catch logs through pino or tracing.
- Rust commands run from `packages/core-rs`.

## Established facts

Verified during the three reviews and re-checked against `a78c9f5b`. Implementers trust these instead of re-deriving them.

- `SessionState.items` is a `HashMap<String, EncodedItem>` and `diff()` compares per id with no ordering (`mainframe-acp/src/session_state.rs:28,45`). A pure permutation of the snapshot emits nothing.
- `clear_update` sends `content: Some(vec![])` with `meta: None` and forgets the item (`session_state.rs:80-95`). The client's `applyUpsert` keeps it with empty content (`acp-item-accumulator.ts:156-172`); `order` is append-only (`:77,136`).
- `strip_queued_and_move` is `remove(pos)` then `push` (`mainframe-chat/src/event_handler.rs:478-488`), called from the CLI ack (`:1096`) and the orphan sweep (`:875`). No other production path inserts mid-list; `MessageCache::append` is tail-only.
- `QueuedMessageRef` carries `message_id`, `chat_id`, `uuid`, `content`, `attachment_ids`, `timestamp` (`mainframe-types/src/chat.rs:338-348`). `queue_state` is a full snapshot on every change and the closing frame of every resume, including an empty one (`acp_ws/dispatch.rs:120-125`, pinned by `acp_ws_integration.rs:178-183`).
- `for_each_attached_session` computes updates under `locked_sessions()` and sends after the guard drops (`acp_ws/hub.rs:171-186`); `reset_session` seeds and delivers inside the guard (`hub.rs:97-110`). `dispatch_resume` reads the display snapshot (`dispatch.rs:95`) before that seed (`:109`).
- `plan_mode_handler.rs:80-87` clears the Claude session id before `clear_messages()`, so the post-wipe snapshot is always empty. `reattach()` never resets the accumulator (`acp-session-plane.ts:125-128`); the empty-refresh guard at `:199-205` refuses an `itemCount: 0` replay when the accumulator is populated.
- `on_api_retry` emits the clearing display revision before `ChatSurfaceEvent::Retry` (`event_handler.rs:1400-1411`). `attach_retry_marker` picks its carrier via `upsert_meta_slot`, which also matches `ToolCallUpdate` (`mainframe-acp/src/stream.rs:108-126`).
- `offered_options()` is a fixed allow-once / allow-always / reject-once triad (`mainframe-acp/src/gates.rs:33-56`). Codex builds every `ControlRequest` with `suggestions: Vec::new()` (`mainframe-adapter-codex/src/approval_handler.rs:168`), its `requestUserInput` arm never reads `behavior` (`:213-232`), and `resolve` never emits `acceptForSession` (`:235`). On `origin/main`, `PermissionGate.tsx:72,108` showed Always allow only when `request.suggestions.length > 0`.
- `AcpFacadeClient.connect()` assigns `this.connection` before `open()` and the handshake (`packages/ui/src/lib/daemon/acp-client.ts:128-134`); the daemon keeps the socket open on a version mismatch by design (`mainframe-acp/src/connection.rs:77-96`).
- `handleRequest` returns silently when `RequestPermissionRequestSchema` fails (`acp-notification-router.ts:104-109`); `RpcConnection.respond()` can only emit a result (`acp-rpc-connection.ts:109-111`). `gate_registry.rs` and `gates.rs` have no TTL or timeout on an outstanding gate.
- `handle_inbound` is awaited inline in the socket `select!` (`mainframe-server/src/acp_ws.rs:84-97`). Cancel travels as `session/cancel` on that same socket (`acp-client.ts:173`); on `origin/main` it was REST `POST /api/chats/:id/interrupt`.
- `getAcpFacadeClient` keys on adapter profile only and `resetAcpFacadeClients` has no production caller (`packages/ui/src/lib/daemon/acp-clients.ts:10-24`); `disposeDaemonSession` never clears it (`dispose-daemon-session.ts:17-50`). `connectPromise` is cached and the URL is resolved once at `connect()`.
- `dispatchFromPlane` runs `reconcilePendings` over `plane.userMessageContents()` on every `transcript.updated` (`acp-chat-controller.ts:270-275`). On `origin/main` the live path fed the matcher exactly one `message.added` (`chat-reconcile.ts:7-8` module doc).
- WebSocket upgrade auth uses `net::client_ip`, the leftmost-hop rule; HTTP uses `net::trust_proxy_client_ip` (`mainframe-server/src/net.rs:20-31` vs `:41-57`). `authenticate_ws_upgrade` is shared by `/` and `/acp/{profile}`.
- On `origin/main`, `display_emitter.rs` sent a full `DisplayMessagesSet` whenever `order_changed` was true. That was the only reorder repair in the legacy transport.
- `remove_mainframe_wrapper` returns its input unchanged when no close tag is present (`mainframe-adapter-claude/src/messages/message_parsing.rs:338-379`); the closed-tag case removes open tag, body, and close tag together.
- `acp-session-plane.test.ts:206` drives `plane.reattach()` and asserts the refusal T24 removes; `acp_ws_integration.rs:134` runs with no `ChatManager`.
- `docs/plans/` is gitignored (`.gitignore:53`); plan commits need `git add -f`.
- On `a78c9f5b`: Rust fmt, clippy, and tests are green in CI (`rust-port.yml`); types and UI builds are green locally; live E2E has not been run on this branch by anyone.

Finding ids below are `R1.n` for the first review, `R2.n` for the second, `R3.n` for the third, numbered in the order each review lists them.

---

## Group 1: daemon `mainframe-acp` and `acp_ws` (tasks 1 to 12)

kind: core · parallel_safe: false · depends_on: []

**Step 0, before T1.** `acp_ws_integration.rs` runs with no `ChatManager` today, so T8's and T10's red tests have nothing to drive. Build the fixture the deleted `ws_first_send_fanout.rs` had, a real `ChatManager` over the mock adapter, in `packages/core-rs/crates/mainframe-server/tests/support/`. T35 then only adds its assertion.

**T1. Queued prompts stop being transcript items** (R3.1, blocker; D1)
- Files: `packages/core-rs/crates/mainframe-acp/src/encoder.rs`.
- Red: `encoder/tests.rs::queued_messages_are_not_encoded_as_items` feeds three `DisplayMessage`s where the middle one carries `metadata["queued"] = true`, and asserts the encoded ids are exactly `["u1", "a1"]`, not `["u1", "q1", "a1"]`.
- Change: `encode()` skips any `DisplayMessage` whose metadata has `queued` equal to `true`. Nothing else moves. `strip_queued_and_move` and `is_queued` in `event_handler.rs` stay untouched, so the orphan sweep at `event_handler.rs:875` still converges: it clears the metadata, the next `emit_display` encodes that message for the first time, and the client sees a plain create at the tail.
- Verify: `cargo test -p mainframe-acp encoder::tests::queued`.
- Accept: a dequeue emits one create at the tail. History reload, whose cache still holds the message with `queued` metadata until the CLI acks it, encodes the same item set as the live stream.

**T2. Resume replays the turn state** (R2.4)
- Files: `packages/core-rs/crates/mainframe-acp/src/resume.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/ports.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`.
- Red: `resume/tests.rs::resume_replay_ends_with_the_current_turn_state` asserts the last `SessionUpdate` before the queue snapshot is `StateUpdate(Running)` when the port reports a running turn, and `StateUpdate(Idle { stop_reason: None })` when it does not.
- Change: `ResumePort` gains `is_running(session_id) -> bool`, implemented in `ports.rs` over `chat_manager::shared::is_working`, which already derives it from the `Chat` record. `dispatch_resume` appends the matching `state_update` to `ResumeReplay::updates`.
- Verify: `cargo test -p mainframe-acp resume::tests`.
- Accept: after a mid-turn reconnect the tail message carries `status: running`, so `project-messages.ts:71-79` streams the smooth reveal.

**T3. A failed apply leaves the gate answerable** (R2.5)
- Files: `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`.
- Red: `acp_ws/dispatch/tests.rs::a_failed_apply_leaves_the_gate_answerable` (new test module; `apply_gate_answer` is private to `acp_ws::dispatch`) drives `apply_gate_answer` with a `respond_to_permission` that errors, re-sends the same answer, and asserts the second attempt reaches the manager. Today it matches no pending gate.
- Change: keep `remove_gate` where it is, before the claim, so `hub.rs:237-247`'s assumption holds that an answering connection no longer holds the gate and gets no spurious `gate_resolved` during the `respond_to_permission` await. On the error path, re-insert the `PendingGate` alongside the existing `release_gate` call, using the `Option<PendingGate>` that `remove_gate` already returns (the type `hub.rs:243` relies on). `apply_gate_answer` takes `pending` by value and moves it into `parse_permission_answer`, so clone it before the move or restructure that call to borrow. The test asserts both the retry landing and the absence of a `gate_resolved` frame on the answering connection.
- Verify: `cargo test -p mainframe-server --lib acp_ws::dispatch::tests::a_failed_apply`.
- Accept: a failed answer leaves the gate open and re-answerable. The CLI is never left blocked by a transport failure.

**T4. A JSON-RPC error reply resolves the gate as a deny** (R3.7, daemon half; spec 33)
- Files: `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`, `packages/core-rs/crates/mainframe-acp/src/gates.rs`.
- Red: `acp_ws/dispatch/tests.rs::an_error_reply_to_a_gate_denies_it` sends a response with `error.code = -32602` for `gate-req-1`, and asserts the manager received a `ControlResponse` with `behavior: Deny` and `request_id: "req-1"`.
- Change: split `apply_gate_answer` so its claim-apply tail takes a ready `ControlResponse`, and give the `JsonRpcOutcome::Error` arm a deny response built from the pending request without going through `parse_permission_answer`. Log at `warn` with the client's error code.
- Verify: `cargo test -p mainframe-server --lib acp_ws::dispatch::tests::an_error_reply`.
- Accept: a client that cannot parse a gate says so and the turn ends, instead of hanging until the CLI dies.

**T5. Diff and publish share one critical section** (R1.2, blocker; R2.9)
- Files: `packages/core-rs/crates/mainframe-server/src/acp_ws/hub.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`.
- Red: `acp_ws/hub/tests.rs::a_revision_after_a_resume_deltas_against_the_replay` seeds a session with `"Hel"`, resumes with `"Hello"`, pushes a revision of `"Hello"`, and asserts the frames in order are the resume response, one replay upsert carrying `"Hello"`, then nothing. `a_revision_during_the_snapshot_await_is_buffered_not_lost` (the R2.9 case) pushes a revision to `"Hello!"` while the snapshot await is in flight, and asserts the post-seed frames are exactly one chunk appending `"!"`, never a full re-send and never a shorter replacement.
- Change: `for_each_attached_session` calls `connection.send_update` inside the `locked_sessions()` guard, so a diff cannot be computed under the lock and enqueued after it. `send_update` stays allocation plus a non-blocking channel send. For R2.9, the defect is the display snapshot from `dispatch_resume` at `dispatch.rs:95`, read before the seed at `:109`; the queue snapshot at `:104` is already computed before the lock. The fix is ordering, not a second read: `handle_resume` attaches the connection to the session before awaiting `resume_snapshot`, and the hub buffers rather than diffs revisions for a session whose stream is not yet seeded. `reset_session` seeds, delivers, then drains the buffer through `on_revision` inside the same critical section, so a revision that raced the snapshot deltas forward. Re-reading the snapshot after `reset_session` is rejected: `get_resume_snapshot` is a second async history load, and a live revision landing between that read and its push would emit a backwards patch that overwrites newer content with older.
- Verify: `cargo test -p mainframe-server --lib acp_ws::hub::tests`.
- Accept: replay and live diff cannot interleave, and a revision that raced the snapshot read converges on the same resume rather than waiting for the next one. No await is introduced under a std mutex, so `cargo clippy --all-targets -- -D warnings` stays green.

**T6. Gate and side-band notifications ride the throttle FIFO** (R2.11)
- Files: `packages/core-rs/crates/mainframe-acp/src/stream.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/hub.rs`.
- Red: `stream/tests.rs::a_gate_cannot_precede_the_tool_call_it_belongs_to` pushes a tool-call create then a raw frame at the same `now_ms`, and asserts the raw frame comes out after the tool-call update.
- Change: `Throttle.pending` becomes `Vec<ThrottledFrame>` with variants `Update(SessionUpdate)` and `Raw(String)`; `coalesce` merges only `Update`s. `SessionStream` gains `push_raw(frame_json, now_ms)` feeding the same queue. The return type change ripples through `Throttle::push`, `Throttle::flush`, `SessionStream::flush`, every `SessionStream::on_*`, `push_all`, `FacadeHub::flush_connection` at `hub.rs:123-131`, and `for_each_attached_session`'s `impl FnMut(&mut SessionStream, i64) -> Vec<SessionUpdate>` bound, which every arm of `on_chat_surface_event` satisfies. One sink helper, `FacadeConnection::send_throttled`, dispatches `Update` to `send_update` and `Raw` to the outbound channel; it is called inside the `locked_sessions()` guard T5 introduces, or raw frames reopen the T5 race. `GateRaised`, `QueueChanged`, `TranscriptCleared`, and `Compaction` go through it for attached sessions. `GateResolved` is excluded: `hub.rs:242-247` fans it to every connection holding the gate, including ones whose session is detached or never attached, and routing it per-session would drop it for them. Correct the ordering claim in the `stream.rs` module doc to state what is now true, including that exclusion.
- Verify: `cargo test -p mainframe-acp stream::tests`.
- Accept: a permission request can no longer precede its own tool call by up to 100 ms.

**T7. Gate options come from the adapter** (R3.2 and R3.5, blockers; D4)
- Files: `packages/core-rs/crates/mainframe-types/src/adapter.rs`, `packages/core-rs/crates/mainframe-acp/src/gates.rs`, `packages/types/src/adapter.ts`, `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/permission.request.json`.
- Red: `gates/tests.rs::claude_hides_allow_always_without_suggestions` asserts a `ControlRequest` with `suggestions: vec![]` and `options: None` offers exactly `["allow-once", "reject-once"]`, and that one suggestion yields `["allow-once", "allow-always", "reject-once"]`. `an_adapter_supplied_option_carries_its_own_updated_input` asserts that selecting an option whose meta holds `{"updatedInput": {"answers": ["Yes"]}}` produces a `ControlResponse` with exactly that `updated_input`. `allow_always_sets_session_scope` asserts `scope == Some(PermissionScope::Session)`.
- Change: add `ControlRequest.options` and `ControlResponse.scope` per plan decisions 1 and 3, both `skip_serializing_if = "Option::is_none"`. `offered_options(request)` returns `request.options` when present and derives the Claude set otherwise. `parse_answer` resolves the selected id against that list, maps its `kind`, and applies plan decision 2's `updatedInput` carrier. Mirror both fields in `packages/types` and update the permission fixture.
- Verify: `cargo test -p mainframe-acp gates::tests`, then `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit`.
- Accept: an unknown `optionId` still returns `UnknownOption` and is never approval. Claude's offered set matches main's.

**T8. `session_detach` and daemon-side dormancy** (R2.3, blocker; D2, spec 29)
- Files: `packages/core-rs/crates/mainframe-types/src/acp/extensions.rs`, `packages/types/src/acp/extensions-notifications.ts`, `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/session-detach.notification.json`, `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/session-detach.params.json`, `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`.
- Red: `acp_ws_integration.rs::session_detach_stops_session_updates` attaches by prompting, sends `_mainframe.dev/session_detach` for that session, and asserts the next chat-surface revision produces no frame on that socket.
- Change: add `SessionDetachParams { session_id }` to both type packages with a golden fixture pair, following the `X.notification.json` plus `X.params.json` convention. Route the notification in `handle_inbound` to `connection.forget_chat(&session_id)`, which already exists for `ChatEnded`.
- Verify: `cargo test -p mainframe-server --test acp_ws_integration session_detach`.
- Accept: a detached session leaves no `SessionStream` and no pending gate on that connection, so the hub's encode-only-when-listening guard fires again.

**T9. `initialize` is mandatory** (R3.21, spec 32)
- Files: `packages/core-rs/crates/mainframe-acp/src/connection.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`.
- Red: `acp_ws_integration.rs::a_session_method_before_initialize_is_refused` sends `session/prompt` first and asserts `error.code == -32002` with message `"initialize required"`, and that the socket stays open.
- Change: `FacadeConnection` gains a `negotiated: AtomicBool`, readable from a spawned task. `dispatch_with_prompt` takes its value and refuses every method but `initialize` while it is false. A version mismatch leaves it false, so a mismatched peer can no longer prompt, resume, or cancel.
- Verify: `cargo test -p mainframe-server --test acp_ws_integration before_initialize`.
- Accept: the handshake is load-bearing. Criterion 1's connection-stays-open branch is unchanged.

**T10. The socket loop never blocks on a slow frame** (R3.6; plan decision 5)
- Files: `packages/core-rs/crates/mainframe-server/src/acp_ws.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/dispatch.rs`.
- Red: `acp_ws_integration.rs::a_slow_prompt_does_not_delay_a_cancel` uses a mock adapter whose spawn blocks on a `tokio::sync::oneshot` barrier rather than a sleep, so the test is not timing-dependent. It prompts chat A, sends `session/cancel` for chat B, asserts the cancel reaches the manager while the prompt is still blocked, then releases the barrier.
- Change: in `handle_inbound`, the `session/prompt` arm alone is moved into a `tokio::spawn` over owned clones of `AppCtx`, `FacadeConnection`, and `DaemonInfo`. Its reply goes through `connection.send_json`. Spawned prompts serialize per session behind a `tokio::sync::Mutex` on `FacadeConnection`, because queue position and D1's tail ordering both depend on which of two concurrent prompts for one chat enqueues first. `prompt_session_id` and `ctx.facade_hub.attach` at `dispatch.rs:52-54` stay inline ahead of the spawn, which is the ordering T35's test asserts. Every other arm stays inline, so frame order on one socket is unchanged. Delete the direct-write arm's now-partial comment about replies preceding the next outbound drain and state which frames it still covers.
- Verify: `cargo test -p mainframe-server --test acp_ws_integration slow_prompt`.
- Accept: heartbeats and outbound frames keep flowing during a cold-chat start, and Stop works on every chat of the profile.

**T11. WS upgrade auth uses the trust-proxy rule** (R2.7; D3, spec 30)
- Files: `packages/core-rs/crates/mainframe-server/src/websocket.rs`, `docs/security/2026-07-11-security-audit.md`.
- Red: the `websocket.rs` test module gains `a_forged_leftmost_forwarded_for_cannot_claim_loopback`, calling the auth path with peer `127.0.0.1` and header `x-forwarded-for: 127.0.0.1, 203.0.113.7`, asserting the effective ip is `203.0.113.7` so a token is required.
- Change: `authenticate_ws_upgrade` calls `net::trust_proxy_client_ip` instead of `net::client_ip`. Both `/` and `/acp/{profile}` route through that function, so one edit covers both. Mark the `X-Forwarded-For` spoof item in the security audit doc closed, naming this PR.
- Verify: `cargo test -p mainframe-server --lib websocket::tests`.
- Accept: `session/resume` cannot serve a chat's stored history to a spoofed loopback client, and the open audit item is closed in writing.

**T12. Group 1 regression sweep**
- Files: none.
- Red: none. This task runs what the group touched.
- Change: none.
- Verify: `cargo test -p mainframe-acp`, then `cargo test -p mainframe-server --test acp_ws_integration`.
- Accept: both green with no newly ignored tests.

---

## Group 2: `mainframe-chat` and adapters (tasks 13 to 22)

kind: core · parallel_safe: false · depends_on: [group 1]

**T13. The partial overlay is owned by a session** (R3.19)
- Files: `packages/core-rs/crates/mainframe-chat/src/event_handler/partial_overlay.rs` (new), `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`.
- Red: `event_handler/partial_overlay_tests.rs::a_superseded_sessions_overlay_is_dropped` writes an overlay under session `s1`, exits session `s2`, exits `s1`, and asserts the overlay survives the `s2` exit and is gone after the `s1` exit.
- Change: move the `partial_overlays` map and `take_partial_overlay` into a new `PartialOverlays` struct keyed by chat plus session id. `on_exit` clears only its own session's overlay, above the existing session-id guard at `event_handler.rs:1128`. This also removes roughly 60 lines from `event_handler.rs`.
- Verify: `cargo test -p mainframe-chat partial_overlay`.
- Accept: a dangling overlay from a superseded session cannot survive, and `event_handler.rs` is smaller than its 2304-line start.

**T14. Command-tag stripping is streaming-safe** (R3.9)
- Files: `packages/core-rs/crates/mainframe-adapter-claude/src/messages/message_parsing.rs`.
- Red: `message_parsing::tests::an_unclosed_command_wrapper_strips_to_end_of_input` calls `strip_mainframe_command_tags` with `<mainframe-command name="review">do it` and asserts the result is exactly `""`, and with the incomplete open tag `<mainframe-command na` also asserts exactly `""`. The second case is the first chunk of a real stream. Today `remove_mainframe_wrapper` returns the input unchanged when it finds no close tag, so the raw wrapper reaches the UI. The already-closed case still yields `""`, because the wrapper removes the open tag, the content, and the close tag together. The red test must live here: `event_handler/partial_overlay_tests.rs:66` defines its own `strip_command_tags` double and would pass against the mock.
- Change: `remove_mainframe_wrapper` drops from `tag_start` to end of input on both pass-through branches, the missing close tag at `message_parsing.rs:365-368` and the not-yet-complete open tag at `:360-363`, instead of returning the text unchanged. `chat_manager/deps_event.rs:40` and `mainframe-server/src/chat_deps.rs:248` are pass-throughs and need no edit. Closed-tag behavior is unchanged.
- Verify: `cargo test -p mainframe-adapter-claude message_parsing::tests::an_unclosed_command_wrapper`.
- Accept: streamed text only grows, and the raw wrapper never reaches the UI.

**T15. `on_compact` uses a stable id** (R3.14)
- Files: `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`, `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`, `packages/core-rs/crates/mainframe-adapter-claude/src/events.rs`, `packages/core-rs/crates/mainframe-adapter-codex/src/`.
- Red: `event_handler/stable_id_characterization_tests.rs::compaction_pill_id_matches_history` drives `on_compact(Some("entry-uuid-9"))` and asserts the cached message id is exactly `"entry-uuid-9"`, the id history reconstruction uses.
- Change: `SessionSink::on_compact` takes `vendor_id: Option<&str>`. Rust has no default argument values, so every implementor changes, including the test sinks under `mainframe-chat/src/event_handler/*_tests.rs` and the mock adapter. The handler calls `transient_with_id` instead of `transient` at `event_handler.rs:1214`. Both adapters pass the transcript entry uuid.
- Verify: `cargo test -p mainframe-chat stable_id_characterization_tests::compaction`.
- Accept: compaction pills carry the same id live and on reload, for Claude and Codex.

**T16. The retry marker is recorded before the clearing revision** (R1.4)
- Files: `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`.
- Red: `event_handler/partial_overlay_tests.rs::retry_precedes_its_clearing_revision` records the chat-surface events from `on_api_retry` and asserts the order is `[Retry { attempt: 1 }, DisplayRevision]`, not the reverse.
- Change: move `notify_surface(ChatSurfaceEvent::Retry)` above the `take_partial_overlay` and `emit_display` pair at `event_handler.rs:1404`. Update the stream and hub tests that feed these events in the old order. `attach_retry_marker` (`stream.rs:108`) must skip an empty-content clearing upsert when choosing a carrier, or the marker would ride the one frame T23 makes the client delete unread. `upsert_meta_slot` (`stream.rs:119-126`) also matches `ToolCallUpdate`, so a tool call already in flight when the `api_error` fired would patch first and claim the marker, which is the "later unrelated one" R1.4 names. Narrow the rule: `attach_retry_marker` selects only a `UserMessage`, `AgentMessage`, or `AgentThought` upsert with non-empty content. Extend the test to the three-frame sequence (clearing upsert, tool-call patch, retry's first content frame) and assert the marker rides the third. `on_turn_finished` already clears an unclaimed marker, so it cannot leak into the next turn.
- Verify: `cargo test -p mainframe-chat partial_overlay_tests::retry_precedes`.
- Accept: the marker attaches to the invalidating upsert, not to a later unrelated one.

**T17. Daemon slash commands report the truth** (R3.12)
- Files: `packages/core-rs/crates/mainframe-chat/src/chat_manager/send.rs`, `packages/core-rs/crates/mainframe-server/src/acp_ws/ports.rs`.
- Red: `chat_manager/tests/chat_surface_wiring.rs::a_command_sent_mid_turn_reports_no_queue_position` sends a `/command` while a turn is running and asserts the returned `PromptAcceptance.queued_position` is `None` and that no `TurnStarted` is emitted.
- Change: `send_command` emits `TurnStarted` only when the chat was not already working. `PromptPort::send_prompt` returns `queued_position: None` on the command path, since commands bypass the queue. The bypass itself is pre-existing and stays.
- Verify: `cargo test -p mainframe-chat chat_surface_wiring::a_command_sent_mid_turn`.
- Accept: no spurious running state and no false queued position.

**T18. The partial-message probe logs its downgrade** (R3.20)
- Files: `packages/core-rs/crates/mainframe-adapter-claude/src/partial_stream.rs`.
- Red: `partial_stream::tests::a_failed_probe_logs_its_downgrade` installs a named `tracing` capture layer and asserts one `warn` record naming the executable. Use a distinct executable string per test, because the `OnceLock` cache is process-global and shared across the crate's test binary.
- Change: log at `warn` with the executable and the reason when `probe_version` fails or reports below `PARTIAL_MESSAGES_MIN_VERSION`. Keep the probe on the spawn path but share it: concurrent spawns await one in-flight warm per executable instead of each probing. Treating an unwarmed cache as `false` is rejected, because it would silently drop partial streaming for the first spawn after boot; the probe itself costs about 60 ms, and the 5 s is only the hung-probe timeout at `partial_stream.rs:242`.
- Verify: `cargo test -p mainframe-adapter-claude partial_stream`.
- Accept: the downgrade is visible in the daemon log, and only one probe runs per executable however many sessions start at once.

**T19. Codex gates are wired end to end** (R3.2 and R3.5, blockers; D4)
- Files: `packages/core-rs/crates/mainframe-adapter-codex/src/approval_handler.rs`.
- Red: `tests/approval_handler.rs::accept_for_session_reaches_codex` resolves an approval with `behavior: Allow, scope: Session` and asserts the emitted decision string is exactly `"acceptForSession"`. `a_plain_option_answer_selects_a_real_question_choice` resolves a `requestUserInput` with only an `optionId` and asserts the answers payload is exactly `{"q1": {"answers": ["Yes"]}}`. `reject_on_request_user_input_sends_no_answer` asserts a deny produces `{"answers": {}}`.
- Change: the handler builds `ControlRequest.options` from the request's own choices. Approvals offer accept, acceptForSession, and decline, mapped to allow-once, allow-always, and reject-once. `requestUserInput` maps each question choice to an option whose meta carries the matching `updatedInput`. `resolve` emits `acceptForSession` for session scope and honors `behavior` on the `requestUserInput` arm.
- Verify: `cargo test -p mainframe-adapter-codex --test approval_handler`.
- Accept: Always allow on `cargo test` does not re-prompt next turn. A generic ACP client answering with `{optionId}` picks a real choice, and Reject differs from Allow.

**T20. Cache eviction resyncs attached clients** (R3.11; spec 34, plan decision 4)
- Files: `packages/core-rs/crates/mainframe-chat/src/message_cache.rs`, `packages/core-rs/crates/mainframe-chat/src/chat_surface.rs`, `packages/core-rs/crates/mainframe-chat/src/permission_handler.rs`, `packages/core-rs/crates/mainframe-chat/src/event_handler/resync.rs` (new), `packages/core-rs/crates/mainframe-server/src/acp_ws/hub.rs`, `packages/core-rs/crates/mainframe-types/src/acp/extensions.rs`, `packages/types/src/acp/extensions-notifications.ts`, `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/resync.notification.json`, `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/resync.params.json`.
- Red: the `message_cache.rs` test module gains `append_past_the_cap_reports_an_eviction`, asserting `append` returns `true` on the 2001st message and `false` before that.
- Change: `MessageCache::append` returns whether it dropped from the front. All three call sites, `event_handler.rs:402`, `event_handler.rs:1225`, and `permission_handler.rs:185`, pass that flag to a one-line helper in the new `event_handler/resync.rs`, which raises `ChatSurfaceEvent::Resync`. The decision logic lives in `resync.rs` so `event_handler.rs` grows by two call-site lines at most. The hub sends `_mainframe.dev/resync` to attached connections.
- Verify: `cargo test -p mainframe-chat message_cache`.
- Accept: past 2000 messages an attached client is told to re-resume instead of diverging permanently.

**T21. Codex parity test and the Claude thinking-block case** (R3.15, R2.8)
- Files: `packages/core-rs/crates/mainframe-adapter-codex/tests/live_vs_history_id_parity.rs` (new), `packages/core-rs/crates/mainframe-adapter-claude/tests/live_vs_history_id_parity.rs`.
- Red: the new Codex test mirrors `mainframe-chat/src/event_handler/stable_id_characterization_tests.rs`: one recorded rollout drives both the live mapper and the history loader, and the test asserts the two id sequences are equal. It is expected to fail on the three asymmetries T22 owns, so it lands with those three cases `#[ignore]`d, each naming its finding. The Claude test gains `a_signature_only_thinking_block_claims_the_same_id_live_and_in_history`, asserting both paths produce the same id for a thinking block with a signature and no text.
- Change: none beyond the tests. R2.8 is reported as unconfirmed by its own reviewer, so this task closes it by pinning it. If `a_signature_only_thinking_block...` fails, it has found a real defect and a fix task is added to group 2 before this plan proceeds; the reconciliation follows `history_converters.rs:346-397` toward `assistant_event.rs:182-189`, which owns the live id.
- Verify: `cargo test -p mainframe-adapter-codex --test live_vs_history_id_parity`, then `cargo test -p mainframe-adapter-claude --test live_vs_history_id_parity`.
- Accept: the asymmetries are pinned rather than assumed, and R2.8 is either green or has a named fix task.

**T22. Codex history asymmetries** (R3.16, R3.17, R3.18). **Separable into its own PR.**
- Files: `packages/core-rs/crates/mainframe-adapter-codex/src/turn_lifecycle.rs`, `packages/core-rs/crates/mainframe-adapter-codex/src/history_collab_resolve.rs`, `packages/core-rs/crates/mainframe-adapter-codex/src/history_convert.rs`, `packages/core-rs/crates/mainframe-adapter-codex/src/history_load.rs`.
- Red: remove the three `#[ignore]`s from T21's test.
- Change: history resolves a sub-agent card against the turn that raised it, not the child's own `turn/completed`. History converts `dynamicToolCall` the way live rendering does. Sub-agent history uses the app-server item id for nested tool calls instead of minting `rollout-{n}`.
- Verify: `cargo test -p mainframe-adapter-codex --test live_vs_history_id_parity`.
- Accept: all three cases pass with no `#[ignore]`. All three are pre-existing on main, so this task can ship separately. The test rename in T35 is not separable.

---

## Group 3: UI client (tasks 23 to 34)

kind: ui · parallel_safe: false · depends_on: [group 1]

**Step 0, before T23.** `packages/ui/src/features/chat/controller/acp-session-plane.ts` is at 299 lines and T24, T25, and T33 all add to it. Move `attach`, `reattach`, `resume`, `resumeFromGap`, the empty-refresh guard, and the listener wiring into a new `packages/ui/src/features/chat/controller/acp-session-attachment.ts`, a pure move with the existing suite as its oracle, so no later task in this group breaches the 300-line cap. The plane keeps the accumulator, gates, and dispatch. Every line citation in T24, T25, T28, T32, and T34 that names `acp-session-plane.ts` for one of those moved symbols targets `acp-session-attachment.ts` after this step; the cited line numbers locate the code on `a78c9f5b`, not after the move. T33 then only adds dormancy logic to the new file.

**T23. An empty-content clear removes the item** (R2.1, blocker)
- Files: `packages/ui/src/features/chat/view-model/acp-item-accumulator.ts`.
- Red: `__tests__/acp-item-accumulator.test.ts::an_empty_content_upsert_removes_the_item` applies a create for `m1` with text, then an `agent_message` upsert with `content: []`, and asserts `itemsInOrder` is exactly `[]`.
- Change: `applyUpsert` deletes the id from `items` and splices it out of `order` when the incoming content is an empty array, matching `session_state.rs`'s forget-on-clear. T16 keeps the retry marker off this frame, so nothing is lost by not reading its meta; the test asserts that with a clearing upsert carrying a `retry` marker and no surviving item.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/view-model/__tests__/acp-item-accumulator.test.ts`.
- Accept: an aborted partial stream leaves no blank bubble above the real answer.

**T24. A server wipe and a full replay both reset the accumulator** (R2.2 and R1.3, blocker)
- Files: `packages/ui/src/features/chat/controller/acp-session-plane.ts`.
- Red: `__tests__/acp-session-plane.test.ts::a_transcript_clear_drops_the_old_items` seeds two items, fires `transcript_cleared`, resumes with `itemCount: 0`, applies one new message, and asserts the dispatched transcript ids are exactly `["new"]`.
- Change: `reattach()` calls `this.accumulator.reset()` and clears `firstSeenAt` before resuming, and passes an explicit `bypassGuard` through to `resume()`. The pre-reset alone would be defeated by a live update arriving between the reset and the resume response, which repopulates the accumulator and re-arms the guard at `acp-session-plane.ts:199`. The flag makes a server-initiated wipe deterministic, which is what R2.2 asks for. The guard itself is untouched: `fullReplay` marks an unknown or pre-compaction cursor fallback (`resume.rs:131-135`), not a server wipe, so yielding on it would let a gap-resume past a compaction boundary blank a populated thread. Rewrite the existing test at `acp-session-plane.test.ts:206`, which drives `plane.reattach()` and asserts the refusal this change removes.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/acp-session-plane.test.ts`.
- Accept: plan-mode clear context wipes the transcript and it stays wiped.

**T25. Reconcile matches the live echo, not the whole history** (R3.3, blocker)
- Files: `packages/ui/src/features/chat/controller/acp-chat-controller.ts`, `packages/ui/src/features/chat/controller/chat-reconcile.ts`.
- Red: `__tests__/chat-thread-controller-reconcile.test.ts::a_history_duplicate_does_not_satisfy_a_new_pending` loads a transcript already containing `"continue"`, sends `"continue"` again, and asserts the pending is still `pending` until its own echo arrives. `a_failed_send_keeps_its_failure_indicator` asserts `local.message.failed` for an unreconciled pending leaves a failed entry instead of dropping it.
- Change: `firstSeenAt` is not a durable discriminator, because `resume()` clears it at `acp-session-plane.ts:205` and every gap resume re-stamps history later than the pending's `createdAt`. Instead the plane tracks a user-message high-water count and exposes `newUserMessagesSinceLastDispatch()`, returning only the suffix that appeared since the previous `transcript.updated`; a resume re-baselines the count without emitting a reconcile batch. `dispatchFromPlane` feeds the matcher that suffix, which is what main's single `message.added` fed it. Attachment-only sends key on the pending's `clientId`, not a shared empty-text key. `local.message.failed` re-creates the entry in failed state when `!current`.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-controller-reconcile.test.ts`.
- Accept: repeating a message at turn 3 does not clear its own pending early, and a failed send is always visible.

**T26. The façade client registry clears on a daemon switch** (R1.1, blocker)
- Files: `packages/ui/src/lib/daemon/acp-clients.ts`, `packages/ui/src/lib/daemon/dispose-daemon-session.ts`.
- Red: `__tests__/dispose-daemon-session.test.ts::a_daemon_switch_drops_the_cached_facade_clients` resolves a client for profile `claude`, calls `disposeDaemonSession()`, and asserts the next `getAcpFacadeClient('claude')` is a different instance and that the first was disconnected.
- Change: `getAcpFacadeClient` keys on `getActiveDaemon().baseUrl` plus profile, read at resolve time. `DaemonTarget` is the shape `active-daemon.ts` exports; use its id field if one exists, otherwise `baseUrl`. `disposeDaemonSession` calls `resetAcpFacadeClients()` in its own try-catch with a tagged `console.warn`, matching the surrounding steps.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/daemon/__tests__/dispose-daemon-session.test.ts`.
- Accept: after switching from daemon A to B, a prompt goes to B, and no socket to A survives.

**T27. A failed initialize leaks nothing** (R3.4, blocker)
- Files: `packages/ui/src/lib/daemon/acp-client.ts`.
- Red: `__tests__/acp-client.test.ts::a_failed_initialize_closes_its_own_socket` makes the daemon answer `initialize` with a version-mismatch error, and asserts the socket was closed, `client.connected` is `false`, and a subsequent `prompt()` rejects instead of writing to an un-negotiated connection.
- Change: `connect()` builds the connection in a local, assigns `this.connection` only after the handshake and version check pass, and closes the local connection in a catch before rethrowing. `handleClose` ignores a connection that is not the current one, so a leaked socket closing later cannot tear down the healthy one.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/daemon/__tests__/acp-client.test.ts`.
- Accept: every retry leaves at most one socket, and `requireConnection()` never hands out an un-negotiated connection.

**T28. The watchdog re-arms after it fires** (R2.6)
- Files: `packages/ui/src/lib/daemon/acp-heartbeat-watchdog.ts`.
- Red: `__tests__/acp-heartbeat-watchdog.test.ts::silence_fires_repeatedly` arms a 1000 ms watchdog, advances fake timers 6000 ms with no heartbeat, and asserts `onGap` fired exactly 3 times.
- Change: `rearm()` runs after `onGap()` inside the silence timer, so a wedged but open socket keeps retrying instead of going quiet after one attempt.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/daemon/__tests__/acp-heartbeat-watchdog.test.ts`.
- Accept: the retry promised by the catch comment in `acp-session-plane.ts:216` is true for the wedged-socket case.

**T29. Requests have deadlines and close rejects them** (R3.8)
- Files: `packages/ui/src/lib/daemon/acp-rpc-connection.ts`.
- Red: `__tests__/acp-rpc-connection.test.ts::a_request_after_close_rejects` calls `close()` then `sendRequest`, and asserts the promise rejects with code `-32000`. `a_request_with_no_reply_times_out` advances fake timers past the deadline and asserts rejection.
- Change: `write()` on a null socket rejects the pending entry instead of logging and returning. `close()` calls `rejectAllPending`. `sendRequest` arms a 30 s deadline cleared on settle.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/daemon/__tests__/acp-rpc-connection.test.ts`.
- Accept: `prompt()` never hangs forever, and run state always leaves sending.

**T30. A schema-rejected gate gets an error reply** (R3.7, client half)
- Files: `packages/ui/src/lib/daemon/acp-notification-router.ts`, `packages/ui/src/lib/daemon/acp-rpc-connection.ts`, `packages/ui/src/lib/daemon/acp-client.ts`.
- Red: `__tests__/acp-notification-router.test.ts::a_malformed_permission_request_is_answered_with_an_error` feeds a `session/request_permission` with non-object `params` and asserts an error reply with code `-32602` was written for that id.
- Change: `RpcConnection` gains `respondError(id, code, message)`. `handleRequest` calls it on a parse failure instead of returning silently. `AcpFacadeClient` exposes it. The daemon arm from T4 turns that reply into a deny, so the turn ends.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/daemon/__tests__/acp-notification-router.test.ts`.
- Accept: outer-params skew produces a visible failure, not a hung turn.

**T31. Item meta parses per field** (R3.10)
- Files: `packages/ui/src/features/chat/view-model/convert-acp-item.ts`.
- Red: `__tests__/convert-acp-item.test.ts::one_bad_meta_field_does_not_drop_the_others` supplies meta with `containerId: "c1"`, `parentToolCallId: "t1"`, and `groupId: 42` (wrong type), and asserts the parsed result still has `containerId === "c1"` and `parentToolCallId === "t1"`.
- Change: `parseMeta` falls back to a per-key parse when the whole-object `safeParse` fails, keeping every key that validates and warning once for the dropped ones.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/view-model/__tests__/convert-acp-item.test.ts`.
- Accept: one wrong-typed key never orphans a subagent's children.

**T32. Queued turns render from the queue snapshot** (D1, client half)
- Files: `packages/ui/src/features/chat/controller/project-messages.ts`, `packages/ui/src/features/chat/view-model/convert-acp-user.ts`, `packages/ui/src/features/chat/controller/acp-session-plane.ts`.
- Red: `__tests__/project-messages.test.ts::queued_refs_project_as_queued_turns` sets `interactions.queued` to two refs and asserts the projected messages end with two user messages carrying `meta.queued === true`, in `timestamp` order. `a_dequeued_ref_does_not_render_twice` asserts a ref whose `messageId` already appears in `state.messages` is skipped.
- Change: `projectChatThreadMessages` appends queued turns built from `state.interactions.queued`, skipping refs whose `messageId` is already a server message, which closes the window between the dequeue's create frame and the next `queue_state` snapshot. The projection sets `meta.queued = true` on the turns it builds, so `coerceUserMeta` no longer needs to read it off the wire and the branch at `convert-acp-user.ts:32` is deleted. `sendPrompt` reconciles its own pending immediately when the prompt response reports a queue position, so an optimistic send does not sit beside its own queued turn.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/project-messages.test.ts`.
- Accept: a dequeue reorders nothing, and two clients that resumed at different moments agree. The accumulator's append-only `order` is no longer a defect, because eviction was the other permutation source and T20 resyncs it.

**T33. Dormancy on the client** (D2, client half)
- Files: `packages/ui/src/features/chat/controller/acp-session-attachment.ts` (created by this group's step 0), `packages/ui/src/features/chat/controller/acp-chat-controller.ts`, `packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts`.
- Red: `__tests__/chat-thread-controller-dormancy.test.ts::an_inactive_thread_detaches_from_the_facade` activates a thread, deactivates it, and asserts a `_mainframe.dev/session_detach` was sent and that a later `session/update` for that chat dispatches nothing. `switch_back_resumes_from_the_last_settled_item` asserts the re-attach resume carries `{type: 'item', itemId: '<last settled>'}`. `a_new_thread_attaches_once_its_remote_id_is_adopted` activates a `__LOCALID_` thread, calls `setRemoteId`, and asserts a `{type: 'start'}` resume is sent for the adopted id.
- Change: the façade attach moves out of `load()` into the same `opts.active` effect that gates `subscribeLive()`. Detach sends the notification and stops the plane's listeners. The effect depends on `[controller, active]`, not on the remote id, so a `__LOCALID_` thread is active before adoption and would otherwise never attach once `load()` stops attaching: the controller records `isActive` from the effect and `setRemoteId` triggers the attach when it is set. This is the case `acp-chat-controller.ts:136`'s comment covers today. `resumeFromGap` and `reattach` no-op while detached. The attach and detach logic lives in `acp-session-attachment.ts`, extracted by this group's step 0.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-controller-dormancy.test.ts`.
- Accept: after visiting N chats the daemon encodes and pushes for one of them. Switch-back converges from the cursor with no full replay.

**T34. Retry meta, silent catch, dead close listener, and the resync handler** (R3.22, R2.12, T20's client half)
- Files: `packages/ui/src/features/chat/controller/chat-actions.ts`, `packages/ui/src/features/chat/controller/acp-session-plane.ts`, `packages/ui/src/lib/daemon/acp-client.ts`, `packages/ui/src/lib/daemon/acp-notification-router.ts`.
- Red: `__tests__/chat-thread-controller-retry.test.ts::retrying_a_command_resends_its_command_meta` fails a `/review` send, retries it, and asserts the second `prompt()` carried `_meta['_mainframe.dev'].command.name === 'review'`, not `{}`.
- Change: the pending user message stores its `PromptSendMeta` and `retryChatMessage` re-sends it. The `.catch(() => undefined)` at `acp-session-plane.ts:109` warns instead of swallowing. Delete `AcpFacadeClient.onClose` and `CloseListener`, which have no consumer. Add the `_mainframe.dev/resync` handler, which calls `reattach()` without dispatching `transcript.cleared`.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-controller-retry.test.ts`.
- Accept: retrying a failed `/command` re-runs the command, not its literal text. No silent catch and no dead code remain on the façade path.

---

## Group 4: tests, docs, and hygiene (tasks 35 to 39)

kind: test · parallel_safe: true · depends_on: [groups 1 to 3]

**T35. Attach-on-prompt gets a test, and R3.17's test is renamed** (R3.13, R3.17)
- Files: `packages/core-rs/crates/mainframe-server/tests/acp_ws_integration.rs`, `packages/core-rs/crates/mainframe-server/tests/support/`, `packages/core-rs/crates/mainframe-adapter-codex/tests/item_types.rs`.
- Red: `acp_ws_integration.rs::prompting_subscribes_the_connection` runs with a real `ChatManager` over the mock adapter, prompts a chat, and asserts the connection receives that chat's `session/update` frames exactly once. Moving `attach` below `dispatch_with_prompt` must fail this test.
- Change: the `ChatManager` fixture is already in place from group 1's step 0, so this task adds only the assertion. Rename `dynamic_tool_call_vendor_id_matches_the_item_id_history_reload_would_use` to `dynamic_tool_call_vendor_id_is_the_live_item_id_history_does_not_render_it`, which is what it asserts. This rename ships in this PR even if T22 splits out.
- Verify: `cargo test -p mainframe-server --test acp_ws_integration prompting_subscribes`, then `cargo test -p mainframe-adapter-codex --test item_types`.
- Accept: implicit subscription on send is pinned, and no test is named after an invariant that does not hold.

**T36. Golden fixtures catch required-field drift** (R2.10)
- Files: `packages/types/src/acp/*.ts`, `packages/types/src/__tests__/acp-golden-fixtures.test.ts`.
- Red: `acp-golden-fixtures.test.ts::every_fixture_key_is_declared_in_its_schema` walks each fixture under `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/` against the schema's own `shape`, recursively, and fails on any fixture key the schema does not declare. Seed it red by adding a `sessionModes` key to `initialize.response.json` and confirming the test fails, then remove it.
- Change: a key-set comparison on parse output cannot work, because zod 4's `.loose()` passes unknown keys straight through, so the comparison is true by construction. The oracle is schema declaration instead: walk `schema.shape` (unwrapping optionals, arrays, and unions) or parse through a strictified clone. Add the walker helper. Every new fixture from T8 and T20 is covered automatically.
- Verify: `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/acp-golden-fixtures.test.ts`.
- Accept: a Rust-required field unmodelled in TS fails the suite.

**T37. Files over the caps are decomposed** (R2.13)
- Files: `packages/core-rs/crates/mainframe-acp/src/encoder.rs` (448), `packages/core-rs/crates/mainframe-acp/src/session_state.rs` (321), `packages/core-rs/crates/mainframe-server/src/acp_ws/hub.rs` (301), `packages/core-rs/crates/mainframe-acp/src/encoder/tests.rs` (758), `packages/core-rs/crates/mainframe-acp/src/session_state/tests.rs` (380), `packages/core-rs/crates/mainframe-server/src/acp_ws/hub/tests.rs` (441), `packages/e2e/tests-tauri/facade-protocol.spec.ts` (398), plus any file the earlier tasks pushed over.
- Red: none. This is a mechanical split whose oracle is the existing suites.
- Change: `encode_content` (about 140 lines) splits into per-leaf-kind helpers in a new `encoder/content.rs`. `on_chat_surface_event` (about 108 lines) splits into one handler per event family in a new `acp_ws/hub/handlers.rs`. `session_state.rs` moves `clear_update` and the variant selectors into a new `session_state/updates.rs`. Test files split along their module or describe seams.
- Verify: `cargo test -p mainframe-acp && cargo test -p mainframe-server --lib acp_ws`, then `git diff --name-only origin/main... | xargs wc -l | sort -rn | head -20`.
- Accept: no file added or grown by this branch exceeds 300 lines and no function exceeds 50. `event_handler.rs` is below 2304.

**T38. Spec decisions 28 to 34**
- Files: `docs/specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md`, `docs/API-REFERENCE.md`.
- Red: none.
- Change: append seven entries to the Decisions list in the existing style, each marked `reversible` or `hard-to-reverse`. 28: queued prompts are never session items, so live, replay, and history agree, and the queue is carried only by `_mainframe.dev/queue_state`; this sharpens decision 24. 29: façade attachment follows the active thread and `_mainframe.dev/session_detach` releases it. 30: WS upgrade auth uses the trust-proxy rule, closing the open audit item. 31: gate option lists are adapter-supplied, an option may carry its own `updatedInput`, and `ControlResponse.scope` expresses for-session allow; this implements decision 12's floor. 32: `initialize` is mandatory before any session method. 33: a JSON-RPC error reply to `session/request_permission` resolves the gate as a deny. 34: `_mainframe.dev/resync` tells a client to re-resume after a cache eviction. Document `session_detach` and `resync` in the ACP Chat Facade section of `docs/API-REFERENCE.md` at line 726, along with T10's reply-ordering change.
- Verify: a reviewer can trace every change in this plan to a decision, new or existing.
- Accept: no fix here is undocumented protocol behavior.

**T39. Changeset**
- Files: `.changeset/olive-otters-cheer.md`.
- Red: none.
- Change: append a few sentences covering the user-visible changes only: queued prompts no longer reorder the transcript, an aborted stream no longer leaves a blank bubble, plan-mode clear context stays cleared, Always allow works on Codex and is hidden where it does nothing, switching daemons no longer leaves chat traffic on the old one, and background chats stop streaming until you open them.
- Verify: `pnpm changeset status`.
- Accept: one changeset file, no second one added.

---

## Traceability

| Finding | Task | Finding | Task |
|---|---|---|---|
| R1.1 daemon switch (blocker) | T26 | R3.1 dequeue reorder (blocker) | T1, T32 |
| R1.2 chunk overtakes replay (blocker) | T5 | R3.2 Codex always-allow (blocker) | T7, T19 |
| R1.3 clear leaves accumulator (blocker) | T24 | R3.3 re-reconcile (blocker) | T25 |
| R1.4 retry ordering | T16 | R3.4 initialize leak (blocker) | T27, T9 |
| R2.1 blank bubble (blocker) | T23 | R3.5 Codex question gate (blocker) | T7, T19 |
| R2.2 plan-mode clear (blocker) | T24 | R3.6 cancel starvation | T10 |
| R2.3 no detach (blocker) | T8, T33 | R3.7 gate schema reject | T4, T30 |
| R2.4 resume turn state | T2 | R3.8 request deadline | T29 |
| R2.5 remove before claim | T3 | R3.9 tag stripping | T14 |
| R2.6 watchdog | T28 | R3.10 meta safeParse | T31 |
| R2.7 upgrade auth | T11 | R3.11 cache eviction | T20, T34 |
| R2.8 thinking-block id | T21 | R3.12 command bypass | T17 |
| R2.9 snapshot outside lock | T5 | R3.13 attach-on-prompt test | T35 |
| R2.10 loose fixtures | T36 | R3.14 on_compact id | T15 |
| R2.11 throttle bypass | T6 | R3.15 Codex parity test | T21 |
| R2.12 silent catch, dead onClose | T34 | R3.16 to R3.18 Codex history | T22, T35 |
| R2.13 size caps | T37 | R3.19 overlay ownership | T13 |
| | | R3.20 probe logging | T18 |
| | | R3.21 advisory initialize | T9 |
| | | R3.22 retry meta | T34 |

## Verification

Run in this order after group 4.

1. `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit`
2. `pnpm --filter @qlan-ro/mainframe-ui typecheck`
3. From `packages/core-rs`: `cargo fmt --check`
4. From `packages/core-rs`: `cargo clippy --all-targets -- -D warnings`
5. From `packages/core-rs`: `cargo test`
6. `pnpm --filter @qlan-ro/mainframe-ui build`
7. One E2E run at the end, batched per repo practice: `pnpm test:e2e`. Six scenarios must be covered, added to `packages/e2e/tests-tauri/facade-protocol.spec.ts` and `packages/e2e/tests-tauri/gates.spec.ts`: a partial stream interrupted by a provider retry leaves no ghost bubble; plan-mode clear context empties the transcript and it stays empty; a prompt queued behind a running turn appears last and stays last after the dequeue; a Codex gate answered with Always allow does not re-prompt on the next turn; switching daemons routes the next prompt to the new daemon; a reconnect mid-turn resumes with the tail message still streaming.

## Risks

- **T10 changes reply ordering.** A prompt reply may now trail its own `state_update: running`. Nothing in the client reads the reply for run state, but a generic ACP client could. T38 documents it.
- **T7 adds fields to `ControlRequest` and `ControlResponse`.** Both are serialized to the Claude CLI control channel. Confirm both new fields are `skip_serializing_if = "Option::is_none"` so the CLI sees no new keys.
- **T33 moves attachment out of `load()`.** Any path that assumed a loaded controller is attached will break. Grep `plane.attach` and `hasAttached` before landing.
- **T22 is pre-existing on main.** If the user splits it, T21's three `#[ignore]`s ship in this PR with their finding numbers in the attribute reason.
- **T5's race has no deterministic test.** The guarantee is structural, so a reviewer must read the critical section rather than trust the suite.
- **T20 and T34 split one finding across two groups.** The user's ordering listed cache-eviction resync under the UI group, but the daemon owns the eviction signal, so the emit lives in group 2 and the handler in group 3.
