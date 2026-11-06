# changelog-watch: claude 2.1.274 → 2.1.285 (2026-10-17)

Pass 3 of 5. Versions covered: 2.1.275, 2.1.276, 2.1.277, 2.1.278, 2.1.280, 2.1.281, 2.1.282, 2.1.283, 2.1.284, 2.1.285 (upstream published no 2.1.279).

Entries seen: 892 · risks: 4 · opportunities: 2 · relevant, no action: 64 · dropped as irrelevant: 822

The installed CLI is 2.1.302, so every change in this range is already live. None of the
risks breaks a wire shape. Two of them are semantic: cost totals after a resume, and a
permission prompt that upstream now times out on its own. Both need a live check before
anyone writes a fix.

Two checklist notes came up while verifying consumers. They are not upstream changes:

- `CLAUDE-EVT-06` is stale. `src/session_spawn.rs::build_args` now passes
  `--include-partial-messages` whenever `src/partial_stream.rs::supports_partial_messages`
  finds CLI ≥ 1.0.109, and `src/events.rs::handle_event` routes `"stream_event"` to
  `src/partial_stream.rs::handle_stream_event`. The row still says there is no match arm.
- `CLAUDE-EVT-04`, `CLAUDE-CTRL-01` and `CLAUDE-CTRL-05` cite `src/events.rs::handle_*`.
  Those functions are defined in `src/event_result.rs` and `src/event_control.rs`, and
  `events.rs` only calls them. The validator passes because it greps for the name, but
  the citations point at call sites, not definitions.

## Compatibility risks

### medium — Fixed a headless resume (`claude -p --resume`, the SDK, a VS Code extension window reload) starting the session's cost and usage totals at zero; headless sessions now save their totals at exit (2.1.277)

- Checklist row: CLAUDE-EVT-04 — `src/event_result.rs::handle_result_event` (cited as `src/events.rs::handle_result_event`), summed downstream in `packages/core-rs/crates/mainframe-chat/src/event_handler/sink_result.rs::result_totals`
- Why it threatens the row: the adapter forwards `total_cost_usd` unchanged, and the chat
  layer adds it to `chat.total_cost` on every result. If `total_cost_usd` is a running
  total for the session (the SDK type in `PROTOCOL_REVERSED.md` §6.5 doesn't say whether
  it is per-turn or cumulative), a resumed process now starts from the restored total
  instead of zero. Each resume then adds the chat's earlier cost to the total a second
  time. Mainframe resumes on every respawn, so the stored chat cost would grow with each
  restart and nothing would error. If the field is cumulative within one process, multi-turn chats were already
  over-counted before this change. Settle that question in the same live check.
- Recommended regression test: add `#[test] a_resumed_sessions_result_cost_counts_only_this_turn`
  in `src/events_tests_results.rs` next to `top_level_result_fires_on_result`. Feed two
  top-level result events from one resumed session with `total_cost_usd` 0.40 and then
  0.55, and assert the second `on_result` carries the amount the chat should add (0.15),
  not 0.55. Take the exact payloads from a live 2.1.277+ resume.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Changed the dangerous `rm` prompt in `--dangerously-skip-permissions` and auto mode to wait 2 minutes for an answer, then deny the command with a rewrite hint so unattended sessions keep going (`CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT=1` turns this off) (2.1.281)

- Checklist row: CLAUDE-CTRL-05 — `src/event_control.rs::handle_control_cancel_request_event` (cited as `src/events.rs::…`), `packages/core-rs/crates/mainframe-chat/src/permission_manager.rs::cancel`
- Why it threatens the row: Mainframe always passes `--permission-mode` and
  `--allow-dangerously-skip-permissions`, so a bypass chat now gets a `can_use_tool` gate
  for a flagged `rm` (see the 2.1.281 `rm -rf "$(pwd)"` entry under no-action). Mainframe
  queues that gate whatever the chat state. If the CLI denies the command after
  2 minutes without sending a `control_cancel_request`, the gate stays in Mainframe's UI
  after the turn has moved on. Answering it later does nothing, which is the
  stuck-prompt symptom of #284. Nothing in the entry says whether a cancel is sent.
