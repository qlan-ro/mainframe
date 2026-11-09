# changelog-watch: codex rust-v0.166.0 → rust-v0.167.0 (2026-11-06)

Entries seen: 111 · risks: 1 · opportunities: 2 · relevant, no action: 21 · dropped as irrelevant: 87

**How the entries were counted.** The delta has 16 curated bullets and 120 per-PR Changelog lines. The curated bullets cite 25 of those PRs, and each curated bullet is classified once together with the PRs it cites. That leaves 111 distinct entries: 16 curated and 95 standalone PR lines.

Main points: nothing here breaks a Mainframe chat on a normal install. The one risk needs a managed network proxy. Codex now withdraws network approval prompts through `serverRequest/resolved`, Mainframe never reads that notification, and the prompt stays pending after the request has gone.

I compared the app-server protocol at both tags instead of trusting the prose. A definition-level diff of `codex_app_server_protocol.v2.schemas.json` shows five changes: `UserInput`, `ContentItem`, `InitializeCapabilities`, `OtelRequirements`, and the new `ThreadSectionChangedNotification`. `model/list` shapes and `models.json` are unchanged, the state DB is still `state_5.sqlite`, and `codex-rs/state/migrations` has the same files at both tags. The installed CLI is still 0.163.0, so nothing was run live.

## Compatibility risks

### medium — Network approval prompts close when their requests end. Concurrent requests to the same endpoint prompt one at a time (#58350, #58351). (rust-v0.167.0)

- Checklist row: `CODEX-CTRL-01`. Consumers: `src/approval_handler/intake.rs::handle_request`, `src/approval_handler.rs::ApprovalHandler`, `src/event_mapper.rs::handle_notification`. `CODEX-EVT-01`/`CODEX-EVT-02` list neither arm for this notification, so it falls to the `tracing::debug!` default in `handle_unmapped`.
- Why it threatens the row: #58350 cancels the server request and emits `serverRequest/resolved` when a network request disappears. Nothing in the Codex crate reads that notification or calls `sink.on_permission_cancelled` (the only hits are pass-through wrappers), and `reject_all` runs only from `kill_inner`. `handle_result` doesn't clear permissions either, so the card outlives the turn. It stays pending until the user clicks it or the session is killed, and `idle_offload.rs` skips the chat while it is pending. Clicking is harmless, because #58350 makes Codex ignore stale decisions, and the `decision` reply goes to a request id Codex has already dropped.
- Reach: prompts of this kind need a managed network proxy, and Mainframe sends `sandbox`, so this is enterprise-managed setups only. The notification itself predates this release, so other withdrawn requests may hit the same gap. I did not check those paths.
- Recommended regression test: add `#[test] server_request_resolved_cancels_the_pending_prompt` in `tests/approval_handler/routing.rs`. Open a prompt with `item/commandExecution/requestApproval` params `{"itemId":"i1","threadId":"t1","turnId":"u1","startedAtMs":1,"networkApprovalContext":{"host":"example.com","protocol":"https"}}` and JSON-RPC id 7, deliver `serverRequest/resolved` with `{"threadId":"t1","requestId":7}`, then assert the recording sink got `on_permission_cancelled` with the Mainframe request id, and that a later `resolve` writes no reply. `pending` is keyed by nanoid, so the fix also needs a lookup by `json_rpc_id`. Assert the value, not just that the notification parsed.
- Verify live: .claude/skills/codex-protocol-debugger/. It needs a CLI at 0.167.0 or later and a managed `[permissions.network]` policy, and 0.163.0 is installed.
- Todo: #425.

## Adoption opportunities

