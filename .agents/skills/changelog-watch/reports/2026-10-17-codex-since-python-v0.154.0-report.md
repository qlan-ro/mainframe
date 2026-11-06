# changelog-watch: codex python-v0.154.0 → rust-v0.159.2 (2026-10-17)

Pass 2 of 3. Tags covered: rust-v0.155.0, rust-v0.155.1, rust-v0.156.0, rust-v0.156.1, rust-v0.157.0, rust-v0.157.1, rust-v0.158.0, rust-v0.159.0, rust-v0.159.1, rust-v0.159.2

Entries seen: 1071 · risks: 4 · opportunities: 3 · relevant, no action: 58 · dropped as irrelevant: 1006

**How entries are counted.** The delta has 70 curated bullets (New Features / Bug Fixes / Documentation / Chores) and 1144 per-PR changelog lines. A PR line cited by a curated bullet in the same tag is merged into that bullet: 143 PR lines are merged that way, which leaves 1001 standalone PR lines. 70 + 1001 = 1071 entries. Each one is either mapped once or dropped. When several PR lines describe one change, the headline entry carries the risk and the other lines are listed under "no action" with a pointer to it. That keeps the totals adding up. rust-v0.157.1 has no notes: its only bullet says the PR index was empty and the compare returned 404, so that tag could not be reviewed. It is counted as dropped.

Two themes dominate this range. First, every new non-ephemeral thread now uses **paginated history** by default. Second, **compressed rollout files (`.jsonl.zst`)** now exist on disk. Both affect the history, resume, and external-session rows. The prior report (2026-08-27, rust-v0.145.0 → rust-v0.150.1) flagged both directions as high. This pass refines one of those findings and corroborates the other (see below).

## Compatibility risks

### medium — #47900 Default local threads to paginated history @owenlin0 (rust-v0.158.0)

- Checklist row: `CODEX-RPC-04`: `src/history_load.rs::load_history_inner` (resume history and child threads, `thread/read {includeTurns: true}`), `src/fork_pin.rs::pin_fork_point` (same call when pinning a fork)
- Why it threatens the row: since 0.158.0, `LocalThreadStore` creates every non-ephemeral thread as `historyMode: "paginated"`, and that includes the threads Mainframe starts with `thread/start`. In rust-v0.159.2 (`app-server/src/request_processors/thread_processor.rs`), `thread/read` with `includeTurns: true` on a paginated thread still hydrates every turn through `paginated_thread_full_turns`, so the silent truncation the prior report feared is not happening today. However, upstream now marks this path deprecated. It sends a `deprecationNotice` notification ("Full-history hydration is deprecated for paginated threads; omit `includeTurns` … then page with `thread/turns/list` and `thread/items/list`"). Mainframe drops that notification at `debug` level in `event_mapper.rs::handle_unmapped`, so nobody will see the warning before the path is removed. The paginated read also builds turns from the SQLite item projection rather than from rollout replay. That means the item mix may differ from the legacy path: `CODEX-FILE-04` records that legacy `thread/read` never returns `commandExecution` items. The paginated mix should be verified live.
- Prior report: this refines its high "paginated `thread/read`" risk. Full hydration still works on 0.159.2, so the remaining exposure is the deprecation, not truncation. The opportunity below (`thread/items/list` anchors) is the migration path. `background_paginated_rollout_migration` (legacy rollouts rewritten as paginated JSONL) exists upstream but is still `UnderDevelopment`/off, which corroborates the prior "rollout migration" risk.
- Recommended regression test: add `#[test] thread_read_of_a_paginated_thread_converts_every_turn` in `tests/history.rs`, next to `extracts_text_from_content0_text_the_thread_read_shape`. Pin a response `{"thread": {"id": "t1", "historyMode": "paginated", "turns": [<turn A: userMessage + agentMessage>, <turn B: userMessage + commandExecution + agentMessage>]}}` and assert that the converted messages include both turns' text and the command, not just that parsing succeeded.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — #46020 Add an experimental rollout compression endpoint @jif-oai (rust-v0.156.0)

