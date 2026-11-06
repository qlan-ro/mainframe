# changelog-watch: claude 2.1.295 → 2.1.302 (2026-10-17)

Pass 5 of 5. Versions covered: 2.1.296, 2.1.299, 2.1.300, 2.1.301, 2.1.302 (the delta has no 2.1.297 or 2.1.298 entries).

Entries seen: 471 · risks: 3 · opportunities: 1 · relevant, no action: 53 · dropped as irrelevant: 414

The installed CLI is 2.1.302, so every risk below is live now, not pending an upgrade.

Two checks were run against that binary while classifying. First, a live `claude -p "/usage"` capture plus a string search of the binary showed that the 2.1.299 `/usage` warnings are behaviour lines printed below the "What's contributing" anchor. The parser stops at that anchor, so this entry moved from risk to no-action. Second, a 2.1.302 transcript in `~/.claude/projects/` confirmed the shape of the 2.1.300 request-recording change (see the low risk below).

Checklist drift noticed in passing:

- `CLAUDE-FLAG-01` lists `--permission-mode <default|acceptEdits|bypassPermissions|plan>`, but `src/session_controls.rs::execution_mode_cli` also maps `ExecutionMode::Auto` to `"auto"`, and `src/session_tests_spawn_part_1.rs::auto_mode_passes_permission_mode_auto` pins it.
- `CLAUDE-EVT-01` cites `src/events.rs::handle_system_event`, but the function is defined in `src/event_system.rs`. `events.rs` only calls it.
- `CLAUDE-FILE-03` does not cite `src/external_session_enrich.rs::enrich_session`, which is the code that actually reads the transcripts.

## Compatibility risks

### medium — Changed fork subagents (`subagent_type: "fork"`) to be on by default in `claude -p`, the Agent SDK, the desktop app and VS Code, as they already are in the terminal; `CLAUDE_CODE_FORK_SUBAGENT=0` turns them off, and `claude mcp serve` never offers them (2.1.302)

- Checklist row: `CLAUDE-FILE-04` — `src/history_subagents.rs::{capture_agent_id_mapping, collect_subagent_assistant_blocks}`
- Why it threatens the row: this escalates the 2.1.232 medium risk from pass 2. That risk covered interactive sessions only. Fork subagents are now the default on the stream-json path that Mainframe itself spawns. A fork inherits the parent conversation. If its sidechain JSONL records any of that inherited context under the fork's `agentId`, `collect_subagent_assistant_blocks` will inline the parent's own turns under the fork's Agent tool_use, and a resumed chat will show the conversation twice. If the fork links back differently, its output will be orphaned instead. No local transcript has a fork spawn yet, so neither shape is confirmed.
- Recommended regression test: add `#[test] fork_subagent_sidechain_inlines_only_its_own_turns` in `src/history_subagents_tests.rs`, next to `capture_agent_id_mapping_links_agent_to_tool_use`. Feed it a sidechain captured from a 2.1.302 `subagent_type: "fork"` spawn, and assert two things: the fork's `agentId` resolves to the parent Agent tool_use id, and the inlined child blocks are exactly the fork's own assistant blocks, with no copies of the parent's turns.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed SDK and headless sessions staying in auto mode after the host switched to a model that doesn't support auto mode (2.1.299)

- Checklist row: `CLAUDE-CTRL-03` — `src/session_controls.rs::{set_model, execution_mode_cli}`, with the read side in `src/event_system.rs::handle_system_event`
- Why it threatens the row: Mainframe sends `set_permission_mode` with `"auto"` and `set_model` as separate requests. It never reads the mode back. `handle_system_event` acts on `status` only when it is `"compacting"`, and nothing in the adapter reads `permissionMode`. After this fix, switching an Auto chat to a model without auto support makes the CLI quietly drop to another mode while Mainframe still shows Auto. The user then gets permission prompts the badge says should not happen. Before 2.1.299 the CLI stayed in auto and the two sides agreed.
- Recommended regression test: add `#[test] a_status_event_with_a_new_permission_mode_reports_the_cli_side_mode_change` in `src/events_tests_init.rs`. Pin the event the CLI emits after the downgrade, expected to be `{"type":"system","subtype":"status","status":null,"permissionMode":"default"}` (confirm the carrier live), and assert that the sink receives the mapped `ExecutionMode::Default`. This test lands with the consumer it exercises; today there is no consumer.
- Verify live: .claude/skills/claude-protocol-debugger/