- Recommended regression test: extend
  `src/events_tests_control.rs::control_cancel_request_forwards_the_request_id_to_the_sink`
  with the `control_cancel_request` captured live after the 2-minute timeout on a
  bypass-mode `rm -rf "$(pwd)"`, and assert the forwarded id equals the original
  `can_use_tool` `request_id`. If the live run shows no cancel frame, the fix belongs on
  the chat side and this row's symptom applies.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Added dollar amounts to the Claude apps gateway spend limit in `/usage` and the status line (for example "$271.40 / $500.00 spent this month") when the gateway runs this version or later; the status line's `rate_limits.spend_limit` also gains `used_usd`, `limit_usd` and `period` (2.1.284)

- Checklist row: CLAUDE-PROBE-03 — `src/quota_parse.rs::parse_claude_usage`
- Why it threatens the row: the parser turns the whole provider `Unknown` on any line it
  can't classify, and it recognizes only the subscription preamble, the session line,
  "Current week (all models)" and "Current week (<model>)". A spend row with dollar
  amounts matches none of them. Its failure mode is fail-closed (high by the rule), but
  it only hits users signed in through a Claude apps gateway, and that spend row may
  already have been unparseable before the amounts were added. This corroborates the
  2.1.236 `/usage` risk from the 2026-08-27 pass 2 report: the parser breaks every time
  upstream adds a row.
- Recommended regression test: add `#[test] a_gateway_spend_limit_row_does_not_fail_the_provider`
  in `src/quota_parse_tests.rs`. Pin a body with `Current session: 12% used` followed by
  a `$271.40 / $500.00 spent this month` row, and assert the session window's percent is
  12 and the status is not `Unknown`.
- Verify live: .claude/skills/claude-protocol-debugger/

### low — Added Claude Sonnet 5.5 (`claude-sonnet-5-5`), now the default Sonnet model on the Anthropic API — 1M context, $2/$10 per Mtok with $0.20/Mtok cache reads (2.1.284)

- Checklist row: CLAUDE-PROBE-02 — `src/models.rs::claude_models`
- Why it threatens the row: `CURRENT_MODELS` lists `claude-opus-5-5` (added for 2.1.280)
  but not `claude-sonnet-5-5`. When the probe fails, the fallback picker leaves out the
  new default Sonnet. A probed `claude-sonnet-5-5` whose description has no "1M" hint
  gets no window, because `unknown_windows_require_a_description_hint` only infers one
  from the description. The picker then shows no 1M window until the live
  `get_context_usage` fills in the real size.
- Recommended regression test: add `#[test] gives_claude_sonnet_5_5_the_extended_window_from_the_static_catalog`
  in `src/models_tests.rs`, modelled on
  `gives_claude_sonnet_5_the_extended_window_from_the_static_catalog`. Pin a probed
  `claude-sonnet-5-5` with no 1M wording in its description, and assert the window is
  `1_000_000` and that `claude_models()` contains the id.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- Syncing of claude.ai-enabled skills and plugins into terminal sessions (2.1.275, opt
  out with `syncClaudeAiSkills`/`syncClaudeAiPlugins`). Synced skills live in an
  account-skills folder that `src/skills.rs::list_skills` doesn't scan, and the CLI
  names them `anthropic-skills:<name>` (2.1.282, 2.1.283), so
  `src/skill_path.rs::resolve_skill_path` falls back to a path that doesn't exist. The
  feature would land in the skills panel (CLAUDE-FILE-05) and in Skill path resolution
  (CLAUDE-EVT-02). Size: medium.
- `system/init` `plugin_errors`, which now names the failed `--plugin-dir` `path` (2.1.283).
  Mainframe reads only `session_id` from init. Surfacing plugin load failures would be
  one more field in `src/event_system.rs::handle_system_event` and a notice in the
  skills panel. Size: small.

## Relevant, no action

**2.1.285**

