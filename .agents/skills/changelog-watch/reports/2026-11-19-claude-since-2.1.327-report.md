# changelog-watch: claude 2.1.327 → 2.1.328 (2026-11-19)

Entries seen: 144 · risks: 1 · opportunities: 0 · relevant, no action: 22 · dropped as irrelevant: 121

One version. No wire shape that Mainframe parses changes. The one risk is narrow: on a fresh machine whose managed settings pull plugins from a git marketplace, `claude -p` may now exit up to 30 seconds late, and Mainframe's title and quota one-shots give up at exactly 30 seconds. Most of the volume is Code Mode, the self-hosted runner, Remote Control and terminal fixes.

Checked against the 2.1.327 and 2.1.328 darwin-arm64 builds (npm `@anthropic-ai/claude-code-darwin-arm64`, strings only, not run). The installed CLI is still 2.1.318.

- The headless trust refusal still contains both "has not been trusted" and "hasTrustDialogAccepted", so `CLAUDE-IO-01`'s two-string match holds.
- All four `CLAUDE-PROBE-04` publish wordings are present, and the `CLAUDE-RPC-01` result keys (`files_read`, `saved_dir`, `saved_to`, `size_bytes`) are too.
- `/usage` still has the "What's contributing" anchor that `parse_claude_usage` stops at.
- The temp-dir resolver behind `CLAUDE-FILE-08` is the same code in both builds: `CLAUDE_CODE_TMPDIR`, then `TEMP`/`TMP` on Windows, then `TMPDIR`/`TMP`/`TEMP` (not read on macOS), then `/tmp`. See the binary diff below.