- Checklist row: `CODEX-FILE-01`: `src/external_sessions.rs::parse_rollout_uuid` (accepts only a `.jsonl` suffix), `src/rollout_reader.rs::read_rollout_items`, `src/transcript.rs::locate_codex_transcript` (canonicalizes the `threads.rollout_path` from `CODEX-FILE-02`). Also affects `CODEX-FILE-04` (`load_scan_records` reads the same files).
- Why it threatens the row: upstream now compresses cold rollouts to `rollout-…-<id>.jsonl.zst` (`codex-rs/rollout/src/compression.rs`; its upstream readers handle plain and `.zst` transparently). The `rollout/compress` RPC runs a compression pass even when `features.local_thread_store_compression` is off. The app-server README states: "Clients sharing this Codex home must support compressed rollout files." Mainframe's scanner skips `.jsonl.zst` names. If `threads.rollout_path` still names the plain path after compression, `locate_codex_transcript` canonicalizes a missing file and reports `Missing`. Either way the failure is silent: compressed sessions vanish from "Resume external session", and PR scanning or history reload of those threads comes back empty. It is rated medium rather than high only because compression is off by default and the endpoint is experimental. It becomes high as soon as any client sharing `~/.codex` (for example Codex Desktop) calls `rollout/compress`, or the flag's default flips. Supporting PR lines: #44138, #44226.
- Recommended regression test: add `#[tokio::test] lists_a_compressed_rollout_as_an_external_session` in `tests/external_sessions.rs`, using the existing `write_rollout` helper plus a zstd-compressed `rollout-2026-10-17T00-00-00-<uuid>.jsonl.zst` with a `session_meta` head line. Assert that the session appears with the expected id and first prompt. Also add a unit case in `src/external_sessions_tests.rs` next to `parses_rollout_filename_uuid` pinning that `parse_rollout_uuid("rollout-…-<uuid>.jsonl.zst")` returns the uuid.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — Terminal input approval is enabled by default for commands running with elevated permissions; runtime-only grants no longer cause unnecessary reviews. (#47799, #48073) (rust-v0.158.0)

- Checklist row: `CODEX-CTRL-01`: `src/approval_handler/intake.rs::handle_request`
- Why it threatens the row: #47799 promotes `write_stdin_approval` to stable and default-on. The request arrives as the existing `item/commandExecution/requestApproval`, now with `kind: "writeStdin"` (default `"command"`). Its `itemId` is the already-running parent command's id, and a distinct `approvalId` is set (`app-server-protocol/src/protocol/v2/item.rs::CommandExecutionRequestApprovalParams` at rust-v0.159.2). `handle_request` never reads `kind` or `approvalId`. It shows the prompt as a second approval for the parent `command`, keyed to the parent's tool-use id, and nothing tells the user it is input being typed into an escalated terminal. It also always offers the full accept / accept-for-session / decline triad and ignores `availableDecisions`, which may not include accept-for-session for this kind. The session keeps working, but the user is approving something they cannot see. This applies in `default` and `acceptEdits` (where escalations happen), not in `yolo`.
- Recommended regression test: add `#[test] a_write_stdin_approval_is_presented_as_terminal_input` in `tests/approval_handler/routing.rs`. Pin `{"kind": "writeStdin", "threadId": "t", "turnId": "u", "itemId": "call_parent", "approvalId": "a1", "startedAtMs": 0, "command": "python3 repl.py", "cwd": "/w", "availableDecisions": ["accept", "decline"]}` and assert that the emitted `ControlRequest` distinguishes stdin from a command (input carries the kind) and offers only the decisions listed.
- Verify live: .claude/skills/codex-protocol-debugger/

### low — Clarify that deprecated `friendly` and `pragmatic` personality settings no longer select response styles. (#45809) (rust-v0.156.0)

- Checklist row: `CODEX-FLAG-02` / `CODEX-FLAG-03`: `src/turn_config.rs::build_turn_config`, `src/session_prompt.rs::prompt_params` (sends `personality`), `src/adapter.rs::map_codex_model` (`supportsPersonality`), and the UI mirror `packages/ui/src/features/settings/panes/providers/CodexTuningDefaults.tsx` (`PERSONALITY_OPTIONS`)
- Why it threatens the row: #44946 makes `turn/start` and `thread/resume` accept `personality: "friendly" | "pragmatic"` and ignore it. The upstream test `turn_start_accepts_deprecated_personality_override_v2` confirms nothing is rejected. Generated presets now report `supportsPersonality: false`. This is exactly FLAG-02's "stale value silently no-ops" symptom: Mainframe's settings still offer two choices that do nothing. Only `"none"` keeps an effect (it strips the catalog's built-in personality section). The issue is cosmetic and misleading, not a break.
- Recommended regression test: add `#[test] only_the_none_personality_reaches_turn_start` in `src/turn_config_tests.rs`, next to `omits_personality_summary_when_not_provided`. Pin `build_turn_config` with `personality: Some("friendly")`, assert that it produces no `personality`, and assert that `Some("none")` is passed through. Trim `PERSONALITY_OPTIONS` in the same change.
- Verify live: .claude/skills/codex-protocol-debugger/

## Adoption opportunities

- **`thread/turns/list` + `thread/items/list` with item anchors** (rust-v0.159.0, "App-server clients can paginate thread history from a specific item", #48151): this is the supported replacement for the deprecated `includeTurns: true` hydration in the first risk. A cursor can be an item anchor `{"type": "item", "itemId": …}` with a required `turnId`. It would land in `src/history_load.rs::load_history_inner` and `src/fork_pin.rs::pin_fork_point`. Size: medium.
- **Item lifecycle timestamps** (rust-v0.157.0, #47114 Preserve and expose thread item lifecycle timestamps): `thread/items/list` returns nullable `startedAtMs`/`completedAtMs` per item. These would give reloaded Codex history real per-message times. It would land in the history conversion (`src/history.rs`) once the paginated reader exists. Size: small.
- **`instant_interrupt`** (rust-v0.159.0, opt-in `instant_interrupt` lets new input steer Codex during model responses or long-running code-mode calls, #48135/#48141): new input preempts an in-flight response, which makes `CODEX-RPC-09` steering take effect immediately instead of at the next boundary. The flag is `UnderDevelopment` and off by default. It would land as a `-c features.instant_interrupt=true` override in `src/session_spawn.rs::spawn_process` (the same mechanism as `CODEX-FLAG-05`). Size: small.

## Relevant, no action

**rust-v0.159.1**

- Added GPT-6.1 Sol as the default model in the bundled catalog and Amazon Bedrock Mantle and Runtime catalogs. (#49323, #49342) — `CODEX-PROBE-02`: it arrives through `model/list`. The rust-v0.159.2 catalog gives it a 272000 window (same as `DEFAULT_CODEX_CONTEXT_WINDOW`) and efforts that are all inside `EffortLevel`. Mainframe takes a model-less chat's model from the app-server report (`CODEX-RPC-08`), not from `isDefault`.

**rust-v0.159.0**

- Approved commands retain explicit filesystem denials, and `.aws` directories are protected by default under writable roots. (#48155, #48176) — `CODEX-RPC-02b`: this tightens `workspace-write` inside the sandbox. The policy strings Mainframe sends are unchanged.
- #48508 Preserve WebSocket continuations when steering a turn — `CODEX-RPC-09`: an upstream transport fix behind `turn/steer`. The params are unchanged.

**rust-v0.158.0**

- Fixed Linux sandbox startup with nested writable roots and preserved Git metadata protections across writable roots on Linux and macOS. (#47623, #47974) — `CODEX-RPC-02b`: a sandbox fix under the `workspace-write` value `acceptEdits` already sends.
- macOS patch operations now recognize system path aliases covered by existing permissions, avoiding unnecessary approval prompts. (#47879) — `CODEX-CTRL-01`: fewer `item/fileChange/requestApproval` requests, same shape.
- Approval reviews now retry when new user input arrives, so a status question does not automatically abort a pending action. (#47819) — `CODEX-RPC-02b`: this is the Guardian/`auto_review` reviewer, which Mainframe never enables.
- Command completion events now include early output and report process-launch failures to clients. (#47529, #47665) — `CODEX-ITEM-01`: more `commandExecution` items of an existing variant. `status` is a free string and `aggregatedOutput` is already read.
- #47590 Serialize numeric custom reasoning effort as JSON numbers — `CODEX-PROBE-02`: this only affects Codex's outbound Responses request for a user-configured numeric effort. `model/list` efforts in the rust-v0.159.2 catalog are still named strings. Note: `EffortLevel` is a closed enum, so a numeric or unknown effort inside `supportedReasoningEfforts` would fail the whole `ModelListResult` parse.
- #47691 Materialize rollout persistence for pending inter-agent messages — `CODEX-FILE-01`: these are `inter_agent_communication` records that the rollout reader does not consume. The `{type, payload}` envelope is unchanged.
- #47932 Remove GPT-5.4 from bundled catalogs and preserve migration prompts — `CODEX-PROBE-02`: the picker follows `model/list`. A stale `gpt-5.4` row in `src/context_window.rs` is harmless.
- #47967 Surface Flex capacity failures as a distinct terminal error — `CODEX-EVT-01`: `TurnError` only reads `message`. Mainframe never sends `flex` (`CODEX-FLAG-02`).
- #47971 Add Pro Max plan support and update Pro display names — `CODEX-RPC-05`: `planType` is deserialized as a free string.

**rust-v0.157.0**

- Added GPT-6 Sol and Luna, including Amazon Bedrock support and migration prompts for older models. (#47332, #47347) — `CODEX-PROBE-02`: catalog entries map by the existing fields. The window is 272000 and the efforts fit `EffortLevel`. Their `send_user_message_async` messages surface as `agentMessage.delivery`/`questions`, which `AgentMessageItem` already models.
- Enabled automatic background-server startup for eligible interactive sessions, with recovery choices when server settings are incompatible. (#47179, #47318) — `CODEX-FLAG-01`: this applies to interactive TUI launches only. `codex app-server` and the `exec` title one-shot are not eligible.
- #47085 Update model catalog descriptions and GPT-5.6-Sol priority — `CODEX-PROBE-02`: data only.
- #47113 Persist thread creator identity in rollouts and SQLite — `CODEX-FILE-02`: this adds columns. The registry selects named columns from `state_5.sqlite`, and the filename is unchanged.
- #47130 Remove the `ultrafast` service tier from `gpt-5.6-sol` — `CODEX-FLAG-02`: Mainframe only ever sends `fast`, which is still in `additionalSpeedTiers`.
- #47155 Ignore stale thread-close notifications after resuming a thread — `CODEX-EVT-02`: `thread/closed` is already ignored.
- #47323 Persist resume metadata in compaction checkpoints — `CODEX-FILE-01`: these are `compacted` records that the rollout reader does not reconstruct.
- #47342 Skip stored title lookups for ephemeral forks — `CODEX-RPC-07`: Mainframe never sends `ephemeral` on `thread/fork`.
- #47353 Preserve `invalid_prompt` as a distinct error classification — `CODEX-EVT-01`: `codexErrorInfo` is not deserialized.
- #47397 Refresh bundled model metadata and instructions — `CODEX-PROBE-02`: data only.

**rust-v0.156.1**

- Choose GPT-6 Sol or GPT-6 Luna from the model picker. The rate-limit switch prompt now recommends GPT-6 Luna. (#47405) — `CODEX-PROBE-02`: a hotfix of the 0.157.0 catalog entries above.

**rust-v0.156.0**

- Preserve streamed answers and plans when turns fail, are interrupted, or receive subagent completion events. (#45549, #46867) — `CODEX-EVT-07`: an upstream fix to the delta stream Mainframe already concatenates.
- Restore Plan mode when resuming sessions and preserve thread identity and settings when editing earlier prompts. (#45519, #45845) — `CODEX-RPC-03`: Mainframe sends `collaborationMode` on every `turn/start`, so the restored mode never wins.
- #44893 Expose available access programs in model discovery — `CODEX-PROBE-02`: an additive `model/list` field that the lenient `ModelInfo` ignores.
- #44915 Remove the deprecated `thread/rollback` API — `CODEX-RPC-07c`: Mainframe never calls it. `tests/fork_from_message.rs` already asserts no `thread/rollback` request is sent.
- #44930 Embed friendly instructions in bundled GPT-5.4 and GPT-5.5 — `CODEX-FLAG-02`: part of the personality retirement, see the low risk above.
- #44935 Remove personality selection from the TUI — `CODEX-FLAG-03`: the TUI half of the same retirement, see the low risk above.
- #44946 Retire Friendly and Pragmatic personality selection — `CODEX-FLAG-02`: the implementing PR for the low risk above. The values are accepted and ignored, not rejected.
- #45506 Allow background persistence for steered user input — `CODEX-RPC-09`: server-side persistence of steered input. The `turn/steer` shape is unchanged.
- #45513 Allow setting `daybreakEnabled` when starting a thread — `CODEX-RPC-02`: a new optional `thread/start` param that Mainframe omits.
- #45529 Expose selected workspace routing in app-server account reads — `CODEX-RPC-05`: an additive `account/read` field.
- #45579 Copy current thread attachments into non-ephemeral forks — `CODEX-RPC-07`: a fork side effect. The params and response are unchanged.
- #45794 Support image references by file ID in inputs and tool outputs — `CODEX-ITEM-01`: Mainframe only sends `text`/`localImage`, and `UserContentBlock.kind` is a free string on read.
- #45805 Preserve MCP App UI metadata in tool-call events and history — `CODEX-ITEM-01`: an extra `mcpToolCall` field that is tolerated.
- #46230 Preserve configured Flex tiers without catalog or fast-mode support — `CODEX-FLAG-02`: Mainframe never sends `flex`.
- #46258 Preserve uploaded image file IDs in user message display history — `CODEX-ITEM-01`: a new content-block type on `userMessage` deserializes because `kind` is a `String`.
- #46306 Preserve bio policy errors as a distinct non-retryable error — `CODEX-EVT-01`: only `TurnError.message` is read.
- #46319 Preserve web search actions and results in exec JSON output — `CODEX-ITEM-04`: this applies to `exec --json`, which Mainframe never runs (the title one-shot reads plain stdout).
- #46328 Avoid persisting project trust for projectless directories — `CODEX-FLAG-04`: if anything, this keeps the title one-shot's temp cwd out of `config.toml` trust.
- #46482 Handle unknown error classifications and configure gateway OAuth — `CODEX-EVT-01`: `codexErrorInfo` is not deserialized.
- #46530 Gate reasoning effort updates on explicit model support — `CODEX-RPC-03`: unsupported models fall back to the request-level effort, which is still the one Mainframe sends in `collaborationMode.settings`.
- #46533 Disable reasoning summaries by default for new TUI threads — `CODEX-FLAG-02`: this applies to TUI threads only. Mainframe's `summary` vocabulary is unchanged.
- #46877 Allow subagents to request MCP elicitation input — `CODEX-RPC-10`: `elicitation_response` decides by `serverName` and does not check the thread, so a subagent's `mainframe` tool elicitation is accepted like the parent's.

**rust-v0.155.1**

- New local TUI sessions now leave reasoning summaries disabled by default, fixing request rejection by providers that do not support them. Explicit reasoning-summary settings remain respected. (#46467) — `CODEX-FLAG-02`: TUI default only. An explicit `summary` from Mainframe is still respected.

**rust-v0.155.0**

- Added Touch ID verification for MCP requests in local TUI sessions on supported Macs. (#43624, #43712, #43715) — `CODEX-CTRL-01`: user verification is a set of client→server `userVerification/*` RPCs. It is not in rust-v0.159.2's `server_request_definitions!`, so no new request reaches `handle_request`.
- Automatic approval reviews now preserve complete actions and authorization evidence more reliably, retry transient failures, and distinguish review failures from unsafe-action findings. (#44482, #44569, #44570) — `CODEX-RPC-02b`: Guardian/`auto_review` only, never enabled by Mainframe.
- #44138 Coordinate rollout compression with active thread writers — `CODEX-FILE-01`: supporting evidence for the compression risk above.
- #44226 Continue rollout searches when a compressed rollout cannot be searched — `CODEX-FILE-01`: supporting evidence for the compression risk above (compressed rollouts are real files in the sessions tree).
- #43540 Preserve the multi-agent version when forking at a turn cutoff — `CODEX-RPC-07`: fork-at-`lastTurnId` keeps working with the same params.
- #43545 Preserve fork runtime versions without loading full model context — `CODEX-RPC-07`: an internal fork optimization. The wire is unchanged.
- #43927 Rename thread artifacts to attachments in the state database — `CODEX-FILE-02`: a different table. `threads` and the `state_5.sqlite` filename are unchanged.
- #43961 Use curly apostrophes in protocol error messages — `CODEX-RPC-07b`: `map_pin_error` matches "not loaded" and "no rollout found", and neither contains an apostrophe.
- #44250 Remove retired model entries while preserving migration prompts — `CODEX-PROBE-02`: the picker follows `model/list`.
- #44392 Add opt-in model discovery for OpenAI API keys — `CODEX-RPC-05`: opt-in, and `model/list` keeps the same shape.
- #44492 Distinguish HTTP quota errors from rate limits — `CODEX-EVT-01`: only the message is read. The rate-limit windows (`CODEX-EVT-06`) are untouched.
- #44523 Bound app-server stdio shutdown and handle Unix SIGTERM gracefully — `CODEX-FLAG-01`: a gentler child shutdown. Spawn argv and env are unchanged.

## Dropped as irrelevant (1006)

Per tag: rust-v0.159.2 (1), rust-v0.159.1 (0), rust-v0.159.0 (69), rust-v0.158.0 (167), rust-v0.157.1 (1, the empty-notes placeholder), rust-v0.157.0 (105), rust-v0.156.1 (0), rust-v0.156.0 (481), rust-v0.155.1 (0), rust-v0.155.0 (182).

Categories: fullscreen TUI, transcript, composer, themes, Mermaid and math rendering, and the agent command center; voice/realtime; `/usage` analytics dashboards (backend analytics client, not app-server); `codex doctor`; the background daemon and `/daemon`; Windows, WSL, MXC, Seatbelt, and Linux sandbox internals; managed network policy and proxies; Guardian reviewer internals (the `auto_review` path Mainframe does not enable); the multi-agent `AgentControl` refactor and agent message boards; code-mode and exec-server plumbing; plugins, skills, MCP OAuth, and MCP transport; Amazon Bedrock and gateway OAuth; memory v2; credential brokering and shell snapshots; rollout-compression metrics and diagnostics (as distinct from the compression behavior above); telemetry; CI, Bazel, and release packaging; the Python SDK; and test-only changes. Also dropped as internal Rust-API changes with no app-server wire effect: #47340 (conditional interrupt, `Op` only) and #47937 (direct replies for thread-settings updates, `CodexThread` only).