- Added `allowedProviders` managed setting to limit which API providers a machine may use — CLAUDE-ENV-01: an admin policy only; it could block CLIProxy sessions on a managed machine, but nothing changes for anyone else.
- Fixed switching models mid-session with a `set_model` request … leaving the new model on the built-in output-token limit and auto-compact window until restart — CLAUDE-CTRL-03: an upstream fix to a request Mainframe already sends.
- Fixed switching off an MCP server added mid-session in SDK and `-p` sessions leaving its tools available — CLAUDE-FLAG-04: Mainframe adds its server once at spawn and never toggles it.
- Fixed `claude -p --permission-prompt-tool`: a background subagent's permission request now goes to the prompt tool instead of being auto-denied — CLAUDE-CTRL-01: these requests are ordinary `can_use_tool` frames, and `mainframe-chat` queues them even when the chat is idle.
- Fixed fork subagents not keeping the session's plan mode or `dontAsk` mode — CLAUDE-CTRL-01: subagents now follow the parent's mode, so Mainframe's mode stays authoritative.
- Fixed hooks and SDK permission callbacks seeing a missing or outdated plan on ExitPlanMode when the plan was written in the same response — CLAUDE-CTRL-01: the fix improves the plan text the existing gate reads.
- Fixed sessions that authenticate with `ANTHROPIC_AUTH_TOKEN` against the Anthropic API never loading the organization's policy — CLAUDE-ENV-01: Mainframe sets the auth token only together with a proxy `ANTHROPIC_BASE_URL`.
- Fixed `/cost` and SDK `modelUsage` reporting a turn under the wrong model … — CLAUDE-EVT-04: Mainframe doesn't read `modelUsage`.
- Fixed compacting or resuming a session failing … when its saved transcript holds a compaction marker or loop wakeup entry with missing or malformed fields — CLAUDE-FILE-04: a fix in the CLI's own transcript reader; Mainframe's history parser is separate.
- Improved SDK liveness during a non-streaming fallback request: with partial messages on, a `ping` stream event is now sent every 30 seconds — CLAUDE-EVT-06: Mainframe does pass `--include-partial-messages` (the row is stale, see the top of this report), but `update_partial` ignores unknown inner types and `ping` carries no delta.
- Improved `/resume` and `claude --resume` on a session that is running in the background: they now open that session instead of refusing … — CLAUDE-FLAG-01: Mainframe's own chats never run in a `claude --bg` worker. An external session that does used to fail the resume outright. Confirm live what a stream-json `--resume` does now before relying on that.
- Changed MCP tools so a tool that sets its own `_meta['anthropic/alwaysLoad']` to false stays deferred … — CLAUDE-FLAG-04: Mainframe leaves `alwaysLoad` unset.
- Changed background Bash and PowerShell commands to stop after a time limit (… default 30 min, max 2 h); Claude is notified when one is stopped — CLAUDE-EVT-01: `mainframe-claude-workflows::status::task_update_action` maps `killed`/`stopped`, and any unknown status, to `Stopped`. Users will see long dev servers end at 30 minutes.
- Changed sessions behind a custom `ANTHROPIC_BASE_URL` to use the 1M context window of models that have one (Opus 4.7+, Sonnet 5+, Fable) … — CLAUDE-ENV-01: CLIProxy model ids are `gpt-*`/`kimi-*` and are not in that list.
- Changed `claude -p` and Python Agent SDK sessions on third-party providers or with telemetry off to start in auto mode when no permission mode is configured … — CLAUDE-FLAG-01: Mainframe always passes `--permission-mode`.

**2.1.284**

- Fixed "Prompt is too long" errors that persisted after compacting: … Claude Code now compacts once more — CLAUDE-EVT-01: a second `compact_boundary` uses the shape Mainframe already handles.
- Fixed Agent SDK sessions crashing when a user message contains an image with a malformed `source` … — CLAUDE-IO-02: a fix on the input side; Mainframe sends well-formed base64 sources.
- Fixed MCP tool calls in a resumed session failing with "No such tool available" while their server was still connecting … — CLAUDE-FLAG-04: an upstream fix that helps `mcp__mainframe__*` calls after a resume.
- Fixed repeated calls to the plan-usage endpoint after it rate-limits or rejects your login … now back off — CLAUDE-PROBE-03: the pull already fails to `Unknown` when it gets no percent, which is the same outcome as before.
- Fixed the Explore subagent switching to Opus on the Claude API when the session runs a model ID Claude Code doesn't recognize, such as a custom model behind a proxy … — CLAUDE-ENV-01: this fixes CLIProxy sessions in Mainframe's favour.
- Changed interactive terminal and VS Code sessions to start in auto mode when no permission mode is configured … — CLAUDE-FLAG-01: Mainframe always passes `--permission-mode`.
- Changed Ultracode into its own toggle in `/effort` … it no longer forces xhigh effort — CLAUDE-CTRL-03: `src/tuning.rs::tuning_to_flag_settings` already sends `ultracode` and `effortLevel` as separate keys.
- Changed the non-interactive first turn to still wait up to 2s for connecting MCP servers named by `--allowedTools` … — CLAUDE-FLAG-04: Mainframe passes `--allowedTools mcp__mainframe`, so the first turn now waits for the server. That helps.

