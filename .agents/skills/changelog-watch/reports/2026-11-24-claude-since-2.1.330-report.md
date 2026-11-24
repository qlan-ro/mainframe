# changelog-watch: claude 2.1.330 → 2.1.331 (2026-11-24)

Entries seen: 135 · risks: 0 · opportunities: 0 · relevant, no action: 10 · dropped as irrelevant: 125

This range has one version, and none of its entries changes a stream-json field, control subtype, flag, env name or transcript path that Mainframe reads. 78 of the 135 entries are `[VSCode]`. Most of the rest are Code Mode, Windows and TUI fixes. The entries that touch a checklist surface are upstream fixes Mainframe benefits from without any change.

I compared the strings in the 2.1.330 and 2.1.331 darwin-arm64 builds (npm `@anthropic-ai/claude-code-darwin-arm64`) without running either one. I then read the 2.1.331 bundle for context on the items below. The installed CLI is still 2.1.318.

- The stdin `user` envelope still declares `priority: "now" | "next" | "later"` as optional. Mainframe's steer sends `"next"`, so `CLAUDE-IO-03` holds. The `priority` key in the binary diff comes from a different schema.
- A new `@internal` control request, `prompt_draft_activity`, lets a host tell the CLI that someone is typing in its composer, so the CLI can get the next request ready. See "Unannounced surface changes".

