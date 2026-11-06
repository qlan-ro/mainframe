# changelog-watch: claude 2.1.305 → 2.1.307 (2026-10-22)

Entries seen: 45 · risks: 1 · opportunities: 0 · relevant, no action: 14 · dropped as irrelevant: 30

Delta: `reports/2026-10-22-claude-since-2.1.305-delta.md` (2.1.306 two entries, 2.1.307 43).

Run notes:

- Installed CLI: 2.1.306. Nothing here was verified live; every classification below comes from the changelog text and the Mainframe source.
- Codex was checked in the same run. It is current at `rust-v0.163.0`. The first four release-list fetches failed with GitHub HTTP 504; the fifth succeeded.

## Compatibility risks

### medium — Fixed model switches through the Agent SDK's `setModel()`, and apps built on it, being refused when the API took more than 5 seconds to confirm the model; Claude Code now waits up to 15 seconds (2.1.307)

- Checklist row: CLAUDE-CTRL-03 (`set_model`), with the 5-second default from CLAUDE-CTRL-02. Consumers: `src/session_controls.rs::{set_model, require_success, await_terminal}` → `src/session_control.rs::ControlRequestChannel::send_awaiting`.
- Why it threatens the row: `await_terminal` passes `timeout_ms: None`, so `send_awaiting` waits 5 000 ms. Before 2.1.307 the CLI also gave up at about 5 s, so both sides failed together. From 2.1.307 the CLI keeps waiting for up to 15 s. On a slow API confirmation, Mainframe returns `ControlFailed { subtype: "set_model", reason: "timeout" }` while the CLI later applies the switch. The UI then reports a failed switch, or keeps the old model, while the next turn runs on the new one. A late `control_response` reaches `resolve` with no pending caller and is dropped (`control_response_unknown_request_id_does_not_panic`). `apply_flag_settings` and `set_permission_mode` use the same helper. The changelog only names `setModel`, so the risk is limited to that subtype until shown otherwise.
- Recommended regression test: add `#[test] set_model_waits_out_the_clis_15_second_confirmation_window` in `src/session_control_tests.rs`. Answer a `set_model` request with `{"subtype":"success"}` after 6 s of paused tokio time and assert `set_model` returns `Ok(())`. The current 5 s default should fail it. The fix is a per-subtype `timeout_ms` (≥ 15 000 plus margin) on the `set_model` call; the global default stays as it is.
- Verify live: `.claude/skills/claude-protocol-debugger/`. On 2.1.307, send `set_model` through a slow or throttled endpoint (e.g. a `cliproxy/` chat with added latency) and time the `control_response`.

## Adoption opportunities

None in this range.

## Relevant, no action