**2.1.283**

- Added `availableModelsMatch` managed setting … — CLAUDE-PROBE-01: an admin filter; the probe maps whatever list the CLI returns.
- Added `deniedModels` managed setting to block specific models … — CLAUDE-PROBE-01: same as above.
- Fixed SDK sessions losing a deferred tool call or finished tool result when a turn ended early, a held approval prompt after a worker restart, and a non-streaming fallback's `result.usage` — CLAUDE-EVT-04: the `result.usage` fix only matters when no parent assistant usage was seen, which is the fallback path.
- Fixed the weekly Fable limit not appearing in `/usage` and the VS Code usage meters when telemetry is disabled — CLAUDE-PROBE-03: a `Current week (Fable):` line goes through `weekly_model_label` as a `WeeklyModel` window.
- Fixed `/context` not counting MCP server instructions … — CLAUDE-CTRL-02: the `get_context_usage` total gets more accurate and keeps its shape.
- Changed interactive sessions on third-party providers or with telemetry off to start in auto mode when no permission mode is configured … — CLAUDE-FLAG-01: Mainframe always passes `--permission-mode`.
- Changed `--system-prompt` and `--append-system-prompt` to accept their text and `-file` forms together … — CLAUDE-FLAG-01: Mainframe passes only the text form, once, so the repeated-flag rule the row depends on is unchanged.
- Reverted the 2.1.282 reservation of the `claude-ai` name … — CLAUDE-FILE-05: this restores the pre-2.1.282 skill loading that Mainframe's scan mirrors.

**2.1.282**

- Fixed every request failing with a 400 error in conversations whose history holds web search results the API cannot decrypt (for example, from a turn answered through a third-party gateway) — CLAUDE-ENV-01: this fixes chats that switch between CLIProxy and native models.
- Fixed an unanswered Fable usage-credits prompt switching models in SDK-hosted sessions …; the turn now ends instead — CLAUDE-CTRL-01: the turn now ends with a normal `result` and no longer switches models silently.
- Changed skill folders, command files and workflow commands in the `anthropic-skills` or `claude-ai` namespace to no longer load … — CLAUDE-FILE-05: reverted in 2.1.283.

**2.1.281**

- Fixed resuming a session that ended during a tool call: … a manual resume no longer adds a hidden "Continue" message — CLAUDE-FILE-04: Mainframe has no filter for that message, so one less meta line reaches it.
- Fixed `--input-format stream-json` sessions … failing every turn with an error when an earlier assistant message had plain-string content — CLAUDE-IO-02: an upstream fix on the input path Mainframe uses.
- Fixed non-interactive sessions (`-p`, Agent SDK) failing on the next turn after the directory they were started in was deleted mid-session — CLAUDE-FLAG-01: this helps chats whose worktree is removed while the chat is open.
- Fixed headless sessions with host-side (SDK) MCP servers stalling on the first message … — CLAUDE-FLAG-04: Mainframe's server is HTTP, not host-side SDK.
- Fixed a recursive `rm` whose target is only command-substitution output … running unprompted in auto and `--dangerously-skip-permissions` mode; it now asks even with a Bash allow rule … — CLAUDE-CTRL-01: the new prompt arrives as a normal `can_use_tool` frame. Its 2-minute timeout is the CTRL-05 risk above.
- Fixed `/context` total leaving out messages added since the last response … — CLAUDE-CTRL-02: the gauge gets more accurate and keeps its shape.
- Changed send now (ctrl+enter or ctrl+x ctrl+s) to move running tools to the background instead of cancelling the turn — CLAUDE-IO-03: Mainframe steers with `priority: "next"` and never sends `"now"`.

**2.1.280**

