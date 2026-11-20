# changelog-watch: codex rust-v0.170.0 → rust-v0.171.0 (2026-11-20)

Entries seen: 331 · risks: 0 · opportunities: 0 · relevant, no action: 24 · dropped as irrelevant: 307

**How the entries were counted.** rust-v0.171.0 has 14 curated bullets and 339 per-PR Changelog lines (`compare/rust-v0.170.0...rust-v0.171.0`). The curated bullets cite 22 of those PRs, and each curated bullet is classified once together with the PRs it cites. That leaves 331 distinct entries: 14 curated and 317 standalone PR lines.

No compatibility risk. I fetched the generated TypeScript at both tags. These files are byte-identical: `ServerRequest`, `ThreadStartParams`, `ThreadResumeParams`, `TurnStartParams`, `TurnSteerParams`, `ThreadForkParams`, `ThreadReadParams`, `ThreadTokenUsageUpdatedNotification`, `ErrorNotification`, `TurnError`, `CommandExecutionRequestApprovalParams`, `FileChangeRequestApprovalParams`, `ToolRequestUserInputParams`, `ServerRequestResolvedNotification`, `AgentMessageDeltaNotification`, `AccountRateLimitsUpdatedNotification`, `RateLimitSnapshot`, `RateLimitWindow`, `Model`, the `ThreadStart`/`ThreadResume`/`ThreadFork`/`ThreadRead` responses, `Thread`, `Turn`, `UserInput`, `ConfigReadResponse`, `ItemStarted`/`ItemCompleted`/`TurnCompleted` notifications, and `models-manager/models.json`. Four files changed, all additively:

- `ThreadItem.ts`: `mcpToolCall` gains an optional `environmentId: string | null`.
- `McpServerElicitationRequestParams.ts` gains the same field.
- `CodexErrorInfo.ts` gains the bare string `"bioPolicy"`.
- `ServerNotification.ts` gains `thread/search/partial`.

Mainframe's Codex structs never use `deny_unknown_fields`, so the extra fields are ignored. `codex-rs/state` still opens `state_5.sqlite` (`STATE_DB_FILENAME`). The two new migrations add a `session_model_ids` table (0063) and `threads` listing indexes (0064). Neither touches `id`, `agent_nickname`, `agent_role` or `rollout_path`.

Still open from earlier runs: the rust-v0.169.1 low risk (`KNOWN_WINDOWS` has no `gpt-6.2-sol` row and still has `gpt-6.1-sol` at 272K, while both are 500K upstream). rust-v0.171.0 lists #62106 again because 0.169.1 was a patch-branch release. `models.json` is byte-identical between 0.170.0 and 0.171.0, so the size of the gap is unchanged. But `gpt-6.2-sol` has catalog priority 1 and is now the default selection, so more Codex chats will hit it whenever the wire window is missing. That is a reason to fix it sooner, not a new risk.

## Compatibility risks

None.

## Adoption opportunities

None.

## Relevant, no action

