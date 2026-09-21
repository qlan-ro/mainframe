# changelog-watch: claude 2.1.237 → 2.1.247 (2026-08-27)

Pass 3 of 3. Versions covered: 2.1.238, 2.1.239, 2.1.240, 2.1.241, 2.1.243, 2.1.245,
2.1.246, 2.1.247 (upstream published no 2.1.242 or 2.1.244).

Entries seen: 255 · risks: 8 · opportunities: 1 · relevant, no action: 55 · dropped as irrelevant: 191

Two findings here corroborate pass 1's high-severity cwd-encoding risk, and one closes
out the advisor's question about the Sonnet 5 context constant: upstream moved *to*
967K, which is the value Mainframe already pins.

## Compatibility risks

### high — Fixed `claude -c`/resume picking up sessions from a different directory whose path differed only by characters like `_`, `-`, or `.` (2.1.239)

- Checklist row: `CLAUDE-FILE-01` — `src/transcript.rs::encode_project_path`; also `CLAUDE-FILE-03` (`src/external_session_paths.rs::encode_path`) and `CLAUDE-FILE-07`
- Why it threatens the row: this is direct evidence that the CLI's project-directory
  encoding is no longer a simple character map. Mainframe's own test pins the old
  behaviour — `encode_path_replaces_every_non_alphanumeric` asserts
  `/Users/x/my_proj.v2` → `-Users-x-my-proj-v2` — so `_`, `-`, and `.` all collapse to
  `-`, and `/a/my_proj` and `/a/my-proj` land in the same directory. Upstream just
  taught the CLI to keep them apart, which means it now encodes or disambiguates
  differently. Mainframe derives a path the CLI no longer writes: history load and
  resume come back empty with no error. Together with pass 1's >200-char path fix
  (2.1.224), the encoding has changed at least twice inside this range, and all three
  of Mainframe's independent implementations are stale.
- Recommended regression test: add `#[test]
  encode_project_path_distinguishes_underscore_dash_and_dot_like_the_cli` in
  `src/transcript.rs`, pinning the two directory names the CLI actually creates for
  `/a/my_proj` and `/a/my-proj` (capture both live first); mirror it in
  `src/external_session_paths.rs`. Update the existing
  `encode_path_replaces_every_non_alphanumeric` assertion, which currently encodes the
  stale behaviour as correct.
- Verify live: .claude/skills/claude-protocol-debugger/

### high — Improved the reminder shown after compaction so a skill's original arguments are not re-run as a new request (2.1.239)

- Checklist row: `CLAUDE-PROBE-03` — `src/user_event.rs::COMPACT_SUMMARY_PREAMBLE`; also `CLAUDE-EVT-03` (`isCompactSummary` handling)
- Why it threatens the row: `COMPACT_SUMMARY_PREAMBLE` is one of the four
  prose-sensitive parsers the checklist calls its highest-risk group — Mainframe matches
  the post-compaction reminder by its literal text. This entry changes that reminder.
  The row's own breakage symptom applies exactly: post-compaction continuation
  duplicates, because the preamble no longer matches and the continuation stops being
  recognized as one. Nothing errors; the transcript just grows a duplicate after every
  compaction.
- Recommended regression test: extend the `COMPACT_SUMMARY_PREAMBLE` matching test in
  `src/user_event.rs` with the 2.1.239+ reminder text captured verbatim, asserting the
  event is classified as a compact summary — not merely that parsing succeeded.
- Verify live: .claude/skills/claude-protocol-debugger/

### high — Added a Loops breakdown to `/usage`: per-loop run count, total tokens, tokens per run, and last run (2.1.243)

- Checklist row: `CLAUDE-PROBE-03` — `src/quota_parse.rs::parse_claude_usage`
- Why it threatens the row: this is the **third** restructuring of `/usage` output in
  this range — after the MCP-attribution change (2.1.222, pass 1) and the credits row
  that renders `0%` (2.1.236, pass 2). A new section carrying its own run counts and
  token totals gives the percent anchor more chances to bind to the wrong number. At
  three changes in 27 versions, patching anchors one at a time is losing ground; the
  parser should be re-derived against a fresh capture and given a test that fails when
  the anchor drifts rather than one that accepts any successful parse.
