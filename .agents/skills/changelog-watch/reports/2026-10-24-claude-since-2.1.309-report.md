# changelog-watch: claude 2.1.309 → 2.1.310 (2026-10-24)

Entries seen: 26 · risks: 0 · opportunities: 0 · relevant, no action: 8 · dropped as irrelevant: 18

One version. Nothing in it changes a field, flag, event, or file Mainframe reads. Two entries help Mainframe directly: a retry for gateways that reject the effort beta (the CLIProxy path) and lower memory use in `-p`/SDK compaction. One entry is a reminder of a standing gap: the adapter never answers MCP `elicitation` control requests.

## Compatibility risks

None.

## Adoption opportunities

None new in this version. A standing one is restated under the elicitation entry below, because 2.1.310 changes what users see when it bites.

## Relevant, no action

- Added the Monitor tool and plugin monitors on Bedrock, Vertex, and Foundry, and when telemetry or nonessential traffic is disabled; long foreground sleeps are now blocked there too — `CLAUDE-EVT-01`: more sessions can now emit Monitor `task_started` events. `src/task_events.rs` already maps `Monitor` to `BackgroundTaskToolName::Monitor` (`task_events_tests_part_1.rs`). Blocking foreground sleeps changes Bash tool behaviour, not the wire.
- Fixed requests failing behind some gateways and compatible servers that reject the `effort-2025-11-24` beta value or mid-conversation system messages; Claude Code now retries without them — `CLAUDE-ENV-01`: this is the CLIProxy path, and it is a fix. Proxy chats that failed on these requests now succeed. On a proxy that rejects the beta, the retry drops effort, so the composer's effort setting does nothing there and no error appears. That is upstream behaviour Mainframe cannot detect.
- Fixed background cleanup deleting some recent files, such as pasted images, when `cleanupPeriodDays` is set to a very large value — `CLAUDE-FILE-01`: Mainframe never sets `cleanupPeriodDays`, and the fix only narrows what cleanup deletes.
- Fixed compaction after a "Prompt is too long" error keeping too much of a conversation with dense text, such as base64 or SVG, so the next request could fail again — `CLAUDE-EVT-01`: this changes which content compaction keeps. `compact_boundary` and the compacting status are unchanged.
- Fixed file read permission prompts not showing where a symbolic link leads — `CLAUDE-CTRL-01`: this is prompt copy. Mainframe draws its own gate from `can_use_tool`'s `tool_name`/`input`, and the adapter's `Value` parsing ignores any added field.
- Improved auto mode's prompt before the first read outside the working directories: it now says when blocking those reads makes shell commands ask for permission — `CLAUDE-FLAG-01`/`CLAUDE-CTRL-03`: Mainframe does run Claude in `auto` (`src/session_controls.rs` maps `ExecutionMode::Auto`, and `session_tests_spawn_part_1.rs` asserts `--permission-mode auto`), but this entry changes TUI prompt copy only. *Checklist drift found during this review:* `CLAUDE-FLAG-01` lists `--permission-mode <default|acceptEdits|bypassPermissions|plan>` and omits `auto`. The row needs a doc fix.
- Improved memory use of non-interactive sessions (`-p`, Agent SDK) during compaction when the transcript file is very large — `CLAUDE-FLAG-01`/`CLAUDE-EVT-01`: every Mainframe chat is a non-interactive stream-json session, so long chats use less memory. No shape change.
- Changed the error for an MCP tool call that times out in a non-interactive session while the server's elicitation is unanswered: it now tells Claude that no answer came and not to repeat the call — `CLAUDE-CTRL-01`: Mainframe is in this situation by design. Only `can_use_tool` is handled, so an `elicitation` control request from a user's MCP server is logged at warn and dropped. The call then times out (see `docs/research/adapters/claude/AGENT-SDK-PARITY.md`, which lists `elicitation` among the subtypes the SDK handles and Mainframe does not). The new text stops Claude from retrying in a loop. The `mainframe` orchestration server (`CLAUDE-FLAG-04`) does not elicit. Standing opportunity: answer `elicitation` requests, at minimum with an explicit decline as Codex does (`CODEX-RPC-10`), and ideally by showing them as a gate. Lands in `src/events.rs::handle_control_request_event`. Size: small to decline, medium to show.

Dropped (18): the question auto-continue timeout with the external editor (TUI); Windows Git Bash hook handling; mod `Image` rendering in tmux and terminals; the Linux `/sandbox` AppArmor warning; and the 14 bracketed product-surface entries: [VSCode] ×2, [Cloud sessions] ×7, [Claude Tag] ×3, [Code Review] ×2.