- **Managed human checkpoints** (The app-server README covers managed network constraints under `[permissions.network]` and `prompt-user` command rules that require fresh human approval. #58045, #58182). A managed `prompt-user` rule now sends `item/commandExecution/requestApproval` with `kind: "humanCommand"`, but only to clients that initialize with `requiredHumanApproval: true`. Mainframe sends only `experimentalApi`, so the README's rule applies: with no capable connection, Codex rejects the command. That fails safe. Adoption is one field in `src/session_spawn.rs::initialize_params` plus a `kind` branch in `src/approval_handler/intake.rs::handle_request`, because `approval_triad()` offers `acceptForSession` and this kind accepts only `accept`, `decline` and `cancel`. Size: small.
- **Named third-party MCP approvals** (#58161 Include tool names and annotation hints in MCP approval metadata). Elicitation metadata now carries `tool_name` and `tool_annotations` with `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. `CODEX-RPC-10` declines every server other than `mainframe` without asking, so a third-party MCP tool that needs approval just fails. This metadata is enough to show a real permission card instead. It would land in `src/orchestration_args.rs::elicitation_response` and the approval path. Size: medium.

## Relevant, no action

**Curated bullets**

- Automatic context compaction now accounts for retained output from failed responses and responses with missing token usage data (#58404). — `CODEX-EVT-04`: core-only estimate fix, and the `tokenUsage` shape is unchanged.

**Standalone PR lines**

- #58751 Release superseded assistant text from live paginated history — `CODEX-RPC-04`: eviction touches live turn state only. All three `includeTurns: true` reads (`history_load.rs`, `history_children.rs`, `fork_pin.rs`) go to a temp app-server with no live thread, and the live read in `session_model.rs` passes `includeTurns: false`.
- #58380 Broadcast thread section changes to connected clients — `CODEX-EVT-02`: fires only after `thread/section/move`, which Mainframe never calls. Anything that does arrive hits the debug default arm.
- #58430 Add audio file references with explicit runtime rejection — `CODEX-ITEM-01`: `UserInput.Audio` gains a `fileId` form and inline audio stays `{type, url}`. `UserContentBlock` is a lenient struct (`type`, optional `text`), so history keeps parsing, and Mainframe's outbound `UserInput` has no audio variant. `ContentItem` changes the same way, and `RolloutContent` is equally lenient.
- #58434 Treat audio validation failures as non-retryable input errors — `CODEX-RPC-03`: Mainframe never sends audio.
- #58129 Persist subagent relationships before creating child storage — `CODEX-FILE-02`: this changes write order for spawn edges in the agent graph store. Mainframe's read of the `threads` columns is unaffected.
- #58410 Enable deferred tool world state by default — `CODEX-FLAG-05`: deferred namespaces, which can include the `mainframe` MCP tools, move from the `tool_search` description to the developer `<tools>` context. This changes prompt text only. The server config and tool calls stay the same.
- #58198 Centralize TOML config deserialization — `CODEX-FLAG-05`: the PR keeps the existing fallbacks for CLI validation, so the `-c mcp_servers.mainframe.*` overrides still load.
- #57978 Add per-chat leases for shared MCP connections — `CODEX-FLAG-05`: pooled stdio connections only. The `mainframe` server is streamable HTTP.
- #57848, #57850, #57870, #58125, #58159 (Code Mode bounded output and server-side truncation) — `CODEX-FILE-04`: earlier runs dropped this family, but the row's `exec` tool is Code Mode, so it counts as relevant. `code_mode_host_output_truncation` is off by default and client mode keeps output untruncated, so PR URLs in rollout output survive. Recheck if that flag ever flips, because the head and tail truncation could cut a URL.
- #58140 Route standalone web search through the thread's workspace context, #58147 Return standalone web search failures to the model, #58189 Use turn-scoped permissions for standalone web search — `CODEX-ITEM-04`: the `item.rs` diff adds only the `humanCommand` kind, so web search item shapes are unchanged.
- #57864 Allow upstream interruption when canceling Responses Lite turns — `CODEX-RPC-03`: `turn/interrupt` is unchanged.
- #58324 Treat auth reload failures as transient during token refresh, #58343 Preserve fallback token refreshes when the keyring is unreadable — `CODEX-FILE-03`: both change refresh and storage logic in `login/src/auth`. Neither entry states an `auth.json` shape change, and I did not read the patches beyond their file lists.
- #58361 Preserve model metadata origin through runtime resolution — `CODEX-PROBE-02`: internal resolution, and the `model/list` schema is unchanged.

Dropped (87): 13 curated bullets and 74 standalone PR lines.

The curated bullets are the agent command center; switching backends in the session picker; image previews; "Sign in another way" and the GCP wizard; the system proxy setting; inline patch details; saved chats across providers (#58202 changes only `codex-rs/tui`); `Ctrl+L`; leading `!`; realtime V3 transcripts; the `openai-docs` skill; DotSlash manifests; musl allocator arenas.

The standalone lines by category:

- Guardian (12): #58028, #58040, #58071, #58075, #58119, #58123, #58357, #58368, #58388, #58418, #58444, #58454. `thread/guardianReview` is new, experimental and uncalled.
- TUI (16): #57855, #57862, #57876, #57883, #57970, #58127, #58130, #58240, #58260, #58270, #58713, #58714, #58716, #58718, #58720, #58722.
- Host and embedding APIs in core, outside the app-server (5): #58378, #58390, #58395, #58406, #58411.
- Plugins, Apps, message boards and inline visualizations (7): #57861, #57974, #58165, #58341, #58352, #58428, #58436.
- Gateway and provider auth (5): #57859, #58121, #58190, #58219, #58381.
- Remote executors, environments and package updates (5): #57866, #58195, #58251, #58355, #58403.
- Rollout traces and telemetry (6): #58025, #58034, #58144, #58166, #58172, #58456. Traces are diagnostics, not rollout files, and #58166 fails startup only when tracing is enabled.
- Default-off flags, catalog prompt text, memory defaults and archiving (5): #58091, #58122, #58237, #58405, #58441. Mainframe never calls `thread/archive` or `thread/delete`.
- Windows and MXC (2): #57985, #58168.
- Bazel, CI, dependencies, advisories and tests (11): #58013, #58057, #58083, #58110, #58171, #58196, #58241, #58385, #58459, #58719, #58727.

## Carry-overs

- Still open, re-checked this run: the low on `CODEX-PROBE-02` from 2026-10-28. `models.json` is unchanged at this tag, and `KNOWN_WINDOWS` on `origin/main` still has no `gpt-6.1-terra` entry.
- `CODEX-RPC-04`: `thread/read` with `includeTurns: true` still works on 0.167.0 and still sends the deprecation notice for paginated threads. The notice has been in the source since at least 0.155.0, and the 2026-10-17 report tracks it. Mainframe ignores `deprecationNotice`, so nothing will warn us when Codex removes full hydration.
- Not re-checked this run: the 2026-10-24 high on `CODEX-ITEM-01` (generated images moved to `fileId`) and the 2026-10-17 medium on `CODEX-FILE-01` (compressed rollouts).