### low — Changed local session transcripts to also record each API request's system prompt, tools and parameters, so a transcript you choose to share can reproduce a request exactly (2.1.300)

- Checklist row: `CLAUDE-FILE-03` — `src/external_sessions.rs::scan_lite_candidates`, with the read in `src/external_session_enrich.rs::enrich_session` (not cited by the row)
- Why it threatens the row: verified on a 2.1.302 transcript. The change adds three new entry types: `api-request-shape` (about 42 KB, keys `shape` and `shapeHash`), `api-request-blob` (23–55 KB, keys `hash` and `message`), and `api-request`. History is safe: `src/history_converters.rs` skips anything that is not `user` or `assistant`, and `belongs_to_session` still finds `sessionId` on these lines. The exposure is `enrich_session`. It reads a 64 KB head and a 64 KB tail, and a single blob line can now fill most of the tail window. When the tail holds only partial blob or shape lines, the `customTitle` and `aiTitle` entries are not parsed, and the external-session picker falls back to the first prompt. Transcripts also grow (the sampled files were 1–4 MB), and history load and the `CLAUDE-FILE-09` snapshot copy both read the whole file.
- Opportunity, inline: the `api-request-shape` records give Mainframe the exact system prompt and tool list behind each request. They could back a "what did this request send" inspector. Size: medium.
- Recommended regression test: add `#[test] keeps_the_ai_title_when_the_tail_is_dominated_by_api_request_blobs` in `src/external_session_enrich_tests.rs`, next to `uses_custom_title_over_ai_over_first_prompt`. Write an `ai-title` entry followed by a 60 KB `{"type":"api-request-blob","hash":…,"message":…}` line and an `api-request` line, then assert `title == Some("<the ai title>")`, not the first prompt.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- `CLAUDE_CODE_AUTO_MODE_MODEL` (2.1.302) picks the model for the client-side auto-mode classifier. Mainframe already supports Auto, and CLIProxy sessions run against a proxy that serves no Haiku. Setting this variable alongside the endpoint env would give proxy sessions in Auto a classifier model the proxy actually serves. It would land in `src/cliproxy.rs::resolve_env` (`CLAUDE-ENV-01`). Size: small.

## Relevant, no action

**2.1.302**

- Fixed a "Prompt is too long" error when stopping a turn while the conversation was being compacted — `CLAUDE-CTRL-03`: an upstream fix on the interrupt path; the `interrupt` request Mainframe sends is unchanged.
- Fixed MCP servers showing no tools, or every tool call failing, when the server negotiates protocol version 2026-07-28 but omits `resultType`, `ttlMs` or `cacheScope` — `CLAUDE-FLAG-04`: Mainframe's server (`packages/core-rs/crates/mainframe-orchestration/src/protocol.rs`) negotiates at most 2025-11-25.
- Improved auto mode with the server-side classifier: a conversation too long for the safety check is now compacted, instead of every checked tool call being denied — `CLAUDE-EVT-01`: the compaction arrives as the `compacting` status and `compact_boundary` that Mainframe already handles.
- Changed `claude -p` and Agent SDK sessions with no permission mode to start in `default` mode on third-party providers, with telemetry off or on a fresh install; `--permission-mode auto` keeps auto — `CLAUDE-FLAG-01`: Mainframe always passes `--permission-mode`.
- Changed the desktop app and VS Code to always run the main conversation's subagents in the background, as the terminal does, rather than let Claude choose; a subagent's own Agent calls in `claude -p`, the Agent SDK, the desktop app and VS Code now run in the foreground by default — `CLAUDE-EVT-01`: both the foreground path (`parent_tool_use_id`) and the background path (`task_*`) are already handled; only the default for nested calls moved.