- Recommended regression test: extend
  `src/quota_parse.rs::parses_the_percent_with_and_without_a_space_before_used` with a
  full `/usage` body captured from 2.1.243+ including the Loops breakdown, asserting the
  extracted percent equals the session figure. Add a negative case asserting a body with
  no session row yields `None` rather than a number lifted from another section.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed the UI stopping with a render error on the first tool call when a third-party Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`) streams a `tool_use` block without an `id` (2.1.246)

- Checklist row: `CLAUDE-EVT-02` — `src/assistant_event.rs::handle_assistant_event`; also `CLAUDE-ENV-01`
- Why it threatens the row: every CLIProxy session is a third-party
  `ANTHROPIC_BASE_URL` endpoint, so this is Mainframe's proxy path exactly. Mainframe
  keys tool-call state, permission prompts, and subagent linkage by `tool_use` id. An
  id-less block from the proxy means those lookups have nothing to key on — tool rows
  never resolve, and the `CLAUDE-CTRL-04` permission answer has no `toolUseID` to send
  back. Upstream now tolerates it; Mainframe's handling of the same shape is untested.
- Recommended regression test: add `#[test]
  assistant_tool_use_without_an_id_does_not_orphan_the_tool_row` in `src/events.rs`,
  feeding an assistant event whose `tool_use` block omits `id` and asserting the emitted
  message rather than absence of a panic.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Improved non-interactive sessions (`-p`, SDK, cloud sessions) to automatically continue a response cut off mid-stream by a server error, connection loss, or stall instead of ending with an error (2.1.246)

- Checklist row: `CLAUDE-EVT-04` — `src/events.rs::handle_result_event`, `src/events.rs::handle_event`
- Why it threatens the row: non-interactive is Mainframe's only session kind. A turn
  that previously ended with one `result` event can now resume and emit further
  assistant content — and possibly a second `result`. The row computes context tokens
  from the last parent-turn assistant `usage` and fires `on_result` on the top-level
  result; a mid-turn continuation can make the turn appear to end early, double-fire the
  result, or leave the cost figure taken from the wrong segment.
- Recommended regression test: extend
  `src/events.rs::top_level_result_fires_on_result` with a continued-turn sequence
  (assistant → interrupted result → resumed assistant → final result), asserting
  `on_result` fires once with the final totals.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed auth, model-availability, and other client-generated error messages rendering like model output instead of as error lines (2.1.243)

- Checklist row: `CLAUDE-EVT-04` — `is_error` on the result event; also `CLAUDE-EVT-01`
- Why it threatens the row: client-generated errors used to arrive inside the assistant
  content stream, where Mainframe rendered them as ordinary text. They now travel as
  error lines instead. If that means a different event type or subtype, Mainframe's
  string-matching dispatch drops them to the debug fall-through, and auth or
  model-availability failures reach the user as silence rather than as wrong-looking
  assistant text. Given CLIProxy sessions run unrecognized model ids, model-availability
  errors are a live case here.
- Recommended regression test: add `#[test]
  a_client_generated_auth_error_reaches_the_user` in `src/events.rs`, feeding the
  captured error-line shape and asserting a user-visible error message is emitted.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed agents, skills, and commands whose `.md` file starts with a UTF-8 BOM being silently ignored (2.1.239)

- Checklist row: `CLAUDE-FILE-05` — `src/skills.rs::{list_skills, list_agents}`, `src/skill_path.rs::read_skill_content`
- Why it threatens the row: the CLI now accepts BOM-prefixed skill, agent, and command
  files, so users will have them. Frontmatter detection normally tests for `---` at the
  start of the file; a BOM puts three bytes in front of it. The skill either drops out
  of the panel or renders with its frontmatter still attached — both are the row's
  stated symptoms, and both are silent. (2.1.246 fixed the same BOM problem for
  `plugin.json`, so this is a pattern upstream is working through.)
- Recommended regression test: add `#[test]
  read_skill_content_strips_frontmatter_after_a_utf8_bom` in `src/skill_path.rs`,
  writing a SKILL.md that begins with `\u{feff}---` and asserting the returned body has
  no frontmatter.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed marketplace `metadata.pluginRoot` having no effect: bare plugin source names now resolve under it as the docs describe (2.1.239)

- Checklist row: `CLAUDE-FILE-05` — `src/skills.rs::{list_skills, list_agents}`
- Why it threatens the row: plugins can now live under a marketplace-declared root
  rather than the conventional cache location the scan walks. This is the fourth
  plugin-layout change in the range — `archive` sources and `skills: "."` (pass 1),
  `command` sources with `mode: "link"` (pass 2), and `pluginRoot` here. The scan is
  pinned to one layout that upstream is actively multiplying. Treat these four as one
  piece of work: make discovery read the CLI's own plugin registry instead of
  re-deriving the layout, which is the same class of fix as adopting
  `CLAUDE_CODE_PROJECT_DIR_NAME` for the cwd encoding (pass 2).
- Recommended regression test: add `#[test]
  list_skills_resolves_plugins_under_a_marketplace_plugin_root` in `src/skills.rs`,
  pinning a cache tree whose plugins sit under a declared `pluginRoot`.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- **`SendFeedback` tool** (2.1.247) — a third new built-in tool name this range, after
  `SendMessage` and `ListAgents` (pass 1). All three fall outside the hardcoded category
  lists in `src/adapter.rs::get_tool_categories` and the duplicated literal in
  `src/messages/display_pipeline.rs`, so they render generically. Worth doing as one
  change across all three, and worth noting `CLAUDE-PROBE-02` flags that duplication as
  a standing hazard. Size: small.

## Relevant, no action

**2.1.247**

- Changed Sonnet 5's default auto-compact window to its full 1M context, so sessions now auto-compact at about 967K tokens instead of about 934K — `CLAUDE-PROBE-02`: the row's Verified column already pins `maxTokens 967,000` for claude-sonnet-5. Upstream moved *to* Mainframe's constant, so the gauge is now more accurate, not less. No change needed.
- Fixed sub-agents dying on a first-call model 404: they now use the session's fallback model chain, and the error returned to the parent includes the error type, status, request id, and model — `CLAUDE-FILE-04`: relevant to CLIProxy sessions, whose model ids are the likely 404 source.
- Fixed a hook or background agent printing megabytes of error output wedging the session on "Prompt is too long" — `CLAUDE-FILE-08`: a fix on the background-task path Mainframe tails.
- Fixed unbounded memory growth when a background task's output file could not be written; the file now notes where output was lost — `CLAUDE-FILE-08`: the note is human-readable text in a file Mainframe tails.
- Fixed shell commands carried over from the foreground showing a misleading `[exited with code -1]` line in background sessions — `CLAUDE-FILE-08`: same spool surface.
- Fixed the Bash sandbox's after-command cleanup deleting a dotfile-managed `~/.claude/settings.json` symlink — `CLAUDE-FILE-06`: a different file from the `~/.claude.json` the identity read uses.
- Fixed `/rename` silently confirming when the session registry could not be updated — `CLAUDE-FILE-03`: Mainframe keeps its own titles and scans JSONL directly.
- Fixed `/compact` in sessions started with `--agent` summarizing under the default system prompt — `CLAUDE-EVT-01`: Mainframe passes `--append-system-prompt`, never `--agent`.
- Fixed a version-less marketplace plugin's live cache directory being deleted and recreated on a second-scope install — `CLAUDE-FILE-05`: fewer directories vanishing under the scan.
- Improved plugin marketplace hardening: names with control or invisible characters are rejected — `CLAUDE-FILE-05`: cleaner names in the scanned tree.

**2.1.246**

- Fixed telemetry and metrics requests to Anthropic carrying the API key configured for a third-party gateway (`ANTHROPIC_BASE_URL`); a credential is now only sent to its own host — `CLAUDE-ENV-01`: **worth flagging to the user separately.** Mainframe sets `ANTHROPIC_AUTH_TOKEN` for every CLIProxy session, so on any CLI before 2.1.246 that proxy credential was being sent to Anthropic's telemetry endpoint. No adapter change; an upgrade floor.
- Fixed the background retention sweep removing git worktrees under `.claude/worktrees/` that you created yourself — Mainframe's worktrees live at `.worktrees/`, outside the swept root.
- Fixed the plugin cache creating duplicate SHA-named directories for the same plugin — `CLAUDE-FILE-05`: duplicates would have surfaced as repeated skills in the panel.
- Fixed `/reload-plugins` reporting 0 skills for plugins that define skills under `skills/*/SKILL.md` — `CLAUDE-FILE-05`: confirms that layout is still canonical, which is the one the scan targets.
- Fixed plugin skills whose frontmatter `name` already includes the `<plugin>:` prefix showing it doubled — `CLAUDE-FILE-05`: Mainframe reads the same frontmatter and can double the same way; cosmetic.
- Fixed sessions that ended in plan mode resuming outside plan mode in `claude -p --continue`/`--resume` with a permission prompt tool, when no permission mode was set — `CLAUDE-FLAG-01`: Mainframe *always* passes `--permission-mode`, which is precisely the condition that avoids this.
- Fixed resumed sessions failing every turn with a 400 when the saved history contains tool blocks the API does not accept (typically written by a third-party API proxy) — `CLAUDE-ENV-01`: the CLIProxy path; a fix.
- Fixed MCP tool calls interrupted by an incoming message in headless sessions being reported as "completed with no output" instead of an interrupted error — `CLAUDE-EVT-03`: better `toolUseResult` content on Mainframe's session kind.
- Fixed MCP tool arguments being sent as JSON strings when the parameter schema is empty — `CLAUDE-CTRL-01`: `input` is handled as `serde_json::Value`, which tolerates either.
- Fixed Bash permission checks to always require approval for malformed commands with a dangling `&&` or `||` — `CLAUDE-CTRL-01`: more requests, same shape.
- Windows/macOS: Fixed headless sessions not cleaning up stale entries in `~/.claude/sessions` — Mainframe generates many headless sessions but never reads that directory.
- Fixed `/fork` from an already-forked or backgrounded session starting with an empty conversation — reinforces pass 1's `/fork` worktree risk; the feature is actively churning.
- Fixed prompts beginning with `/--` being rejected as an unknown slash command — `CLAUDE-IO-02`: Mainframe sends explicit command names.
- Improved `/cd`: the new directory's skills and agents now take effect right after the move — `CLAUDE-FILE-05`: complements the 2.1.223 `/cd` resume fix from pass 1.
- Improved subagent results: a subagent stopping at `maxTurns` now returns output marked partial — `CLAUDE-FILE-04`: content change inside the subagent tool_result.

**2.1.243**

- Fixed the status line `rate_limits` fields and `/usage` still showing a window's pre-reset usage percentage after the window reset while idle — `CLAUDE-EVT-05`/`CLAUDE-PROBE-03`: a stale-quota fix on data Mainframe consumes; explains gauges that stayed pinned after a reset.
- Fixed the `/model` picker silently ignoring an Ultracode selection — `CLAUDE-CTRL-03`: confirms `ultracode` is alive, in contrast to the `ultraplan` removal flagged in pass 1.
- Fixed remote MCP servers in non-interactive (`-p`) and SDK sessions never recovering after a dropped connection — Mainframe's session kind; a reliability fix.
- Fixed background subagents not waking when their last background Bash task completes — `CLAUDE-EVT-01`/`CLAUDE-FILE-08`: previously a background task could hang the subagent.
- Fixed cloud sessions resuming with a pending background-task notification re-sent as the prompt — `CLAUDE-EVT-03`: cloud-scoped, but the same notification surface pass 2 flagged for `<system-reminder>` wrapping.
- Fixed sessions going silent for 10+ minutes when the API never starts a response; now `API Error: No response from API` — `CLAUDE-EVT-04`: a bounded failure instead of a hang.
- Fixed `/resume` only listing the 50 most recent sessions — `CLAUDE-FILE-03`: Mainframe scans JSONL directly and was never subject to the cap.
- Fixed `/status` showing "Found invalid entries in: ." when `~/.claude.json` has an invalid MCP server entry — `CLAUDE-FILE-06`: the identity read already degrades to a sentinel.
- Added `modelPicker` and `modelPricing` settings — `CLAUDE-PROBE-01`/`CLAUDE-EVT-04`: Mainframe builds its own picker; `modelPricing` changes the `total_cost_usd` the CLI reports for orgs with contracted rates.
- Fixed plugin dependencies declared with a `marketplace` field never resolving via `--plugin-dir` — `CLAUDE-FILE-05`: more plugins resolve, none move.
- Improved startup time: trust-store, settings, and workflow-discovery work is cheaper — `CLAUDE-FILE-06`: sessions reach Ready sooner.
- Improved usage-telemetry attribution for sessions authenticating with `ANTHROPIC_AUTH_TOKEN` against the Anthropic API — `CLAUDE-ENV-01`: Mainframe's token points at a local proxy, not the Anthropic API.
- Improved the error when effort `xhigh`/`max` is used with thinking off — `CLAUDE-CTRL-03`: a combination Mainframe can produce; pass 1 saw the WebSearch 400 for the same pairing.
- Updated Sonnet 5 pricing to $2/$10 per Mtok as standard list price — `CLAUDE-EVT-04`: changes reported `total_cost_usd`.
- Changed `/model`, `/fast`, and `/effort` to run immediately instead of queueing — `CLAUDE-CTRL-03`: Mainframe drives these through control requests, not slash commands.

**2.1.239**

- Cost estimates now include the 1.1× US-only-inference premium for data-residency workspaces — `CLAUDE-EVT-04`: `total_cost_usd` shifts for those workspaces.
- Cloud sessions: plugins synced from claude.ai now show as `name@synced` — `CLAUDE-FILE-05`: a naming convention in the scanned tree.
- The usage-limit message now also says when your session or weekly limit resets — `CLAUDE-PROBE-03`: message copy, not `/usage` output; the buckets named match the row's `five_hour`→Session, `seven_day`→Weekly mapping.
- Fixed a raw crash dump when starting from a directory that no longer exists — Mainframe removes worktrees under live sessions; this turns a crash into a message.
- Fixed a race where pressing Esc with a prompt queued could let the next turn finish early, leaving the session idle while Claude was still working — `CLAUDE-EVT-03`: the queued-message contract Mainframe mirrors via `queuedRefs`; a desync fix on a fragile surface.
- Fixed custom session titles disappearing from `/resume` after ~64 KB of conversation — `CLAUDE-FILE-03`: Mainframe keeps its own titles.
- Fixed `/resume` showing a session as recently changed when only its file was touched — `CLAUDE-FILE-03`: the scan dedupes by mtime, so the same signal is imprecise there too; ordering only.
- Fixed `/resume` in all-projects mode telling you to `cd` into a deleted directory such as a removed worktree — `CLAUDE-FILE-03`: matches Mainframe's own orphaned-worktree handling.
- Fixed hooks failing with "posix_spawn ENOENT" after the session's working directory was deleted — same removed-worktree trigger.

**2.1.238**

- Fixed leftover `/tmp/claude-*-cwd` files when a Bash command is killed or interrupted — `CLAUDE-FILE-08`: the spool root is `/tmp/claude-<uid>`; these are siblings in the same namespace, and the row's stated risk is exactly a change to that naming scheme. Nothing to change, but it confirms the namespace is in active use.
- Fixed per-task Stop from the Remote Control tasks panel doing nothing on CLI-hosted sessions — `CLAUDE-CTRL-03`: `stop_task` is the middle tier of Mainframe's interrupt escalation. If it was a no-op on CLI-hosted sessions, escalation was falling through to the 10s SIGINT fallback; it should now stop there more often.
- Fixed remote sessions exiting when a client delivered a user message without a valid role — `CLAUDE-IO-02`: verified both outbound envelopes set `role: "user"` (`src/session.rs::send_command` and `src/user_payload.rs::build_user_payload`), so Mainframe cannot trigger it.
- Improved Bash tool permission checking for zsh-specific syntax in shell conditionals — `CLAUDE-CTRL-01`: continues the 2.1.221 `[[ ]]` fix; more requests, same shape.
- MCP `headersHelper` in a project `.mcp.json` now requires that folder's trust dialog to have been accepted, also under `claude -p` — `CLAUDE-FILE-06`: more paths now gated on the trust flag Mainframe writes, reinforcing pass 2's nested-repo trust risk.

## Dropped as irrelevant (191)

Per-version: 2.1.247 (22), 2.1.246 (44), 2.1.245 (1), 2.1.243 (42), 2.1.241 (1),
2.1.240 (1), 2.1.239 (46), 2.1.238 (34). The categories: fullscreen and classic TUI
rendering, themes, keybindings and Vim mode, VSCode extension entries, Remote Control
and cloud sessions, `claude self-hosted-runner`, cross-session messaging, sandbox and
secret-redaction settings, marketplace and managed-settings policy, Bedrock/Vertex/
Foundry authentication, MCP OAuth and elicitation dialogs, `/goal` and `/loop`
interactive behaviour, installer and binary-size work, Claude in Chrome, and Windows-only
fixes. 2.1.240, 2.1.241, and 2.1.245 contributed only a stock "Bug fixes and reliability
improvements" line or a Linux glibc startup fix.