Still open from earlier runs: the 2.1.323 high risk (CLIProxy chats assume a 1M window) and the 2.1.326 low risk (disabled-command wording, todo #433). Nothing in 2.1.328 touches either.

## Compatibility risks

### low — Improved how soon managed-settings plugins from a git marketplace load on a fresh machine in `claude -p`, SDK and Claude Desktop sessions; a short run may exit up to 30 seconds later (2.1.328)

- Checklist row: `CLAUDE-FLAG-02`. Consumers: `src/title_generator.rs::generate_claude_title` (`TITLE_TIMEOUT_MS = 30_000`) and `src/quota_pull.rs::spawn_claude_usage` (`USAGE_TIMEOUT_MS = 30_000`), both through `mainframe_runtime::process::run_captured`, which waits for the child to exit.
- Why it threatens the row: both one-shots are short `-p` runs. If the CLI now waits up to 30 s after its answer for managed plugins to load, the run passes the 30 s timeout even when the answer arrived in time. The title then falls back to the truncated first message, and the quota pull reports Unknown. Low: it needs an organisation with managed-settings plugins from a git marketplace, on a machine that hasn't loaded them yet, and the next run recovers once the plugins are cached. Nothing is lost.
- Recommended regression test: add `#[test] one_shot_timeouts_outlast_the_cli_plugin_wait` in `src/title_generator.rs` (and the same in `src/quota_pull.rs`) asserting the timeout is at least 60 000 ms, with a comment citing this entry. A behaviour test would need a fake binary that prints and then sleeps 35 s, which is too slow for the unit suite.
- Verify live: `.claude/skills/claude-protocol-debugger/`. Use an empty `CLAUDE_CONFIG_DIR` and a `managed-settings.json` that enables a plugin from a git marketplace, then time `claude -p "hi" --no-session-persistence --output-format text` from first stdout byte to exit.

## Adoption opportunities

None.

## Relevant, no action

- "Added auto mode for Claude Opus 4.6 and Sonnet 4.6 on Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry and Claude apps gateway; interactive sessions with no permission mode start in it" — `CLAUDE-FLAG-01`: Mainframe always passes `--permission-mode` and never spawns an interactive session.
- "Added `CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME`, which lets a host stop `claude -p --resume` and `--continue` from running a tool call that a hook deferred" — `CLAUDE-FLAG-01`: a deferred call exists only when a user's own PreToolUse hook defers. Mainframe installs no hooks and leaves the variable unset, so behaviour is unchanged.
- "Fixed automatic compaction reusing the session's earlier system prompt instead of rebuilding it the way `/compact` does" — `CLAUDE-FLAG-01`: the rebuilt prompt comes from the same argv, so the single `--append-system-prompt` (AskUserQuestion and orchestration text) still applies. Settings changed mid-session through `apply_flag_settings` now reach the post-compaction prompt too.
- "Fixed the token counts on the spinner and for subagents counting a retried reply twice, missing replies that were not streamed, and standing still while Claude thinks" — `CLAUDE-EVT-01`: if this reaches `task_*` `usage.total_tokens`, the numbers just get more accurate. The context gauge reads the last parent assistant `usage` (`CLAUDE-EVT-04`), not these counts.
- "Fixed the error shown when usage credits run out mid-response, which named a rate limit" — `CLAUDE-EVT-04`: Mainframe shows result and error text as given. Quota comes from `rate_limit_event` and `/usage` (`CLAUDE-PROBE-03`), never from error wording.
- "Fixed `CLAUDE_STREAM_IDLE_TIMEOUT_MS` not lengthening the 5-minute connection limit on gateways, custom base URLs and cloud providers" — `CLAUDE-ENV-01`: CLIProxy chats use a custom base URL, but Mainframe doesn't set the variable, so the 5-minute limit applies as before. If long proxy replies ever get cut off, this variable now works as a fix.
- "Fixed MCP tools whose input schema starts with `anyOf`, `oneOf` or `allOf` going missing on third-party providers or with telemetry or feature flags turned off" — `CLAUDE-FLAG-04`: every `mainframe` tool schema is a plain `object_schema` (`mainframe-orchestration/src/tools/*.rs`) with no top-level combinator.
- "Fixed an MCP tool with an invalid input schema failing requests on third-party providers or with telemetry or feature flags turned off; the tool is now left out and Claude is told why" — `CLAUDE-FLAG-04`: same schemas. They are valid, so none is left out.
- "Fixed the model saying background agents were still running after an SDK interrupt had stopped them" — `CLAUDE-CTRL-03`: Mainframe's protocol `interrupt` is such an interrupt. Only what the model is told changes. No wire change.
- "Fixed Send now in the desktop app and SDK hosts telling Claude that a stopped web search found no results" — `CLAUDE-IO-03`: Send now is `priority: "now"`. Mainframe's steer sends `"next"`.
- "Fixed the `/usage` plugin total stopping at 2,000 tokens on 1M context models, and low token estimates in `/usage` and `/plugin` when no model is picked" — `CLAUDE-PROBE-03`: only a number in the plugin breakdown changes. No line is added or removed, and the parser reads only the window lines above the "What's contributing" anchor, which is still present.
- "Fixed Claude calling an artifact private after reading one in a shared folder or publishing to another organization's, and saying only named people can open one when its folder's people can too" — `CLAUDE-RPC-01`: what the model says about access changes. The `files_read`/`file_list` keys Mainframe parses are present in 2.1.328.
- "Improved Claude's answers on who can open an artifact it published: Claude is now told to check the artifact again instead of repeating the last publish's answer" — `CLAUDE-PROBE-04`: model guidance only. All four publish wordings are unchanged in the 2.1.328 bundle.
- "Improved `claude -p` and SDK sessions to fetch managed-settings plugins that have their own git repository, in the background, for a later session" — `CLAUDE-FLAG-02`: a background fetch that doesn't change output. The exit delay it comes with is the risk above.
- "Improved the time to resume large sessions" — `CLAUDE-FLAG-01`: `--resume` gets faster. Argv and transcript format are unchanged.
- "Improved memory use when resuming a session with many images" — `CLAUDE-FLAG-01`: same reason.
- "Improved memory use and response time in long SDK and desktop sessions that run slow commands or tools" — `CLAUDE-FLAG-01`: Mainframe chats are SDK-style sessions, so they get faster. No protocol change.
- "Improved `claude -p` text output to say on stderr when a message from another session is held or dropped, and how to allow it" — `CLAUDE-FLAG-02`/`CLAUDE-IO-01`: only `-p` text-output runs print it, and Mainframe's one-shots never receive cross-session messages. Chat sessions use stream-json and stay on the `CLAUDE-IO-01` filters.
- "Changed plan mode and Bash prompts for Opus 4.6 and Sonnet 4.6 on third-party providers to use and offer auto mode, as on newer models; `disableAutoMode` turns both off" — `CLAUDE-CTRL-04`: on Bedrock, Agent Platform and Foundry, an `ExitPlanMode` gate may now suggest `setMode: auto`. Mainframe already maps `auto` and forces `setMode` to session scope (#283).
- "Changed Claude Desktop and Agent SDK sessions on third-party providers or with telemetry or feature flags off to end the turn when closed with a question open, instead of continuing without an answer" — `CLAUDE-CTRL-04`: Mainframe answers every AskUserQuestion gate itself, either allow with answers or deny with "User skipped the question" and no `interrupt` (`src/session_prompt.rs::denial_message`). It never leaves one open, except when stopping the session.
- "Changed subagents in `claude -p`, the Agent SDK, desktop and VS Code to wait for their own subagents by default when `CLAUDE_CODE_FORK_SUBAGENT=0` is set" — `CLAUDE-EVT-01`: Mainframe never sets the variable. A user who exports it gets later `task_notification`s with the same shape.
- "Changed `claude -p` with `CLAUDE_CODE_FORK_SUBAGENT=0` to count a background subagent and those it waits for against one 10-minute wait; raise `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` for longer chains" — `CLAUDE-FLAG-02`: the one-shots run one turn with no subagents.

Dropped (121): 3 `[VSCode]` entries; 26 self-hosted runner entries (flags, metrics, hooks, git access, disk and token fixes); 22 Code Mode entries; Remote Control, cloud session and cross-session messaging entries, including the held-message warning for sessions that skip permission prompts; terminal, fullscreen, paste, clipboard, keyboard, GNU screen and Linux-only fixes; `/goal`, `/bug`, `/hooks`, `/export`, `/terminal-setup`, `/install-github-app`, `/plugin`, `/login`, `/exit`, `/diff`, `/code-review`, `/list-agents`, `/chrome` and `/status` changes; scheduled tasks; `mcp_tool` hook `onFailure`, managed PostToolUse hooks, agent hook timeouts and the PermissionRequest hook sandbox change; `allowManagedModsOnly`, mods and plugin toasts; OpenTelemetry entries; Bedrock, Agent Platform, Foundry and gateway-only fixes (auto mode with betas off, effort for subagent summaries, "Prompt is too long" in Desktop, `maxEffortLevel`, pasted-text marking); the zsh `=word` Bash fix, the Bash sandbox start-up and Linux `.git/HEAD` fixes; `deniedMcpServers` for claude.ai connectors; teammates' lock-file fix; computer-use dialog; `FORCE_COLOR` and secret-masking crashes; subagent progress summaries in terminal sessions; and the remaining rendering and wording fixes.

## Binary surface diff (2.1.327 → 2.1.328)

Produced with `binary-diff.mjs` from the unmerged `feat/changelog-watch-binary-diff` branch (PR #918). 23 items, from bundle strings only.

- Announced (3), classified with their entries: `--metadata`, `CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME`, `SELF_HOSTED_RUNNER_REPOSITORY_FOLDER` (`--repository-folder`).
- Removed and cited by the checklist (1): `TEMP`, cited by `CLAUDE-FILE-08` (`%TEMP%/claude` on Windows). No action. The resolver reads it through a helper, `Qi(env, "TEMP")`, which the extractor doesn't match, and the function body is the same in both builds apart from minified names. The `process.env.TEMP`/`TMP` reads that disappeared went with `GRACEFUL_FS_PLATFORM` and `TEST_GRACEFUL_FS_GLOBAL_PATCH`, so they belonged to the bundled graceful-fs copy that was removed.
- Unannounced, relevant, no action (2):
  - `appKeepsStatuses` (described schema key) — `CLAUDE-EVT-02`: a new optional, `@internal` field in TaskCreate's tool result ("Present when the result told Claude that the app sets task statuses"). Mainframe reads TaskCreate input, and an extra result field changes nothing.
  - `observeToolResults` (agent frontmatter key, next to the existing `observer`, `observerMessage` and `observeSubagents`) — `CLAUDE-FILE-05`: Mainframe strips frontmatter without validating keys.
- Dropped (17): `--hold-repository-while-parked` (self-hosted runner); `cloudEchoBeforeInit`, `waitsAtPermissionPrompt`, `network` and `edits` (cloud sessions, agent-call results, sandbox config, Artifact publish edits Mainframe doesn't send); env vars `CLAUDECODE` and `CLAUDE_CODE_HOST_CHECKED_FOLDER` (read only with `--cloud`), `CLAUDE_CODE_CCR_AFFINITY_KEY`, `CLAUDE_CODE_PEPPY_STARLIGHT`, `CLAUDE_CODE_RELAUNCH_SANDBOX_HOLD`, `CLAUDE_CODE_SHELL_MCP_SERVERS` (shell env for spawned commands), `CLAUDE_CODE_THINKING_RESUMPTION`, `CLAUDE_CODE_WATCHED_SLEEP`; removed `CLAUDE_CODE_CCR_SKIP_NEEDLESS_STARTUP_READS`, `GRACEFUL_FS_PLATFORM`, `TEST_GRACEFUL_FS_GLOBAL_PATCH`, `TMP`.
