# changelog-watch: claude 2.1.228 → 2.1.237 (2026-08-27)

Pass 2 of 3. Versions covered: 2.1.229, 2.1.231–2.1.237 (upstream published no 2.1.230).

Entries seen: 207 · risks: 8 · opportunities: 2 · relevant, no action: 24 · dropped as irrelevant: 173

This is the heaviest pass in the range. Four of the eight risks are high.

**Installed CLI is 2.1.224**, so every risk in this pass is pending the next upgrade
rather than live today — including the todo/task tool removal. That makes them cheap to
fix ahead of the bump instead of diagnosing after it.

## Compatibility risks

### high — Todo/task-tracking tools (TaskCreate/Get/Update/List, TodoWrite) are no longer available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models; set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` to bring them back (2.1.233)

- Checklist row: `CLAUDE-EVT-02` — `src/assistant_event.rs::handle_assistant_event`; also `CLAUDE-EVT-01` (`src/events.rs::handle_system_event`, the `task_started`/`task_updated`/`task_notification` subtypes)
- Why it threatens the row: `CLAUDE-EVT-02` exists to read `TodoWrite` input arrays and
  `TaskCreate|TaskUpdate|TaskStop`. Upstream just removed those tools from every model
  Mainframe actually runs. The tools are not renamed or reshaped — they are gone, so the
  events never arrive, the handlers never fire, and nothing errors. The todo list and the
  task tracker go permanently empty on any session using a current model, and the
  Context tab's Tasks panel goes with them. This is the widest-blast-radius entry in the
  whole 2.1.220 → 2.1.247 range, and Mainframe is very likely already running past it.