**2.1.301**

- Fixed the `fable` (and `best`) model alias erroring on the Anthropic API when the newest Fable model is not available to your organization: Claude Code now retries once on the previous Fable model — `CLAUDE-PROBE-02`: the retry happens inside the CLI; the session keeps running, and `message.model` reports what actually ran.
- Fixed a tool call cut off by a message sent mid-turn during its permission check being reported to the model as rejected by the user — `CLAUDE-IO-03`: this changes only what the model is told; the steer envelope and the pending-permission handling are unchanged.
- Fixed a case where switching to a model with a smaller context window could spend usage credits on a summary by the previous model without asking first — `CLAUDE-CTRL-03`: an upstream fix behind `set_model`; no wire change.
- Fixed conversations being compacted over and over, on a model you didn't pick, behind an LLM gateway whose responses name a different model than the one requested — `CLAUDE-ENV-01`: an upstream fix on exactly the CLIProxy path, which helps proxy sessions.
- Fixed the permission prompt for a plugin or skill hook's `ask` decision not showing which plugin or skill the hook comes from — `CLAUDE-CTRL-01`: `decision_reason` is read with `as_str`, so extra source text rides along, and a reshaped value only drops the reason.
- Improved switching to a model with a smaller context window: a conversation too long for the new model is now summarized by the previous model first — `CLAUDE-EVT-01`: the summary arrives as ordinary compaction events.

**2.1.300**

- Fixed the first transcript entry written after resuming a session being lost when a crash had cut the transcript's last line short — `CLAUDE-FILE-09`: Mainframe's snapshot copy already trims a trailing partial line.
- Fixed `/branch` dropping messages, and `claude purge` skipping subfolder projects, when they contain a Unicode line or paragraph separator (U+2028, U+2029) — `CLAUDE-FILE-09`: Mainframe forks with its own snapshot and splits on `\n` only; it does not use `/branch`.
- Fixed a conversation failing on every turn with a 400 error when the API rejected an MCP tool's input schema; Claude Code now sends that tool without parameters for the rest of the conversation — `CLAUDE-FLAG-04`: a resilience fix; Mainframe's tool schemas are accepted.
- Fixed resuming a headless or Agent SDK session losing the recent messages a compaction had kept, when the compaction followed a reply cut at the output token limit (compactions from this version on) — `CLAUDE-FILE-04`: Mainframe rebuilds history from the raw JSONL, not from the CLI's resume chain.
- Fixed Claude not being told about an MCP server's tools and instructions until its next tool call, when the server finished connecting after a compaction — `CLAUDE-FLAG-04`: an upstream fix; the injected server config is unchanged.
- Fixed resuming a headless or Agent SDK session losing its compaction summary or bringing back pre-compaction history, when the compaction followed a retried or unfinished reply in the same turn — `CLAUDE-EVT-03`: an upstream fix; `isCompactSummary` handling is unchanged.
- Changed exit to force-kill background commands still running 1.5 seconds after being asked to stop; in fullscreen mode they could previously be left running — `CLAUDE-FILE-08`: outside fullscreen they were already killed, and the liveness sweep handles tasks that have exited.
- Changed large requests to api.anthropic.com to use gzip compression even when telemetry is disabled; set `CLAUDE_CODE_GZIP_REQUEST_BODIES=0` to turn it off — `CLAUDE-ENV-01`: applies only to api.anthropic.com, not the proxy base URL.
- Changed hooks: `updatedInput` from PreToolUse and PermissionRequest hooks is now validated like Claude's own input: unknown keys are dropped, and input the tool rejects denies the call — `CLAUDE-CTRL-04`: applies only to hook output; Mainframe answers through the stdio permission-prompt tool.

**2.1.299**

