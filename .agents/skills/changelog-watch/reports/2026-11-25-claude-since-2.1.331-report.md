# changelog-watch: claude 2.1.331 → 2.1.332 (2026-11-25)

Entries seen: 150 · risks: 1 · opportunities: 0 · relevant, no action: 33 · dropped as irrelevant: 116

One version. One low risk: skills served by MCP servers. I compared the 2.1.331 and 2.1.332 darwin-arm64 builds from npm and read their bundled text. Neither was run, and the installed CLI is 2.1.318, so nothing here was checked live. Codex printed `no changes: codex is current at rust-v0.172.0`.

Still open from earlier runs: the 2.1.323 high risk (CLIProxy chats assume a 1M window), the 2.1.326 low risk (todo #433), the 2.1.328 low risk (30 s one-shot timeouts) and the rust-v0.169.1 `KNOWN_WINDOWS` risk. I did not re-check them.

## Compatibility risks

### low — Added skills from MCP servers (beta). They show as `server:skill` in the `/` menu; other skills keep their names (2.1.332)

- Checklist row: CLAUDE-EVT-02 and CLAUDE-EVT-03 — `src/assistant_event_tools.rs::scan_skill`, `src/skill_path.rs::resolve_skill_path`, `src/user_event_content.rs::extract_skill_block`
- Why it threatens the row: Mainframe treats `a:b` as a plugin skill on disk. For an MCP skill, `resolve_skill_path` finds no plugin and returns `~/.claude/skills/<leaf>/SKILL.md`, so the skill-file panel gets a missing file or an unrelated local skill with the same leaf name. A server name outside `[A-Za-z0-9_-]` gives an empty path. The injected body also opens with `This skill is served by MCP server "<name>" at <uri>.` and not `Base directory for this skill:`, so no skill card is built. The raw body should not leak into the transcript, because synthetic and meta text is already suppressed; that depends on the CLI marking it so, which needs a live check. The opener is already in 2.1.331. The Skill result text for these skills is `Launching skill from an MCP server: <name>` (Mainframe does not parse it).
- Reach: beta. The bundle skips `skills/list` unless the connection is known to use MCP protocol 2026-07-28 or later.
- Opportunity inline: `list_skills` reads disk only, so these skills are missing from Mainframe's skill list. Adding them needs a listing from the CLI; size: medium.
- Recommended regression test: add `#[test] mcp_served_skill_reports_no_local_skill_file` in `packages/core-rs/crates/mainframe-adapter-claude/src/events_tests_skills.rs`, pinning a `Skill` tool_use with `{"skill":"docs:invoice"}` followed by an `isSynthetic` user text block that starts with the MCP opener. Assert that `skill_files` is empty and that no CLI message is emitted.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

None beyond the one inline above.

## Relevant, no action

- Added a `PreSkillShellCommand` hook event that can refuse a skill or command's inline shell commands as it loads; on 2.1.331 and older, a settings file naming it opens a dialog at start — CLAUDE-CTRL-01: Mainframe registers no hooks, and a user's own hook runs inside the CLI. The old-version dialog needs a settings file that names the event; this repo's `.claude/settings.json` does not. The installed CLI is 2.1.318, so adding that hook before upgrading could affect spawns.
- Fixed turns ending in "Prompt is too long" after repeated auto-compaction failures when one more compaction at the context limit could have kept them going — CLAUDE-EVT-04: fewer failed `result` events; the shape is unchanged.
- Fixed compaction failing when a summary kept running past the output limit: after three cut-off replies, the last try now asks for a shorter summary — CLAUDE-EVT-03: compaction succeeds more often; `isCompactSummary` and the summary preamble are unchanged in the bundle.
- Fixed a freeze when a prompt or piped input holds an `@` followed by a very long unbroken string, such as minified CSS with an embedded font — CLAUDE-IO-02: a fix for prompts sent over stdin; the envelope is unchanged.
- Fixed SSE MCP servers hanging or refusing every tool call after their event stream was cut and came back on a new endpoint or not at all, until reconnected by hand — CLAUDE-FLAG-04: the injected `mainframe` server is `type: "http"`, not SSE.
- Fixed a usage limit being reported as reached to Remote Control, IDE and SDK clients after it had already reset — CLAUDE-EVT-05: a stale `rate_limit_event` stops reaching the quota banner. Field names are not mentioned.
- Fixed resuming a session and `/stats` freezing for seconds when a transcript holds many damaged lines — CLAUDE-FLAG-01: a `--resume` speed-up; no flag changes.
- Fixed raw "JSON Parse error" and "The operation was aborted." API errors when the non-streaming retry got a broken response or was interrupted — CLAUDE-EVT-04: error wording in `result` only. Mainframe shows it and does not parse it.
- Fixed a PreToolUse hook's reason for asking not showing on terminal Read, Grep, Glob, Edit and Write prompts (anthropics/claude-code#102892, anthropics/claude-code#105343) — CLAUDE-CTRL-01: terminal prompts only; `can_use_tool` and `decision_reason` are not mentioned.
- Fixed `temp_*` folders piling up in `~/.claude/plugins/cache` when a downloaded plugin couldn't be copied into place — CLAUDE-FILE-05: fewer stray directories under the plugin cache the scan walks.
- Fixed `--effort` being ignored when starting an interactive session with `--environment` while `CLAUDE_CODE_EFFORT_LEVEL` is set to the same level — CLAUDE-FLAG-01: Mainframe never passes `--effort` or `--environment`.
- Fixed headless and cloud sessions reporting a foreground fork's Agent call as finished the moment the fork started — CLAUDE-FILE-04: the fork's tool_result now arrives when the fork ends, so the Agent card stops settling early. The `toolUseResult.agentId` link is not mentioned.
- Fixed idle compaction being skipped for subscribers still well under their weekly limit — CLAUDE-EVT-01: a CLI compaction arrives as the `compact_boundary` already handled. Not checked: whether the CLI's own idle compaction runs under Mainframe's argv alongside the daemon's `idle_compaction`.
- Fixed replies that start with phrases like "You've used" or "You've hit your" showing as a red usage limit error — CLAUDE-EVT-04: Mainframe matches no such phrase. The wording appears only in its tests.
- Fixed a resumed conversation sometimes missing its last messages after a crash or kill on Bedrock, Google Cloud's Agent Platform, Foundry and other third-party providers — CLAUDE-FILE-04: the named providers are not ones Mainframe configures; fewer truncated transcripts.
- Fixed task ids being reused and deleted tasks coming back when several tasks were deleted or updated at once, and TaskGet listing completed tasks as blockers — CLAUDE-EVT-02: more reliable `TaskCreate`/`TaskUpdate` ids; the inputs Mainframe reads are the same.
- Fixed Code Mode not telling Claude when a slow command moved to the background and left its script with empty output, or of the time limit on background commands in `claude -p` and the Agent SDK — CLAUDE-EVT-01: text given to the model; the `task_*` events are not mentioned.
- Fixed Code Mode sessions in the Agent SDK and `claude -p` sometimes losing Claude's last reply on resume after being stopped while a script was running — CLAUDE-FILE-04: a fix for transcripts Mainframe also reads.
- Fixed Esc not stopping a Bash command while it waited for its file diff in large or slow git repositories, which held the next message — CLAUDE-CTRL-03: `interrupt` should land sooner in that state; the `stop_task` and SIGINT fallbacks are unchanged.
- Fixed `~/.claude.json` being reported as corrupted when another session was in the middle of saving it — CLAUDE-FILE-06: the CLI tolerates a concurrent save. Mainframe already writes by tmp and rename, and maps its own failed reads to `transient:identity-read-failed`.
- Improved the error when a proxy or gateway cuts or damages a compressed response: a turn now ends in plain words instead of raw "ZlibError fetching" text — CLAUDE-ENV-01: clearer error text for CLIProxy chats.
- Improved `/context`: shorter output in fullscreen, so the total is less likely to scroll off in a short window, and the legend names its unit once — CLAUDE-CTRL-02: Mainframe uses the `get_context_usage` control request, not the fullscreen text.
- Improved peak memory use and speed of `/usage` on machines with many recent sessions — CLAUDE-PROBE-03: performance only; the `% used` anchor is still in the bundle.
- Improved recovery for long conversations behind a proxy or gateway with a request size limit, where every message and `/compact` failed with a 413 — CLAUDE-ENV-01: a benefit for a size-limited CLIProxy endpoint.
- Improved memory use of `claude -p` and SDK-hosted sessions at the start of a conversation — CLAUDE-FLAG-02: performance only.
- Changed the `sonnet` model alias on Google Cloud's Agent Platform and Microsoft Foundry to Sonnet 5.5, and Foundry's `opus` alias to Opus 5.5; `sonnet` on Amazon Bedrock stays at Sonnet 4.5 — CLAUDE-PROBE-01: other cloud providers. The picker takes the models the CLI reports.
- Changed the default model on Microsoft Foundry to Sonnet 5.5: deploy `claude-sonnet-5-5`, or set `ANTHROPIC_DEFAULT_SONNET_MODEL` to a model you have deployed — CLAUDE-PROBE-01: Foundry only.
- Changed `--model default` and a Default pick to move to an older model when that model isn't available, instead of stopping with an error; in auto mode, only to a model auto mode accepts — CLAUDE-FLAG-01: Mainframe omits `--model` for `default`. A stepped-down session may run an older model, which `get_settings` (CLAUDE-CTRL-06) should report in `applied.model`; not checked live.
- Changed Microsoft Foundry: Claude Sonnet 4, Opus 4 and Opus 4.1 now count as retired, so step-downs stop above them and a pin to one warns that it was retired — CLAUDE-PROBE-02: Foundry only; step-down and pin warnings on that provider only.
- Changed SDK and `claude -p` mid-turn messages to count as the user's where feature flags aren't fetched, as on clouds or with telemetry off, from Opus 4.8 on; mark relayed text `isSynthetic: true` — CLAUDE-IO-03: see "Mid-turn messages" below. Native chats are outside the gate.
- Changed `computer-use` to a reserved skill name on Macs with computer use on: your own skill or command of that name stops loading, and a start-up notice says to rename it — CLAUDE-FILE-05: only a user's own skill or command named `computer-use` is affected; Mainframe would still list it.
- Changed Claude Desktop's Code tab on Anthropic's API to ignore default, side-request, alias and subagent model ids not starting with `claude` in your own settings beside a gateway address — CLAUDE-ENV-01: Desktop's Code tab only. Mainframe sets its model variables in the child env under a different entrypoint.
- Changed Claude Desktop's Code tab on Anthropic's API to ignore a `CLAUDE_CODE_AUTO_COMPACT_WINDOW` under 200K in your own settings beside a gateway address; use `/autocompact` instead — CLAUDE-ENV-01: Desktop's Code tab only, and Mainframe does not set the variable.

### Mid-turn messages (entry on `isSynthetic: true`)

The check in the 2.1.332 bundle that sets `hostsOwnTurn` requires the entrypoint to be `sdk-ts`, `sdk-py` or `sdk-cli`, as it did in 2.1.331. Only its feature-flag default changed. Native Mainframe chats run as `mainframe`, so they do not qualify. CLIProxy chats set no entrypoint, and the CLI defaults a non-interactive one to `sdk-cli`, so their steered messages may now count as the user's. That would include a `chat_send` steer from another agent, though its text is still wrapped in `<mainframe-agent-message>`. Queued sends start a turn and are not mid-turn.

Do not stamp `isSynthetic` on relayed text as a quick fix. The CLI reports meta messages back as synthetic, and Mainframe hides synthetic text and skips `isMeta` history entries, so relayed messages could disappear.

Dropped (116): 30 `[VSCode]` entries; Windows and Linux fixes; Code Mode entries other than the two above; Bedrock, Agent Platform, Foundry, gateway and `availableModels` fixes other than those above; self-hosted runner; OpenTelemetry; computer use; voice dictation; Remote Control, Claude Desktop and mobile; mods; `/stats`, `/permissions`, `/mcp`, `/feedback`, `/schedule`, `/install-github-app`, Ctrl+R, keybindings and other TUI fixes; held messages from other sessions; the flagged-message footer and the Cyber Verification tier; `claude auth login` (Mainframe does not run it); `--fallback-model`; hook output limits; named pipes, @-mentions, Grep, Glob, NotebookEdit and web search; CLAUDE.md re-sent after a worktree move; MCP stdout floods, task handles and start-up memory; `awsCredentialExport` and API key helpers.

## Unannounced surface changes

From `binary-diff.mjs` (12 items, bundle strings only). No removed item is cited by the checklist, and no added or removed env var appears in `packages/`.

- `CLAUDE_CODE_MCP_SERVE_MEMORY_WALKS_DEADLINE_MS` (env var, removed) — CLAUDE-RPC-01: no action. `claude mcp serve` drops the memory-file lookup this bounded. The strings `file_list`, `files_read` and `saved_dir` appear as often as in 2.1.331.
- `CLAUDE_CODE_SPEND_PROJECT` (env var) — "Not consumed" (usage attribution): no action. It is a fallback for `CLAUDE_PROJECT_UUID`, read only when `CLAUDE_CODE_REMOTE` is set.
- `always` and `account` (described schema keys) — CLAUDE-CTRL-03 (not sent): no action. They belong to `@internal` controls for held messages from other sessions, covered by the "Always deliver" entry.
- `blocker` (described schema key) — CLAUDE-EVT-03: no action. An optional field in an `@internal` tool-result fix hint that Mainframe does not read.
- Dropped from the binary diff: 7 (`AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `CLAUDE_CODE_DISABLE_POWERSHELL_LIBRARY_LOAD_GUARD`, `CLAUDE_CODE_HOST_SHORT_SCRATCHPAD`, `CLAUDE_CODE_INDEXED_SALAMANDER`, `CLAUDE_CODE_RELAUNCH_SEAT_LAUNCH`, `CLAUDE_CODE_USER_DELEGATED_SESSION_ROUTINE_SERVER_CHECK_PROVIDERS`).