- "Added GPT-6.2 Sol and Astra to model catalogs, with Sol as the default catalog selection" (#62106) — `CODEX-PROBE-02`: the same commit as the open rust-v0.169.1 risk above. `model/list` mapping is unchanged (`Model.ts` is identical), and `models.json` is identical between the tags.
- "Kept permission profiles intact when changing working directories" (#61195) — `CODEX-RPC-02b`: Mainframe sends `sandbox`/`sandboxPolicy`, never the `permissions` profile param, and both params schemas are identical.
- "Prevented late completion events from cancelling approvals for a newer turn" (#61801) — `CODEX-CTRL-02`: fewer spurious `serverRequest/resolved` withdrawals of live prompts. The notification shape is identical.
- "Preserved earlier edits in aggregate diffs when steering an active turn" (#61820) — `CODEX-EVT-02`/`CODEX-RPC-09`: `turn/diff/updated` is in the ignored set, and `TurnSteerParams` is identical.
- "Fixed enterprise MCP sign-in for identity providers that issue ID tokens without refresh tokens" (#62129) — `CODEX-FLAG-05`: the `mainframe` server authenticates with `bearer_token_env_var`, not OAuth.
- "Added `codex exec --remote <ADDR>` to start or resume noninteractive sessions on an existing app server" (#61707) — `CODEX-FLAG-04`: a new opt-in flag. The title one-shot's argv doesn't use it.
- #61706 Refactor exec to use the shared app-server client — `CODEX-FLAG-04`: the human-output processor now takes `Option<&Config>` and keeps the same behaviour when a config is present, which is always the case for a local `exec`. The final message still goes to stdout.
- #61841 Close late command approval items when turns are interrupted — `CODEX-CTRL-02`/`CODEX-ITEM-01`: an interrupted turn's pending command approval now resolves. The `serverRequest/resolved` and `item/completed` shapes are unchanged.
- #62066 Fix turn interrupt reply ordering and shutdown handling — `CODEX-RPC-03`: `turn/interrupt {threadId, turnId}` is unchanged. Only the reply ordering is fixed.
- #62176 Expose `bioPolicy` errors in app-server v2 — `CODEX-EVT-09`: a new bare-string `CodexErrorInfo` variant. It is read as a raw `Value` and counts as no metadata, so the failed turn shows Codex's own text.
- #61257 Preserve MCP registration scope across client operations — `CODEX-ITEM-01`/`CODEX-RPC-10`: adds the optional `environmentId` to `mcpToolCall` items and elicitation params. `serverName` is still present, so the `mainframe` elicitation is still accepted.
- #61852 Broadcast read-state changes to experimental clients — `CODEX-EVT-02`: Mainframe opts into `experimentalApi`, so it now receives `thread/readState/changed` whenever a durable read receipt changes, whether or not it subscribed to the thread. `event_mapper::handle_unmapped` logs it at debug and drops it. Mainframe writes no read receipts.
- #61955 Bound item loading for paginated `read_thread` calls — `CODEX-RPC-04`: Mainframe's `thread/read {threadId, includeTurns: true}` is unpaginated, and `ThreadReadParams` and its response are identical.
- #61840 Resolve fork ancestry lazily for descending history pages — `CODEX-RPC-07`: paginated history only. Mainframe's fork reads are unpaginated `thread/read` calls.
- #61945 Allow host-started forks to inherit the root session ID — `CODEX-RPC-07`: `ThreadForkParams` and its response are identical. Mainframe sends no session-ID override.
- #61934 Allow independent app-server thread resumes to overlap — `CODEX-RPC-02`: concurrent `thread/resume` calls stop serialising. Same params.
- #61390 Preserve active additional context across compaction — `CODEX-RPC-11`: the `mainframe_orchestration` `additionalContext` entry now survives compaction. An improvement, with no shape change.
- #61727 Optimize default and attached thread listings with targeted indexes — `CODEX-FILE-02`: migration 0064 adds indexes only.
- #61730 Fix thread listing migration numbering and test setup — `CODEX-FILE-02`: migration file numbering inside `state_5.sqlite`. The filename and the `threads` columns Mainframe selects are unchanged.
- #61186 Keep plan item IDs unique after completion — `CODEX-EVT-01`: `item/plan/delta` ids stop colliding after a plan item completes.
- #62163 Move the app-server socket relay into the Codex CLI — `CODEX-FLAG-01`: removes `codex stdio-to-uds` in favour of `codex app-server proxy --sock`. Mainframe spawns `codex app-server` over stdio and uses neither.
- #61397 Add default model provider selection to the app server — `CODEX-RPC-05`/`CODEX-RPC-08`: a new `ModelProviderDefaultSet` client request that Mainframe doesn't send. `model/list` and `config/read` are unchanged.
- #61446 Add thread ID inclusion filters to `thread/list` — not consumed: Mainframe dropped `thread/list` (#430) and scans rollouts instead (`CODEX-FILE-01`).
- #62132 Stream partial thread search results and support cancellation — `CODEX-EVT-02`: the new `thread/search/partial` notification is sent only in answer to a thread search, which Mainframe never starts.

Dropped (307): 8 curated bullets — the TUI workspace (#61352, #61888, #61889, #61919, #62157), composer undo and redo (#61954), `/rc` and `/remote` (#62121), MCP status lines (#61979, #61988, #62037), TUI draft preservation (#61216), scrolling and caret fixes (#62139, #62174, #62175), the Rust 1.99.1 toolchain (#61205) and XML dependency upgrades (#62068). Also 299 standalone PR lines: TUI sidebar, transcript, status line and statusline providers (about 45); Guardian reviewers, housekeeping and evidence (about 25); Cloud threads, environments, plugins and catalogs (about 35); rollout traces and budgets (about 20); sandbox, network proxy, SSH tunnels and Windows sandbox (about 30); MCP inventory, OAuth locks and launch directories; realtime voice and audio; Code Mode catalogs and heartbeats; history and notes tools; multi-agent v2 tools (`send_message`, `spawn_agent` cap, item-boundary interrupts); model-request hooks; Bedrock, GCP and Orbit providers; telemetry and analytics; installers, Bazel, release signing; dependency bumps; and test-only changes.