- Recommended regression test: add `#[test] todo_tools_are_enabled_for_the_session` in
  `src/session.rs`, next to
  `a_proxy_session_is_pointed_at_the_endpoint_and_stripped_of_the_real_api_key`,
  asserting the spawn env carries `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. Opting back in via
  env is the only way to keep the surface alive; the existing
  `src/events.rs::todo_write_fires_todo_update` stays green either way because it feeds
  a synthetic event, which is exactly why this break is invisible to the current suite.
- Verify live: .claude/skills/claude-protocol-debugger/

### high — Improved print mode diagnostics: a `[claude-code:unrecognized_model]` line is written to stderr when a request goes out for a model ID Claude Code doesn't recognize; map it with `modelOverrides` to silence (2.1.233)

- Checklist row: `CLAUDE-IO-01` — `src/events.rs::{is_informational, handle_stderr}`
- Why it threatens the row: `is_informational` filters exactly six prefixes —
  `debugger`, `warning:`, `deprecationwarning`, `experimentalwarning`, `(node:N)`,
  `Cloning into` (read and confirmed). `[claude-code:unrecognized_model]` matches none of
  them, so it is surfaced as a session error. Every CLIProxy session is an unrecognized
  model by construction: `src/cliproxy.rs::split_endpoint` strips the namespace and hands
  the CLI a bare id like `gpt-5.6-sol`. The row's own note calls this the single most
  fragile item in the inventory. Verify whether "print mode" covers
  `--output-format stream-json` sessions or only `-p`; if it covers both, every proxy
  session now reports a spurious error.
- Recommended regression test: extend
  `src/events.rs::stderr_filters_informational_and_empty` with the verbatim
  `[claude-code:unrecognized_model]` line, asserting it classifies as informational
  rather than asserting that handling returned successfully.
- Verify live: .claude/skills/claude-protocol-debugger/

### high — `/usage` now shows the usage-credits spend row for Team and Enterprise members, and shows a capped row at 0% before anything is spent (2.1.236)

- Checklist row: `CLAUDE-PROBE-03` — `src/quota_parse.rs::parse_claude_usage`
- Why it threatens the row: the parser anchors on prose with the percent load-bearing.
  This adds a *new percent* to the same output, and one that reads `0%` in the common
  case. If the anchor binds to the credits row instead of the session row, the quota
  gauge reports a confident, plausible, wrong 0% — worse than the row's documented
  "shows Unknown" symptom, because nothing looks broken. This is the second `/usage`
  layout change in the range; pass 1 flagged the 2.1.222 MCP-attribution change against
  the same parser.
- Recommended regression test: extend
  `src/quota_parse.rs::parses_the_percent_with_and_without_a_space_before_used` with a
  `/usage` body captured from 2.1.236+ that includes the 0% capped credits row,
  asserting the parsed value is the session percent and not 0.
- Verify live: .claude/skills/claude-protocol-debugger/

### high — Fixed nested git repositories inheriting trust from a parent directory; each repository now requires its own trust confirmation (2.1.232)

- Checklist row: `CLAUDE-FILE-06` — `src/trust_store.rs::write_workspace_trust`; also `CLAUDE-IO-01` (`is_trust_not_trusted`, `is_trust_permissions`)
- Why it threatens the row: Mainframe writes `projects[path].hasTrustDialogAccepted` for
  the path it is trusting. This repo routinely runs sessions in nested repositories —
  every `.worktrees/*` checkout, and the `packages/mobile` submodule. If Mainframe
  answers a trust prompt by writing the parent's key while the CLI now demands the
  nested repo's own, the session re-emits the trust advisory and wedges in a loop that
  answering cannot clear.
- Recommended regression test: add `#[test]
  write_workspace_trust_targets_the_nested_repo_not_its_parent` in `src/trust_store.rs`,
  pinning the exact `projects[...]` key written for a worktree path nested inside an
  already-trusted parent.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Background task notifications delivered between turns are now sent to the model inside `<system-reminder>` tags, matching mid-turn delivery (2.1.234)

- Checklist row: `CLAUDE-EVT-03` — `src/user_event.rs::handle_user_event`
- Why it threatens the row: the row's marker vocabulary is specific —
  `<local-command-stdout/stderr/caveat>`, `isMeta`, the skill-injection markers — and
  `<system-reminder>` is not in it. A between-turn background-task notice now arrives
  wrapped in a tag the parser does not strip or suppress, so the raw reminder text can
  render in the transcript as if the user had typed it.
- Recommended regression test: add `#[test]
  system_reminder_background_task_notice_does_not_reach_the_transcript` in
  `src/events.rs`, feeding a user event whose content is a `<system-reminder>`-wrapped
  task notice and asserting no message is emitted.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Subagent forking is now on by default: a `subagent_type: "fork"` subagent inherits the full conversation and prompt cache, and non-teammate agent spawns in interactive sessions now run in the background by default (2.1.232)

- Checklist row: `CLAUDE-FILE-04` — `src/history_subagents.rs::capture_agent_id_mapping`
- Why it threatens the row: subagent inlining depends on sidechain JSONL discovery and
  the `toolUseResult.agentId` link. A fork subagent that inherits the parent conversation
  may not produce a distinct sidechain, or may link differently. Default-on means this
  is now the common path, not an edge case. Symptom matches the row's: resumed chats
  lose subagent output, or blocks attach to the wrong parent tool_use.
- Recommended regression test: extend
  `src/history_subagents.rs::capture_agent_id_mapping_links_agent_to_tool_use` with a
  fixture captured from a `subagent_type: "fork"` spawn, asserting the agent id still
  resolves to the parent tool_use.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Added plugin marketplace `command` sources: a local command (e.g. an IDE) prints the plugin directory, which is re-resolved each session and applied without a restart; `mode: "link"` uses it in place (2.1.229)

- Checklist row: `CLAUDE-FILE-05` — `src/skills.rs::{list_skills, list_agents}`
- Why it threatens the row: `mode: "link"` uses the plugin directory *in place*, so the
  plugin never lands in the cache layout Mainframe's scan walks. Its skills and agents
  are then invisible to Mainframe while the CLI offers them. Note the pattern across
  this range: `archive` sources and `skills: "."` (both pass 1) plus `command` sources
  here — plugin discovery is diversifying faster than a scanner pinned to one layout can
  track. Worth treating the three together rather than as three patches.
- Recommended regression test: add `#[test]
  list_skills_follows_a_linked_plugin_directory_outside_the_cache` in `src/skills.rs`,
  building a temp plugin outside the cache root and asserting its skill is returned.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Claude Code now continues your session automatically when a claude.ai usage limit resets; turn it off in `/config` ("Continue automatically at usage limit") (2.1.234)

- Checklist row: `CLAUDE-EVT-05` — `src/events.rs::handle_rate_limit_event`; also `CLAUDE-EVT-01`
- Why it threatens the row: a session Mainframe believes is idle can start a turn on its
  own, hours later, with no user input. Mainframe's chat lifecycle assumes turns begin
  from a stdin write. The entry is phrased in interactive terms, so confirm first whether
  it applies to stream-json sessions at all — that check decides whether this is a real
  exposure or a no-op.
- Recommended regression test: add `#[test]
  an_unsolicited_turn_after_a_quota_reset_reuses_the_existing_chat` in `src/events.rs`,
  feeding an unprompted turn-start sequence and asserting no duplicate chat row is
  opened.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- **`CLAUDE_CODE_PROJECT_DIR_NAME`** (2.1.234) — "hosts that give each session its own
  config directory can choose a short name for the per-project transcript directory."
  This is upstream handing Mainframe an escape from `CLAUDE-FILE-07`, the row that
  documents the same cwd-encoding reverse-engineered three separate times
  (`src/transcript.rs::encode_project_path`, `src/external_session_paths.rs::encode_path`,
  `mainframe-background-tasks/src/encoding.rs::encode_cwd_segment`). Setting the name
  explicitly would retire all three guesses and close pass 1's high-severity >200-char
  path risk in the same stroke — that risk is precisely the problem this variable was
  added to solve. Size: medium, and it removes a standing liability rather than adding a
  feature.
- **SIGTERM for session shutdown** (2.1.236) — "SIGTERM in print/SDK mode no longer
  records an interrupted turn or synthetic tool denials before exiting; running commands
  are still terminated and the process still exits with code 143." `CLAUDE-CTRL-03`'s
  interrupt escalation ends in a 10s SIGINT fallback; SIGTERM is now the clean exit that
  leaves no synthetic denials in the transcript. Size: small.

## Relevant, no action

**2.1.237**

- Fixed prompt caching for sessions using an LLM gateway or custom base URL — `CLAUDE-ENV-01`: directly on the CLIProxy path. Every proxy session before 2.1.237 was paying uncached prices.

**2.1.236**

- Added `ANTHROPIC_DEFAULT_MODEL` environment variable — `CLAUDE-ENV-01`: Mainframe passes `--model` explicitly on every spawn, which outranks a default.
- Fixed skills hot-reload in SDK/VS Code sessions erroring after the working directory was deleted — `CLAUDE-FILE-05`: on Mainframe's session kind, and a fix; worktree removal is the realistic trigger.
- Fixed spinner tips never appearing when the cached guest-pass reward in `~/.claude.json` was malformed — `CLAUDE-FILE-06`: the identity read already degrades to a sentinel on parse failure.
- Pressing Enter on a slash-command typo now reports it instead of running the closest fuzzy match — `CLAUDE-IO-02`: Mainframe sends exact command names in the XML wrapper.

**2.1.235**

- Fixed the Agent tool advertising a general-purpose default where that agent is unavailable — `CLAUDE-FILE-05`: agent discovery is unchanged; the error is clearer.
- Improved the context-limit error to say when auto-compact is off — `CLAUDE-EVT-01`: message text only.

**2.1.234**

- Fixed session-scoped permission answers (including denies) being dropped when answering background subagent tool permission prompts — `CLAUDE-CTRL-04`: Mainframe forces `setMode` to `session` (#283), so it sat squarely in this bug's blast radius. Fixed upstream, no adapter change.
- Fixed accepting the fullscreen-renderer prompt restarting the session without its permission mode, tool rules, model or effort flags — `CLAUDE-FLAG-01`: an interactive path Mainframe never enters. Incidentally confirms the older `--dangerously-skip-permissions` spelling is still live upstream.
- Fixed a crash when a non-streaming fallback response (typically via third-party gateways) had a thinking block missing its thinking field — `CLAUDE-ENV-01`: the CLIProxy path again; a plausible explanation for past proxy-session crashes.
- Improved auto-generated session titles to read as short, specific names — `CLAUDE-FLAG-02`: Mainframe generates its own titles via a `-p` spawn and never reads the CLI's.

**2.1.233**

- Fixed bundled skill aliases like `/checkup` and `/review` reporting "Unknown command" in `-p` mode or when a user or project skill shadows the bundled one — `CLAUDE-IO-02`: a fix on the command path Mainframe writes.
- Fixed skill/command argument substitution to prevent argument values being re-expanded as template markers — `CLAUDE-IO-02`: directly on the `<command-args>` wrapper Mainframe writes; a user argument containing template syntax was previously re-expanded.
- Improved `claude plugin validate` to check a bare `.claude/skills` directory, reporting SKILL.md frontmatter that fails to parse — `CLAUDE-FILE-05`: validation tooling only; the frontmatter strip is unchanged.

**2.1.232**

- Fixed a startup race that could silently unregister a plugin marketplace — `CLAUDE-FILE-05`: fewer disappearing plugin directories under the scan.
- `/code-review` at high, xhigh, and max effort now runs in a background agent — `CLAUDE-EVT-01`: more `task_started` traffic, same shape.
- Fixed usage-limit guidance suggesting unavailable slash commands in SDK and remote sessions — `CLAUDE-PROBE-03`: guidance copy, not `/usage` output.
- Fixed stream idle timeout errors failing the request instead of recovering on Bedrock, Vertex, and gateway deployments — `CLAUDE-ENV-01`: complements the 2.1.222 idle-timeout fix on the same proxy path.

**2.1.229**

- Fixed SDK and `--input-format stream-json` sessions getting a 400 API error when a whitespace-only message was submitted — `CLAUDE-IO-02`: exactly Mainframe's input format; an empty composer submit used to 400 the turn.
- Fixed a crash to the error screen, including on `--resume`, when a tool call had a non-string `glob`, `file_path`, or `command` value — `CLAUDE-FLAG-01`/`CLAUDE-FILE-04`: a resume-path crash fix.
- Fixed a RangeError crash that could also crash `claude --continue`/`--resume` at startup — `CLAUDE-FLAG-01`: same.
- Fixed conversations exceeding the API's 32 MB request limit retrying compaction forever; they now fail once with a clear message — `CLAUDE-EVT-01`: a terminal error instead of a hang.
- Fixed `/model` rejecting Sonnet/Opus 1M for claude.ai subscribers using a custom `ANTHROPIC_BASE_URL` gateway — `CLAUDE-ENV-01`/`CLAUDE-PROBE-02`: the 1M window on the proxy path, and the window constant Mainframe hardcodes.
- Added SSE keepalive pings to gateway streaming responses during long thinking pauses — `CLAUDE-ENV-01`: prevents idle-timeout disconnects on the proxy path.

## Dropped as irrelevant (173)

Per-version: 2.1.237 (1), 2.1.236 (27), 2.1.235 (17), 2.1.234 (44), 2.1.233 (15),
2.1.232 (43), 2.1.231 (1), 2.1.229 (25). The categories: fullscreen and classic TUI
rendering, Vim mode, dialogs and keybindings, VSCode extension entries, Remote Control
and cloud sessions, `claude self-hosted-runner`, cross-session messaging and
`SendMessage`/`ListAgents` behaviour, sandbox and secret-redaction settings, marketplace
and managed-settings policy, GitLab/`glab` integration, Bedrock/Vertex/Foundry
authentication and regions, MCP OAuth, and Windows-only fixes.