- Added `/usage` warnings for max effort, workflows, always-on context and large tool results — `CLAUDE-PROBE-03`: the binary shows these as behaviour lines ("% of your usage was at max effort", "% of your usage went to always-on context over 40k tokens") in the section below "What's contributing", and `parse_claude_usage` stops at that anchor. A live 2.1.302 capture still parses into all three windows. This continues the run of `/usage` changes flagged high in passes 2 and 3 (2.1.236, 2.1.243); this one is harmless.
- Added idle compaction in the terminal: a 200K+ token conversation left idle for about 54 minutes is compacted before its one-hour prompt cache expires, so your next message doesn't reprocess it all — `CLAUDE-EVT-01`: terminal only; if it ever reaches stream-json, it arrives as a normal compaction.
- Added `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` to change idle compaction's 200K-token minimum; `"idleCompaction": false` in settings.json turns it off. Both need v2.1.290 or later — `CLAUDE-EVT-01`: tunes the terminal-only feature above.
- Added a one-time note when plan mode won't ask before most edits or commands because bypass permissions is available — `CLAUDE-FLAG-01`: the always-on `--allow-dangerously-skip-permissions` already triggers the plan-plus-bypass step-2a allow documented in `docs/research/adapters/claude/PERMISSIONS.md`; the note is new, the behaviour is not.
- Fixed sessions on a gateway-specific model name behind a custom `ANTHROPIC_BASE_URL` ending with "Prompt is too long · automatic compaction failed" near 200K tokens instead of sending the request — `CLAUDE-ENV-01`: an upstream fix that helps proxy sessions.
- Fixed memory growing without bound when debug output goes to stderr and the parent process stops reading it — `CLAUDE-IO-01`: Mainframe drains stderr continuously.
- Fixed document blocks being dropped from your own message sent while Claude is working — `CLAUDE-IO-03`: Mainframe sends only `text` and `image` blocks.
- Fixed streams through a custom `ANTHROPIC_BASE_URL` being aborted after 180 seconds with no data arriving; they now wait 300 seconds, whether or not feature flags are loaded — `CLAUDE-ENV-01`: a longer timeout only helps proxy sessions.
- Fixed `/usage`, the approaching-limit warning (terminal and VS Code) and the status line sometimes showing more than 100% used (anthropics/claude-code#92238) — `CLAUDE-PROBE-03`: `parse_percent` reads the digits either way; capping keeps the value in range.
- Fixed deny and ask rules for an MCP server (`mcp__<server>`) not applying when the server's normalized name contains a double underscore — `CLAUDE-FLAG-04`: the server is named `mainframe`, with no `__`.
- Fixed long conversations losing newly attached images on every turn after one oversized image was refused by the API — `CLAUDE-IO-02`: an upstream fix; the envelope is unchanged.
- Fixed images attached while Claude is working (VS Code, desktop app, SDK) being sent at full size, which led to repeated image errors in long conversations — `CLAUDE-IO-03`: an upstream fix behind the steer envelope.
- Fixed the image coordinate hint being missing or slightly off for large near-square images on newer models — `CLAUDE-EVT-03`: only the content changed; the note is still marked synthetic/meta and suppressed.
- Fixed feature flag, startup, fast mode, profile and feedback requests to Anthropic carrying the API key configured for a third-party gateway (`ANTHROPIC_BASE_URL`); Anthropic API keys are still sent — `CLAUDE-ENV-01`: a privacy fix; Mainframe already strips `ANTHROPIC_API_KEY` from proxy children.
- Fixed a regression in 2.1.296 where cloud and headless sessions could run an approved tool call twice if a new message arrived as the session resumed after a restart — `CLAUDE-CTRL-01`: fixed upstream; only 2.1.296–2.1.298 were affected.
- Fixed `claude -p` saying nothing when a settings file fails validation: text-output runs now list the file and the invalid entry on stderr — `CLAUDE-FLAG-02`: the quota and title spawns read stderr only on a nonzero exit.
- Fixed MCP connections over HTTP hanging for 30 seconds and failing when a server never ends the body of its reply to a notification (anthropics/claude-code#99014) — `CLAUDE-FLAG-04`: an upstream fix on the HTTP transport Mainframe's server uses.
- Fixed queued prompts sent as content blocks over `--input-format stream-json` running together without a line break when merged into one turn — `CLAUDE-IO-03`: an upstream fix to how Mainframe's own queued and steered blocks are merged.
- Fixed MCP tool calls in headless and SDK sessions sometimes failing or running twice when a background reconnect closed the connection they were running on — `CLAUDE-FLAG-04`: an upstream fix that protects `delegate_task` and the other orchestration tools.
- Fixed Ultracode not being announced to scheduled tasks and other delivered headless turns when `ultracode` is on in settings — `CLAUDE-CTRL-03`: an upstream fix; the `apply_flag_settings` payload is unchanged.
- Fixed background subagents in auto mode sometimes sending their final report twice, once as the result and once as a message — `CLAUDE-EVT-01`: an upstream fix that removes a duplicate in Auto chats.
- Fixed replies cut off at the output token limit ending the turn silently, with no retry or error, after a request fell back to non-streaming mode — `CLAUDE-EVT-04`: an upstream fix; the `result` shape is unchanged.
- Improved the startup warning for an unrecognized model ID: it is now one short line under the welcome banner with a docs link, instead of a long raw message — `CLAUDE-IO-01`: this is the TUI banner, not the `[claude-code:unrecognized_model]` stderr line flagged in pass 2 (2.1.233).
- Improved background agent notifications: they now say when an agent is only waiting on its own background work, got a message too late for its result, or was stopped by a usage limit — `CLAUDE-EVT-01`: model-facing wording; Mainframe reads the status fields, not the prose.
- Changed skill and command loading: one whose file or folder name has hidden, direction-changing or blank-like characters, `<` or `>` is no longer offered until renamed; such a `name:` is ignored — `CLAUDE-FILE-05`: Mainframe would still list such a skill, but names like these do not occur in practice.
- Changed MCP allow rules to reach only the server they name: `mcp__a` no longer allows a server named `a__b` or `a_`; write `mcp__<server>__*` with the server's whole normalized name — `CLAUDE-FLAG-04`: `--allowedTools mcp__mainframe` already names the whole server.
- Changed cloud session and Remote Control MCP connectors to negotiate MCP protocol version 2026-07-28 by default on installs that fetch no flags; `MCP_PROTOCOL_NEGOTIATION=legacy` opts out — `CLAUDE-FLAG-04`: cloud and Remote Control only; Mainframe's server would fall back to 2025-11-25 anyway.

**2.1.296**

- Fixed token counts for Haiku 5.5 and other models that take only adaptive thinking, which failed behind some gateways and were counted with budget thinking elsewhere — `CLAUDE-CTRL-02`: an upstream fix; the `get_context_usage` response shape is unchanged.
- Fixed Esc or an interrupt during a `UserPromptSubmit` hook or a mod's `prompt.submit` hook ending headless sessions, clearing the typed prompt, or letting the unchecked prompt through — `CLAUDE-CTRL-03`: an upstream fix to the interrupt path when the user's own hooks are configured.
- Fixed `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC` dropping a message from the saved transcript when its text held a Unicode line or paragraph separator (U+2028, U+2029) — `CLAUDE-FILE-09`: an opt-in env var Mainframe never sets.
- Improved `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC`: a large transcript file is no longer rewritten when that would free under 10% of it — `CLAUDE-FILE-09`: opt-in and never set by Mainframe. It does mean the row's "append-only" assumption has a user-enabled exception worth a note in the row.
- Updated `/cost`, the status line, `--max-budget-usd` and the SDK's cost figures to price Sonnet 5.5 cache reads at $0.10 per million tokens (was $0.20) — `CLAUDE-EVT-04`: Mainframe shows `total_cost_usd` as reported.
- Changed the default limit on MCP tool descriptions sent up front and on MCP server instructions from 2,048 to 4,096 characters — `CLAUDE-FLAG-04`: more room for the orchestration tool descriptions; nothing gets truncated that wasn't before.