- Added Claude Opus 5.5 (`claude-opus-5-5`), now the default Opus model — CLAUDE-PROBE-02: already in `CURRENT_MODELS` with a 1M window.
- Fixed a model switch made from a host app (Claude Desktop, VS Code, SDK) while Claude is working causing a prompt-cache miss on the next prompt — CLAUDE-CTRL-03: an upstream fix to the `set_model` path.
- Fixed skills in `~/.claude/skills/` being moved to `~/.claude/skills/.trash/` when a `manifest.json` in that folder listed their names — CLAUDE-FILE-05: skills stop vanishing from the directory Mainframe scans.
- Fixed conversations with the advisor on failing every turn with API Error 400 "Input tag 'advisor_20260301'" behind a proxy or gateway … — CLAUDE-ENV-01: this fixes CLIProxy sessions.
- Fixed a session failing on every turn and `/compact` when its saved history held a malformed notice about MCP tools that could not be loaded — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Fixed a crash when resuming a session whose saved transcript holds a malformed system message or a memory-saved notice without its file list — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Fixed resuming a session with unfinished background agents, shells or workflows starting a model turn on its own before you typed anything — CLAUDE-FLAG-01: resumed chats no longer start a turn nobody asked for.
- Fixed background shell tasks reporting benign non-zero exits (e.g. grep with no matches) as failures — CLAUDE-EVT-01: the set of status values doesn't change; fewer tasks end as `failed`.
- Changed the default model on Pro and Team Standard plans from Sonnet to Opus … — CLAUDE-CTRL-06: inherited chats resolve the model through `get_settings`, so they pick up the new default.
- Changed an effort level saved before `/effort` became per-model to no longer apply to newly released models such as Opus 5.5 … — CLAUDE-CTRL-03: when the user sets an effort, Mainframe sends it explicitly through `apply_flag_settings`.
- Changed Opus 4.7, Opus 4.8 and Fable 5 to stop holding their launch-default effort over `/effort` in `-p` or the Agent SDK, a project, managed or `--settings` `effortLevel`, or a per-model level — CLAUDE-CTRL-03: Mainframe's `effortLevel` now takes effect on those models.

**2.1.277**

- Fixed `claude -p` and Agent SDK sessions that could hang with no result after an internal error; they now report the error and exit with code 1 — CLAUDE-EVT-04: an error `result` followed by process exit is a path Mainframe already handles.
- Fixed a crash when resuming a session whose saved history holds an assistant message stored as a plain string — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Fixed a crash ("unrecoverable interface error") when resuming a session whose saved transcript contains a stop hook summary without a well-formed hook list — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Changed subagent results to reach the main agent under a header marking them as subagent output, with the result indented … — CLAUDE-EVT-03: Mainframe parses nothing out of Agent tool_result text; at worst the result card shows the header.
- Removed the background Haiku auto-title request from `claude -p` runs launched outside an SDK or IDE — CLAUDE-FLAG-02: Mainframe's title and quota one-shots now make one fewer hidden request.
- Removed the deprecated TaskOutput tool … — CLAUDE-PROBE-02: `TaskOutput` stays in the `hidden` category of `src/adapter/contract.rs::get_tool_categories`, where an entry for a tool that never arrives does no harm.

**2.1.276**

- Fixed every request failing with `400 … Input tag 'advisor_20260301'` when `ANTHROPIC_BASE_URL` points at a proxy or gateway (2.1.275 regression) — CLAUDE-ENV-01: 2.1.275 broke every CLIProxy session, and the next release fixed it. The installed version is 2.1.302.

**2.1.275**

- Fixed `--resume`, the resume picker preview, resumed background agents and the transcript view failing on a session whose saved history contains a malformed task-reminder or @-file attachment entry — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Fixed a crash when resuming a conversation whose transcript contains a malformed message entry … — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Fixed sessions failing to resume or start when their saved transcript contains a malformed message content block — CLAUDE-FILE-04: a fix in the CLI's own reader.
- Improved pasted and attached images: they are now saved where Claude can open them as files without a permission prompt, including in Desktop and VS Code — CLAUDE-IO-02: the image blocks Mainframe sends are unchanged; the CLI only saves a copy as well.
- Improved plan-usage reads: editor windows and non-interactive sessions on one machine now share a read made in the last minute … — CLAUDE-PROBE-03: the pulled quota can be up to 60 s stale, and the output format is unchanged.