- Fixed HTTP MCP tool calls being sent twice when the connection closed mid-call; only read-only or idempotent tools are now retried (2.1.307) — CLAUDE-FLAG-04: `mainframe-orchestration/src/tools/mod.rs` already sends `readOnlyHint`/`idempotentHint` per tool (`read_tools_are_marked_read_only`). Read tools still retry, and mutating calls such as `delegate_task` are no longer duplicated, which is the case `clientRequestId` exists for.
- Fixed MCP servers being reported as timed out, and staying failed in headless runs, when a macOS or Linux computer went to sleep while they were connecting (2.1.307) — CLAUDE-FLAG-04: a fix that keeps the `mainframe` server available after the laptop wakes. Nothing Mainframe sends changes.
- Fixed MCP servers showing "needs authentication" in `claude -p` on macOS while the login keychain was locked; they now say why, and the next run after an unlock connects without a new sign-in (2.1.307) — CLAUDE-FLAG-04: the `mainframe` server authenticates with a bearer header from `MAINFRAME_MCP_TOKEN`, not keychain OAuth.
- Fixed a turn sometimes starting without an SDK MCP server's latest tools when a background task was running (2.1.307) — CLAUDE-FLAG-04: applies only to SDK-type (in-process) servers. Mainframe injects an `http` server through `--mcp-config`.
- Fixed the `prompt-caching-scope` beta header being sent behind custom `ANTHROPIC_BASE_URL` gateways and on Foundry, where it has no effect (2.1.307) — CLAUDE-ENV-01: `cliproxy/` chats stop sending a beta header CLIProxyAPI ignores. This only reduces what reaches the proxy.
- Fixed requests failing with a model-not-found error when `CLAUDE_CODE_DISABLE_1M_CONTEXT` is set and the model is an alias with the `[1m]` suffix, such as `opus[1m]` (2.1.307) — CLAUDE-FLAG-01 / CLAUDE-PROBE-01: Mainframe passes `[1m]` aliases from the probe catalog but never sets `CLAUDE_CODE_DISABLE_1M_CONTEXT` (grep finds no hits in `packages/core-rs/crates`). It only mattered if the user's own env set it, and that case is now fixed.
- Fixed an API error being replaced by "prompt is too long", and an unneeded compaction, in sessions with many MCP tools (2.1.306) — CLAUDE-EVT-01 / CLAUDE-EVT-04: the real API error now reaches the `result` event instead of a spurious `compact_boundary`. The event shapes are unchanged.
- Fixed some "Autocompact is thrashing" errors in turns that read many PDF pages, images or other large tool results (2.1.307) — CLAUDE-EVT-01: fewer error turns around `status == "compacting"`. Nothing Mainframe parses changes.
- Fixed `claude -p` inside cloud sessions reporting "Not logged in" when started without the session's environment variables (2.1.306) — CLAUDE-FLAG-02: affects only cloud sessions. Mainframe's `-p` quota and title spawns run locally.
- Fixed subagent transcripts recording placeholder token usage and an empty stop reason for streamed responses (2.1.307) — CLAUDE-FILE-04: subagent JSONL now records real values. Mainframe's subagent inlining (`history_subagents.rs`) does not read either field from subagent files, and `presentation_history` reads `stop_reason` only on main-chain entries.
- Improved recovery from unparseable tool calls: Claude Code now retries the call up to twice before ending the turn with an error (2.1.307) — CLAUDE-EVT-02 / CLAUDE-EVT-04: a turn that still fails ends with the `result` `is_error` that `handle_result_event` already handles. If a malformed `tool_use` ever shows up in the stream before the retry, look here first; the changelog does not say it does.
- Fixed a background command stopped through a connected app (such as the desktop app archiving an idle session) being reported to Claude as stopped by the user; the notice now names its output file (2.1.307) — CLAUDE-CTRL-03 (`stop_task`): only the text the model sees changes. The `task_notification` status that `handle_system_event` reads is not mentioned.
- Fixed `/permissions` > Recently denied not showing the denied shell command, and auto mode's local classifier ignoring an approval from there when it checks a retried command; approving a row now names the command, not its description (2.1.307) — CLAUDE-CTRL-01: a TUI dialog plus the auto-mode classifier. Mainframe never spawns `--permission-mode auto`, and its asks arrive as `can_use_tool`.
- Changed the notice Claude gets when the WebSearch budget is used up to also tell it not to query search engines in a browser or through computer use (2.1.307) — CLAUDE-EVT-03: model-facing tool-result text, rendered verbatim like any other tool result. No parser depends on it.

## Dropped as irrelevant (30)

`/claude-api api-version` skill; `claude_code.safety_event` OTel event; the `/autocompact` and `/clear` fixes for cloud sessions; `CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS` and OTEL headers behind the Claude apps gateway; `/help` skill descriptions; WebFetch in Cowork; the GitHub MCP form in the desktop Code tab; Artifact tool connection reset; fork-subagent launch labelling; browser sign-in page; web search 403 reasons in cloud; cloud first-reply time; Remote Control connect time; `axScreenReader` scope; self-hosted runner ×4; VSCode ×7; Cloud sessions ×2; Code Review `@claude review stop`.

## Notes noticed in passing (not delta entries)

- `src/partial_stream.rs` exists in the Claude adapter and reads `stop_reason` from delta payloads. CLAUDE-EVT-06 still describes `stream_event` as deliberately unhandled and `--include-partial-messages` as never passed. That row may be out of date. Check it the next time the checklist is edited; this run did not change it.