Still open from earlier runs: the 2.1.323 high risk (CLIProxy chats assume a 1M window), the 2.1.326 low risk (disabled-command wording, todo #433) and the 2.1.328 low risk (managed-plugin exit delay against the 30 s one-shot timeouts). Nothing in 2.1.331 touches them. The 2.1.330 opportunity (easel's `mcp__easel__chart`) is unchanged.

## Compatibility risks

None.

## Adoption opportunities

None from the changelog. One unannounced candidate (`prompt_draft_activity`) is under "Unannounced surface changes" and stays deferred while it is `@internal`.

## Relevant, no action

- "Added `CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION` to ask for uncompressed model responses behind a proxy that cuts compressed ones off; not advised yet for self-hosted runners or Remote Control" — `CLAUDE-ENV-01`: opt-in and Mainframe doesn't set it. If CLIProxy chats ever show truncated replies, try this variable first.
- "Fixed MCP tool calls hanging for up to 30 minutes on some malformed replies from a local or WebSocket server" — `CLAUDE-FLAG-04`: the `mainframe` server is `type: "http"` and its long waits are deliberate (`timeout: 3900000`). The fix covers malformed replies, not slow ones.
- "Added `optionalDependencies` to plugin manifests: plugins that install with the plugin listing them and can be disabled or uninstalled on their own" — `CLAUDE-FILE-05`: dependency plugins install as ordinary plugins in the same cache layout, so the existing scan picks up their skills and agents.
- "Fixed an interrupted or failed plugin update leaving a partial plugin folder that later loaded with skills or other components missing (anthropics/claude-code#102186)" — `CLAUDE-FILE-05`: Mainframe's panel listed the same partial folder. Upstream now stops writing it, and the scan needs no change.
- "Fixed /compact and auto-compact sometimes losing part of the conversation summary when the summary quoted certain XML tags" — `CLAUDE-EVT-03`: a fix to the summary body. `isCompactSummary` and the preamble Mainframe strips aren't mentioned.
- "Fixed turns and subagents failing in cloud sessions, or timing out on long replies elsewhere, when a reply went silent while Claude was still thinking; Claude Code now tries the request once more" — `CLAUDE-EVT-04`: fewer failed `result` events. The retry happens inside the turn, and the result shape is unchanged.
- "Fixed Esc and Stop waiting about a minute or more when the contents of a cloud or network file that Claude is reading stall" — `CLAUDE-CTRL-03`: the protocol `interrupt` now lands sooner on a stalled read. The `stop_task` and SIGINT fallbacks are unchanged.
- "Fixed a crash when a custom API endpoint returned a tool call with no tool name; the call now fails with an error and the session continues" — `CLAUDE-ENV-01`: a CLIProxy endpoint is a custom endpoint, so such a chat now shows a failed tool call instead of a dead process.
- "Improved start-up time: a session started soon after another no longer waits for the model list, and one outside a git repository without `.claude/settings.local.json` no longer waits on git" — `CLAUDE-PROBE-01`: faster spawns. Nothing says the `initialize` response loses `models[]`, which the probe reads.
- "Improved Claude's list of your artifacts: it now marks web pages, so Claude is less likely to try opening one with the Claude Docs connector" — `CLAUDE-RPC-01`: that is the `scope: "mine"` listing the model reads. Mainframe calls only `list` with `scope: "files"` and `read`.

Dropped (125): 78 `[VSCode]` entries; 7 Windows-only fixes; Code Mode entries (provider support, resumed permission modes, request loop, uncut output, `--bare`, tool search); apps gateway OIDC (`oidc.groups_jsonpath`, `CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME`); `claude doctor` API connectivity; voice dictation (×2); `gen_ai.*` trace spans; PushNotification in headless runs; `/install-github-app`, `/diff`, `/bug`, `/permissions`, `/ide`, `/clear` and `/rewind` prompts, the first-run theme list and other TUI rendering fixes; Agent-tool permission rules on subagent messages and `Agent(model:*)`; Remote Control ordering; Stop and SubagentStop hooks in Claude Desktop; `PermissionRequest` and `PermissionDenied` hook changes; notebook reads; rewind deleting files; auto mode and `/loop`; Workflow agent cleanup; `claude plugin install` hangs and the plugin auto-update notice; "Ask your admin" budgets; `@file#10-12` mentions; artifact invitation links; sandboxed Bash on a full temp disk; screen-reader typing; the Console sign-in link; folder trust prompts in short terminals; the CLI freeze and quoted-text fix; and the future auto-update default for managed `extraKnownMarketplaces`.

## Unannounced surface changes

From `binary-diff.mjs` (2.1.330 → 2.1.331, 32 items, bundle strings only). Three are announced (`CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION`, `CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME`, and `uncutOutputNote` for the Code Mode uncut-output fix) and were classified with their entries. No checklist row cites any removed item, and no removed or added env var appears anywhere in `packages/`.

- `prompt_draft_activity` (control request subtype) — `CLAUDE-CTRL-03` (not sent), possible opportunity, deferred. Schema text: "@internal The person is typing a prompt for this session in the host's own composer. It carries none of the text. Send it at the first key and about every 10 seconds while typing goes on. Between turns the CLI may use the time to get the next request ready; during a turn it does nothing. Acknowledged with an empty success either way." Older CLIs answer with an unknown-subtype error. Mainframe's composer could send it to shorten the time to the first reply. It is marked `@internal`, so wait until it is documented, then measure the latency gain before building it. Size: small.
- `priority` (described schema key) — `CLAUDE-IO-03`, no action. The stdin `user` envelope still declares `priority` as `"now" | "next" | "later"`. A new `@internal` input `requeue_if_interrupted_within_ms` sits beside it, and Mainframe doesn't send it. The steer payload is unaffected.
- `fromMcpServer` (described schema key, Skill tool output) — `CLAUDE-EVT-02`, no action. A new optional `true` flag on a Skill result when an MCP server served the skill. The skill name is still in the tool_use, so path resolution behaves as before. An MCP-served skill has no file on disk, so the skill-file panel already shows nothing for one.
- Dropped from the binary diff: 26. They are the host, bridge, desktop and cowork env vars (`CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO`, `CLAUDE_CODE_HOST_STARTED_AHEAD`, `CLAUDE_CODE_LAZY_WORKTREE`, `CLAUDE_CODE_SENDS_VIA_SESSION_SERVICE`, read only when `CLAUDE_CODE_REMOTE` is set, `CLAUDE_CODE_USER_DELEGATED_SESSION_SERVER_CHECK_PROVIDERS`, `CLAUDE_CODE_CHROME_SIDE_PANEL`, `CLAUDE_CODE_DISABLE_DESKTOP_SHIP`, `CLAUDE_CODE_DISABLE_SHIP`, `CLAUDE_CODE_FETCH_PERSONAL_CLOUD_CONFIGURATION`, `CLAUDE_BG_CRASH_UPLOAD_JUDGED`, `CLAUDE_CODE_DISABLE_REDIRECT_CHECK`, `CLAUDE_PLUGIN_FEATURE_FLAGS`, and the codename gates `CLAUDE_CODE_ELEGANT_MIST` and `CLAUDE_CODE_SHINY_FOUNTAIN`); bundled-runtime reads (`BUN_CRASH_REPORT_URL`, `BUN_ENV`, `BUN_OPTIONS`, `AWS_WEB_IDENTITY_TOKEN_FILE`); the schema keys `isError`, `lists`, `pageText`, `total` and `uncommittedStatus` (cloud-container diff rows); and the 3 removed `OTEL_EXPORTER_OTLP_*` names, which Mainframe never sets. The `ANT_OTEL_EXPORTER_OTLP_*` forms are still in the bundle.
