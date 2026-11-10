# Todo #425: close resolved Codex prompts

Close pending approval and input cards when Codex withdraws their server request. Keep the source diff under 150 lines; use the existing cancellation sink path.

## Established facts

- `packages/core-rs/crates/mainframe-adapter-codex/src/approval_handler.rs::PendingApproval` retains `json_rpc_id`; `ApprovalHandler::pending` uses Mainframe IDs. `resolve` removes entries before replying and writes nothing for unknown IDs. `reject_all` sends decline replies, so cancellation must not use it.
- `src/approval_handler/intake.rs::ApprovalHandler::handle_request`, relative to that crate, stores command, file-change and requestUserInput entries in the same map. `src/session_lifecycle.rs::CodexSession::build_handlers` currently forwards notifications only to the event mapper and already owns the shared approval handler.
- `packages/core-rs/crates/mainframe-types/src/acp/jsonrpc.rs::RequestId` derives typed equality and untagged deserialization. Numeric `7` differs from string `"7"`. Codex re-exports this type through `src/types.rs`.
- Generated locally with codex-cli 0.163.0: `/tmp/mainframe-425-schema/ServerNotification.ts` maps `serverRequest/resolved`; `v2/ServerRequestResolvedNotification.ts::ServerRequestResolvedNotification` has `{threadId: string, requestId: RequestId}`; `RequestId.ts` permits string or number. Generation inspected successfully; no live approval scenario ran.
- [Upstream rust-v0.167.0 outgoing_message.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server/src/outgoing_message.rs), `ThreadScopedOutgoingMessageSender::resolve_server_request`, removes the callback then emits `ServerRequestResolved`. `OutgoingMessageSender::next_request_id` uses a sender-wide counter, supporting matching without a thread filter. [bespoke_event_handling.rs](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server/src/bespoke_event_handling.rs), `on_command_execution_request_approval_response`, treats disappeared network prompts specially and avoids applying stale decisions. These are source facts, not live verification.
- `src/parent_id_sink.rs::on_permission_cancelled` and `src/presentation_sink.rs::on_permission_cancelled` forward cancellation downstream. `tests/common/mod.rs::Recorder` records permissions but needs cancellation recording for assertions.

## Implementation group

- id: resolved-prompts
- kind: core
- parallel_safe: false
- depends_on: []
- files: `packages/core-rs/crates/mainframe-adapter-codex/{src/approval_handler.rs,src/session_lifecycle.rs,tests/approval_handler/routing.rs,tests/common/mod.rs,src/session.rs,src/session/request_resolved_tests.rs}`, `docs/research/adapters/codex/CONSUMED-SURFACE.md`, `.changeset/<new-bugfix>.md`.

Add a small approval-handler notification entry point for `serverRequest/resolved`. Deserialize `requestId` into the existing `RequestId`; ignore missing or invalid IDs safely. Scan pending entries by typed ID, remove the match while holding the map lock, then release the lock before calling `sink.on_permission_cancelled` with its Mainframe ID. Never invoke its reply callback. Unknown, answered and duplicate IDs do nothing without a warning. Clone the handler into `build_handlers`' notification closure and intercept this method before generic mapping. Keep other notifications unchanged.

Add regression cases in routing tests for the brief's exact numeric network-command fixture, string-ID requestUserInput, and file-change cancellation. Assert the cancelled Mainframe ID and zero replies after a later resolve. Cover answered/unknown IDs, repeated notification, numeric/string separation, and malformed IDs. Add a focused session-handler test if needed to prove the real notification closure reaches cancellation, using the existing session test modules rather than testing only the new helper.

Update CODEX-CTRL-01 or add a dedicated consumed-notification row with test anchors and schema/source receipts. Mark live verification pending, requiring codex >= 0.167.0 and managed `[permissions.network]`. Include a bugfix changeset in this group. Keep files within 300 lines and new functions within 50; split test cases into a sibling module if necessary, without expanding production scope.

## Verification intent and decisions

Run focused cancellation/routing tests and existing approval, plan-exit and ask-user-question tests. Check actual session notification routing, formatting, crate lint/type checking, and the daemon gate before the implementation commit. Inspect disk first and keep one Cargo build at a time. No TypeScript code changes are planned.

Use requestId alone for every pending kind; threadId is context only. Preserve existing unknown-resolve behavior. Do not add turn-end cleanup, change permissions/requestApproval handling, or modify UI. Do not upgrade Codex or touch the production app. Plan validation is source/schema inspection plus diff/secret checks; runtime tests belong to implementation. This plan does not claim idle-offload or managed-network live verification.
