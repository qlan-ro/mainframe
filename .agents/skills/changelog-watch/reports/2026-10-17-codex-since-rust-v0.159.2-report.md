# changelog-watch: codex rust-v0.159.2 → rust-v0.163.0 (2026-10-17)

Pass 3 of 3. Tags covered: rust-v0.159.3, rust-v0.160.0, rust-v0.160.1, rust-v0.161.0, rust-v0.162.0, rust-v0.162.1, rust-v0.163.0

Entries seen: 613 · risks: 4 · opportunities: 9 · relevant, no action: 46 · dropped as irrelevant: 554

**How the entries were counted.** The delta holds 723 bullets: 61 curated bullets (New Features / Bug Fixes / Documentation / Chores) and 662 per-PR Changelog lines. 110 PR lines repeat a curated bullet and are counted with it: 109 are cited by number in a curated bullet (this includes #51866 and #52648 in the 0.163.0 list, which the 0.162.1 bullets cite), and one is #51121, the only change in 0.160.1, whose curated bullet has no PR number. That leaves 613 distinct entries, 61 curated and 552 standalone PR lines. Every one of them is classified below or counted as dropped. A curated bullet is classified once, together with all the PRs it cites. Where a mapped line covers several PRs, the counts are per entry. The nine opportunity entries appear as five lines.

Main points for this range: steering changed twice in 0.163.0 (instant interrupts became the default, and a turn that is finishing now rejects input). A new `partial_answer` message phase arrived in 0.162.0. Personality support was retired from the model catalog. The rest touches surfaces Mainframe consumes without changing any field it reads. Two prior findings are resolved: resume now says explicit overrides win, and `aggregatedOutput` is the only command-output field that survives.

## Compatibility risks

### medium — Close input admission while a turn finishes recording (rust-v0.163.0, #53452)

- Checklist row: `CODEX-RPC-09`. Consumer: `src/turn_steer.rs::steer_inner`. On failure, `packages/core-rs/crates/mainframe-chat/src/chat_manager/send/delivery.rs::deliver_steer` removes the user's message and returns the error.
- Why it threatens the row: the row assumes `turn/steer` works whenever `current_turn_id` is set. Upstream now marks a turn as *finishing* before it drains pending input and rejects any injection into it. Mainframe keeps `current_turn_id` until `turn/completed` arrives, so every turn ends with a window where a steer comes back as JSON-RPC `{code: -32600, message: "no active turn to steer"}` (the text comes from `codex-rs/app-server/src/request_processors/turn_processor.rs`). Before this change the same input could be queued after the final batch and lost without an error, so the failure is now visible: the message disappears and an error is shown. The upstream TUI treats this exact message as a steer race (`ActiveTurnSteerRace::Missing` in `codex-rs/tui/src/app.rs`) and recovers. Mainframe has no fallback to `turn/start`.
- Recommended regression test: add `#[tokio::test] a_steer_rejected_with_no_active_turn_is_reported_as_no_active_turn` in a new `tests/turn_steer.rs`. Build it on the fake-binary pattern in `tests/send_message_input.rs::write_fake_codex`, have the fake answer `turn/steer` with `{"error":{"code":-32600,"message":"no active turn to steer"}}`, and assert that `steer` returns `AdapterError::NoActiveTurn` rather than a generic RPC error. That gives the chat layer a value it can match to fall back to `turn/start`, and the existing unit test `steer_params_name_the_turn_they_expect` stays as it is.
- Verify live: .claude/skills/codex-protocol-debugger/

### low — Send a follow-up while Codex is responding to steer it immediately. Interrupting a turn also stops active Code Mode cells and their nested tool calls. (rust-v0.163.0, #51812, #51835)

- Checklist row: `CODEX-EVT-07`. Consumer: `src/agent_message_partial.rs::handle_agent_message_delta`. This also touches `CODEX-RPC-09`.
- Why it threatens the row: #51812 turns `instant_interrupt` on by default, so a `turn/steer` now cuts off the in-flight model response. The behaviour was added in #48141, which says it "exclud[es] unfinished assistant text from the replacement request". The row pins an ordering for agent text (`item/started` → deltas → `item/completed`, where the concatenated deltas equal `item.text`). A preempted message can stream deltas and then never complete, or complete with different text. Mainframe probably handles this acceptably, because the partial overlay has one slot per `(chat, session)` and the next partial or completed block replaces it. The likely symptom is streamed text that vanishes after a steer and is missing on reload. This has not been verified live.
- Recommended regression test: add `#[test] a_preempted_item_without_completion_is_superseded_by_the_next_items_partial` in `tests/agent_message_delta.rs`, using its existing `turn_started`/`delta`/`item_completed` builders. Send deltas for item `a1` ("Hel"), then deltas for `a2` ("World") with no `item/completed` for `a1`, then `item/completed` for `a2`. Assert that the last partial is keyed `a2` and that no completed message carries `a1`'s text.
- Verify live: .claude/skills/codex-protocol-debugger/. Capture a steer sent during streaming on 0.163.0 and check whether `item/completed` is ever sent for the preempted item.

### low — Add a partial answer message phase (rust-v0.162.0, #51241)

- Checklist row: `CODEX-ITEM-01`. Consumer: `src/presentation_fields.rs::agent_phase` (payload field `phase` in `src/thread_item_variants.rs`).
- Why it threatens the row: `MessagePhase` gains `partial_answer`, which is answer text that more output or tool calls may follow. The `phase` deserializer accepts any string, so parsing does not fail. However, `agent_phase` maps only `commentary` and `final_answer` and sends everything else to `None`. A partial answer therefore reaches the UI with no phase and `final_eligible: false`. `packages/ui/src/features/chat/view-model/compact/turn-source-units.ts` treats it as neither work nor final, so in the compact view it stays outside the collapsed work group and is never selected as the answer. The text still renders. Only grouping and final-answer selection are wrong.
- Recommended regression test: extend `tests/agent_message_presentation.rs::unsupported_optional_fields_never_drop_text_or_create_a_final` with an item whose `phase` is `"partial_answer"`. Assert that the text is delivered and no final is created. When a mapping is chosen, pin that `PresentationPhase` value.
- Verify live: .claude/skills/codex-protocol-debugger/

### low — Remove legacy personality template metadata (rust-v0.162.0, #51223)

- Checklist row: `CODEX-PROBE-02` (`supportsPersonality`), with `CODEX-FLAG-02`/`CODEX-FLAG-03` (the personality vocabulary). Consumers: `src/adapter.rs::map_codex_model`, `src/session_prompt.rs::prompt_params`, and the UI gate in `packages/ui/src/features/settings/panes/providers/CodexTuningDefaults.tsx`.
- Why it threatens the row: according to the PR, `model/list` now reports `supports_personality: false` for every model. The friendly and pragmatic templates were deleted, while `turn/start` still accepts `personality` and keeps `none` as a distinct opt-out. Mainframe's settings pane renders the personality control only when `supportsPersonality` is true, so the control disappears. A personality the user saved earlier is still sent on every `turn/start` and can no longer be seen or cleared in the UI. Upstream accepts it, so nothing errors, but the setting now does nothing. #49876 ("Remove personality plumbing from the TUI", 0.161.0) points the same way.
- Recommended regression test: in `src/adapter_tests.rs`, add a sibling to `maps_efforts_default_fast_tier_personality_is_default` that pins a 0.162-shaped entry (`{"id":"gpt-6.1-sol","supportsPersonality":false,...}`) and asserts `supports_personality == None`. Then decide whether `build_turn_config` should still send a saved personality, and pin that choice with a `#[test]` in `src/turn_config_tests.rs`.
- Verify live: .claude/skills/codex-protocol-debugger/

## Adoption opportunities

- **`thread/items/read`**: fetch persisted items by `threadId`/`turnId`/`itemIds` (1 to 100 ids, experimental, behind `experimentalApi`, which Mainframe already sends) (0.163.0, #52637). Could replace the rollout scan in `src/read_tool_result_from_rollout.rs`, or refresh single items without a full `thread/read`. Size: small.
- **Durable thread read state**: `thread/readState/update` with `expectedRevision`, plus the `thread/readState/changed` notification (experimental) (0.163.0, #52337, #52350, #52384, #52395). Would sync Mainframe's unread state with other Codex clients and would land as a new `event_mapper.rs::handle_notification` arm plus a call from the chat layer. Until then, the notification goes to the "unhandled notification" debug arm, which is harmless. Size: medium.
- **Sub-agent model and effort**: `subAgentActivity` items now carry `model` and `reasoningEffort` (0.162.0, #51463). Would land in `src/collab_activity.rs::open_activity` as a label on the Activity row. The added fields are already tolerated (`tests/item_types.rs::sub_agent_activity_tolerates_an_unknown_extra_field`). Size: small.
- **Native USD in thread usage responses** (0.162.0, #50442): thread usage totals now carry `native_usage_usd_micros` alongside the credit and USD estimates. Could give Codex chats a per-thread cost figure like Claude chats have. I did not confirm the app-server method name; check it before planning. Size: medium.
- **Ultrafast service tier** (0.163.0, #51794; 0.162.0, #50472): Bedrock-only for now (GPT-6.1 Sol and Astra models). `map_codex_model` looks only for `"fast"` in `additionalSpeedTiers`, and CODEX-FLAG-02 never sends anything other than `"fast"`. Size: small.

## Relevant, no action

**rust-v0.163.0**

- Codex can run independent read-only tools in parallel, including skill, memory, and conversation-history lookups. (#52245) — `CODEX-ITEM-01`: overlapping `item/started`/`item/completed` pairs are already keyed by item id.
- Resuming a saved thread restores its permissions and network approvals, while respecting explicit overrides and current managed policy. (#53150, #53419, #53424) — `CODEX-RPC-02b`: `build_thread_request` sends no `approvalPolicy`/`sandbox` on `thread/resume`, but every `turn/start` sends both (`src/session_prompt.rs::prompt_params`), and upstream says explicit overrides win. The effective policy is Mainframe's from the first turn. The network grants that are restored were approved by the user. **This supersedes the 2026-08-27 high risk** "Resumed and forked threads now restore their active permission profile", whose open question was whether persisted values beat the values Mainframe sends. That report's suggested test, which pins that `turn/start` carries both fields, is still worth adding.
- Local commands finish promptly when a child keeps an output pipe open. Remote commands preserve late-arriving output so the final poll can still collect it. (#52652, #53331, #53622) — `CODEX-ITEM-01`: fixes when `commandExecution` completes, and the shape is unchanged.
- `codex exec` no longer prints the same file diff again after an unrelated command. (#53444) — `CODEX-FLAG-04`: the title one-shot runs read-only and makes no edits, so it produces no diff output.
- Codex now uses its standard shell executor and no longer bundles a patched `zsh`. Configurations using the retired shell flags receive a migration notice. (#52160, #52213) — `CODEX-FLAG-01`: the argv is `app-server` plus the orchestration `-c mcp_servers.*` overrides, with no shell flags.
- #51556 Complete dynamic tool lifecycles on cancellation — `CODEX-ITEM-01`: a cancelled `DynamicToolCall` now gets the `item/completed` that was previously missing, and the shape is unchanged.
- #51595 Add thread ID exclusions to `thread/list` — `CODEX-FILE-01`: `thread/list` is not consumed. External sessions come from scanning the rollout files.
- #51602 Distinguish thread listing failures from exhausted history — `CODEX-FILE-01`: `thread/list` is not consumed.
- #51611 Signal abandonment of unanswered MCP elicitations — `CODEX-RPC-10`: Mainframe answers every elicitation immediately (accept for `mainframe`, decline for any other server), so none is left waiting.
- #51872 Keep global app-server config independent of the launch directory — `CODEX-RPC-08`: `config/read` always passes `cwd`, so project layers still apply. The `-c mcp_servers.mainframe.*` overrides are command-line flags, not project config.
- #51884 Add experimental prediction forks that inherit parent context — `CODEX-RPC-07`: a separate experimental fork kind. `thread/fork {threadId, lastTurnId}` is unchanged.
- #51908 Honor the user input setting for asynchronous questions — `CODEX-ITEM-01`: a config gate on when async questions are asked. The `delivery`/`questions` fields that `presentation_fields.rs` reads are unchanged.
- #53451 Treat incomplete responses as terminal errors — `CODEX-EVT-01`: arrives as `turn/completed` with `status: "failed"`, which `turn_lifecycle.rs` already shows as an error result.
- #53654 Keep spawned children provisional until the spawn result returns — `CODEX-ITEM-03`: child threads are registered from the `spawnAgent` result's `receiverThreadIds`, so a later appearance of the child does not affect Mainframe.
- #53670 Account for token usage from incomplete responses — `CODEX-EVT-04`: more accurate totals in the same `tokenUsage` shape.
- #53678 Preserve inherited context in prediction forks — `CODEX-RPC-07`: same experimental prediction-fork family as #51884.

**rust-v0.162.0**

- #50083 Add paginated reverse lookup for thread attachments — `CODEX-RPC-04`: a new method Mainframe does not call.
- #50094 Add attachment owner lookup to the app-server — `CODEX-RPC-04`: a new method Mainframe does not call.
- #50360 Remove initial messages from session configuration events — `CODEX-EVT-03`: `codex/event/session_configured` is discarded unread along with the rest of the raw-event namespace.
- #50402 Consolidate command execution output into `aggregated_output` — `CODEX-ITEM-01`/`CODEX-FILE-04`: `stdout`, `stderr` and `formatted_output` are removed. Mainframe reads only `aggregatedOutput` (`src/thread_item_variants.rs`, `thread_item_render.rs`, `history_convert.rs`), and rollout reconstruction reads `function_call_output`/`custom_tool_call_output`, not `exec_command_end`.
- #50427 Cap persisted command output in paginated history at 64 KiB — `CODEX-FILE-04`: PR URLs come from short `gh` outputs that stay well under the cap. This is more of the output-framing churn the 2026-08-27 unified-exec risk described.
- #50435 Persist additional tool definitions in rollout history — `CODEX-FILE-01`: a new `additional_tools` response-item type, which `rollout_reader.rs` skips through its `_ => {}` arms.
- #50458 Truncate oversized MCP results in paginated thread history — `CODEX-RPC-04`: the content is shortened and the `McpToolCall` shape is unchanged. Paginated history is now clearly the persisted default, which adds weight to the open 2026-08-27 pagination risk on this row.
- #50804 Preserve review lifecycle ordering on failure — `CODEX-ITEM-01`: an ordering fix to `EnteredReviewMode`/`ExitedReviewMode`. Mainframe never starts a review.
- #51230 Make session lookup pagination stable and report listing failures — `CODEX-FILE-01`: thread listing is not consumed.
- #51249 Handle partial answers consistently across agent workflows — `CODEX-ITEM-01`: core mailbox, goal and Guardian handling of the #51241 phase, with no new wire shape beyond that risk.
- #51253 Enforce Fast and Ultra Fast policies independently — `CODEX-FLAG-02`: Mainframe only ever sends `serviceTier: "fast"`.
- #51260 Handle partial answers in realtime routing and thread search — `CODEX-ITEM-01`: realtime and search handling of the same phase. Turn summaries still exclude it.
- #51415 Expose and persist turn lineage across the app server — `CODEX-RPC-03`: `parentTurnId`/`rootTurnId` are optional on `turn/start` and are added fields on turns. Steering keeps the active turn's root, and the turn structs ignore unknown fields.
- #51492 Remove obsolete fields from persisted turn context — `CODEX-FILE-01`: Mainframe never reads `turn_context` records (`external_session_parse.rs` reads `session_meta`).

**rust-v0.161.0**

- GPT-6.1 Sol is now the default model in the bundled and Amazon Bedrock catalogs. (#49318, #49339) — `CODEX-PROBE-02`: `isDefault` is read live. `gpt-6.1-sol` is missing from `src/context_window.rs` `KNOWN_WINDOWS`, but its packaged `context_window` is 272000, the same as `DEFAULT_CODEX_CONTEXT_WINDOW`, so the fallback is correct. Add the slug at the next table refresh. This confirms the pattern behind the 2026-08-27 GPT-5.6 context-window risk.
- Amazon Bedrock supports multi-agent V2 and Ultra reasoning on compatible models; Bedrock Mantle also accepts AWS GovCloud regions. (#49345, #49813) — `CODEX-PROBE-02`: `EffortLevel` already includes `Ultra` (`packages/core-rs/crates/mainframe-types/src/adapter.rs`), which closes the 2026-08-27 max/ultra opportunity on the Rust side. One hazard remains: `EffortLevel` is a strict enum, so any effort name it does not know would fail the whole `ModelListResult`. Nothing in this range introduces one.
- Select a Cyber access program per turn with `codex exec --cyber-access-program` or the TypeScript SDK's `cyberAccessProgram` option. (#49939, #51207) — `CODEX-RPC-03`: an optional per-turn parameter Mainframe does not send.
- Approved filesystem escalation can now grant broader write access while preserving denied reads and network restrictions. Background tasks retain their originating turn's permissions. (#49353, #49880) — `CODEX-CTRL-01`: changes what an approval grants. The request and reply shapes (`{decision}`) are unchanged.
- Thread resume includes the latest committed history. Startup detects recoverable SQLite corruption earlier and preserves damaged databases as backups. (#49599, #49701) — `CODEX-RPC-02`/`CODEX-FILE-02`: a durability fix for resume. A corrupted `state_5.sqlite` being set aside only leaves the read-only nickname lookup with nothing to return, which already happens with no error.
- Authentication guidance now accounts for keyring storage instead of implying credentials always reside in `auth.json`. (#49361) — `CODEX-FILE-03`: documentation only. With keyring storage, the `auth.json` fallback finds nothing, which was already true before. The primary identity source is `account/read`.
- #49269 Preserve thread overrides and cloud policy validity during config reloads — `CODEX-RPC-02b`: keeps the policy Mainframe set explicitly from being reset.
- #49475 Complete turn abort callbacks before emitting terminal events — `CODEX-RPC-03`: an ordering fix that makes `turn/completed` (interrupted) arrive after any in-flight cleanup.
- #49480 Add experimental thread prediction protocol types — `CODEX-RPC-07`: the same prediction-fork family. No consumed type changes.
- #49785 Persist empty paginated threads when naming them — `CODEX-FILE-01`: Mainframe never sets thread names (`thread/name/updated` is ignored).
- #49806 Accept unknown Codex error variants in the app-server protocol — `CODEX-EVT-01`: upstream's own client became more lenient. Mainframe reads `turn.error.message` only.
- #49807 Enable API-key model discovery by default — `CODEX-RPC-05`: the `model/list` contents for API-key accounts may differ, and the mapped fields are unchanged.
- #49876 Remove personality plumbing from the TUI — `CODEX-FLAG-02`: TUI-only. It supports the personality risk above.

**rust-v0.160.0**

- Start sessions outside a project with workspace defaults when policy permits, and restore saved permissions when resuming. (#49160) — `CODEX-RPC-02b`: same reasoning as the 0.163.0 resume entry, since every `turn/start` carries Mainframe's policy.
- Explicit provider model catalogs no longer include unsupported bundled models or reuse stale entries after refresh failures. (#49135) — `CODEX-PROBE-02`: `model/list` contents for custom providers only.
- #49763 [0.160] Backport maintenance-line catalog and security reminder updates — `CODEX-PROBE-02`: catalog contents only.

## Dropped as irrelevant (554)

By tag (curated bullets + standalone PR lines): 0.163.0: 188 (10 + 178). 0.162.1: 2 (2 + 0). 0.162.0: 189 (14 + 175). 0.161.0: 130 (8 + 122). 0.160.1: 1 (1 + 0, with #51121 merged). 0.160.0: 43 (11 + 32). 0.159.3: 1 (1 + 0).

Categories: TUI work (`/config`, `/keymap`, `/copy`, `/side`, `/daybreak`, the Command Center, transcript selection, clickable URLs, Vim mode, paste handling, voice); Guardian and auto-review internals; Code Mode and gRPC code-mode hosts; agent message boards and multi-agent v2 runtime internals; the managed daemon and remote control; exec-server internals; Windows, MXC and Linux/macOS sandbox hardening; the network proxy; Daybreak and Cyber access routing; Bedrock and GovCloud provider plumbing; Responses retry and WebSocket transport; incremental tool catalogs and world-state context; compaction infrastructure; telemetry, analytics and OTLP; realtime voice; Bazel, release packaging and installers; dependency bumps; and test-only changes.
