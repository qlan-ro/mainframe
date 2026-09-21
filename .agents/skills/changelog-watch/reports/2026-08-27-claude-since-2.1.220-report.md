# changelog-watch: claude 2.1.220 → 2.1.228 (2026-08-27)

Pass 1 of 3 over the 2.1.220 → 2.1.247 range.

Entries seen: 148 · risks: 8 · opportunities: 4 · relevant, no action: 40 · dropped as irrelevant: 98

Opportunity count is 2 entries classified as opportunities plus 2 noted inline on a
no-action row. Every bullet in the eight versions is accounted for below or in the
dropped total.

## Compatibility risks

### high — Fixed long (>200 char) project paths resolving to another project's session directory under a shared sanitized prefix; session list, rename, fork, delete and `/resume` no longer cross projects (2.1.224)

- Checklist row: `CLAUDE-FILE-01` — `src/transcript.rs::encode_project_path`; also `CLAUDE-FILE-03` (`src/external_session_paths.rs::encode_path`) and `CLAUDE-FILE-07`
- Why it threatens the row: both Mainframe encoders are pure per-character maps with
  no length bound — verified by reading them. For the CLI to have had a "shared
  sanitized prefix" collision at all, it must truncate or hash long paths, and the fix
  changes whatever it now does past that bound. Any project path over ~200 characters
  therefore encodes to a directory name Mainframe derives but the CLI never writes:
  history load and resume find nothing, with no error. `CLAUDE-FILE-03`'s scan globs
  `<encoded-or-prefix->*`, so external-session discovery may still hit; the exact
  derived path in `CLAUDE-FILE-01` will not. Deep worktree paths under
  `.worktrees/<name>` are the realistic trigger.
- Recommended regression test: add `#[test]
  encode_project_path_matches_the_cli_for_a_path_over_200_chars` in
  `src/transcript.rs`, pinning the directory name the CLI actually creates for a
  >200-char cwd (capture it live first, then hardcode it); mirror the same fixture in
  `src/external_session_paths.rs`. Assert the resolved directory string, not that
  encoding returned something.
- Verify live: .claude/skills/claude-protocol-debugger/

### high — Changed auto-compact to keep sessions on unrecognized model IDs within the assumed context window instead of letting them grow past it; set `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` to restore the previous behavior (2.1.223)

- Checklist row: `CLAUDE-ENV-01` — `src/session.rs::build_spawn_command`, `src/cliproxy.rs::resolve_env`; window constants in `CLAUDE-PROBE-02` (`src/adapter.rs::claude_models`)
- Why it threatens the row: every CLIProxy session passes a bare non-Anthropic id as
  `--model` — `src/cliproxy.rs::split_endpoint` strips the `cliproxy/` namespace and
  hands the CLI ids like `gpt-5.6-sol`. Those are exactly the "unrecognized model IDs"
  this entry now clamps to an assumed window. Proxy sessions can start auto-compacting
  far earlier than their real window, silently discarding context, while Mainframe's
  gauge still divides by its own constant. Nothing errors.
- Recommended regression test: add `#[test]
  a_proxy_session_disables_unknown_model_window_enforcement` in `src/session.rs`
  alongside `a_proxy_session_is_pointed_at_the_endpoint_and_stripped_of_the_real_api_key`,
  asserting the spawn env carries
  `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` — once the live check
  confirms the clamp fires for proxy ids.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Changed `CLAUDE_CODE_DISABLE_1M_CONTEXT` to hold every Claude model with a native 1M window to 200K via auto-compaction, not just a fixed list; a startup warning now appears when auto-compaction isn't holding the session to 200K (2.1.223)

- Checklist row: `CLAUDE-PROBE-02` — `src/adapter.rs::claude_models` (`EXTENDED_CONTEXT_WINDOW`); and `CLAUDE-IO-01` — `src/events.rs::is_informational`
- Why it threatens the row: two separate exposures. If the var is set in the user's
  login shell, the effective window is 200K while Mainframe's gauge still divides by
  the 1M constant, so the context indicator reads roughly five times low. Separately,
  the new startup warning is a fresh stderr line: `is_informational` filters only
  `debugger`, `warning:`, `deprecationwarning`, `experimentalwarning`, `(node:N)`, and
  `Cloning into` — verified by reading it — so unless the line leads with `Warning:`,
  Mainframe reports it as a session error on every start.
- Recommended regression test: extend
  `src/events.rs::stderr_filters_informational_and_empty` with the warning's verbatim
  text, asserting the classification you want rather than that handling succeeded.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed `/usage` overattributing usage to MCP servers: a server's share now reflects only the requests that actually consumed its tool results, instead of every turn after any call to it (2.1.222)

- Checklist row: `CLAUDE-PROBE-03` — `src/quota_parse.rs::parse_claude_usage`
- Why it threatens the row: the row's own note calls these prose anchors the
  highest-risk item in the file, with the percent load-bearing. This entry changes what
  `/usage` prints in its MCP breakdown. A recomputed or restructured section can move
  the text the percent anchor keys off, and the parser has no way to signal that it
  matched the wrong line — quota just reads Unknown.
- Recommended regression test: extend
  `src/quota_parse.rs::parses_the_percent_with_and_without_a_space_before_used` with a
  `/usage` body captured from 2.1.222+ including the MCP breakdown, asserting the parsed
  percent value.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Changed plugins to accept `"."` as a `skills` path, and the root-level `SKILL.md` validation error now suggests using the plugin root (2.1.221)

- Checklist row: `CLAUDE-FILE-05` — `src/skills.rs::list_skills`
- Why it threatens the row: the scan walks the plugin cache layout for skills under a
  `skills/` directory. A plugin declaring `skills: "."` puts its `SKILL.md` at the
  plugin root instead, so its skills never appear in Mainframe's panel while the CLI
  lists them. The scan returns fewer entries and reports success.
- Recommended regression test: add `#[test]
  list_skills_finds_a_plugin_skill_at_the_plugin_root` in `src/skills.rs`, building a
  temp plugin whose `SKILL.md` sits at the root, asserting the skill name comes back.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Added `archive` plugin source: install plugins from a zip over HTTPS without git or npm, with optional SHA-256 pinning (2.1.224)

- Checklist row: `CLAUDE-FILE-05` — `src/skills.rs::{list_skills, list_agents}`
- Why it threatens the row: the scan hardcodes the plugin cache layout, which was
  reverse-engineered from git- and npm-installed plugins. A third install source may
  materialize on disk differently (SHA-named directory, no version segment). If it
  does, archive-installed plugins' skills and agents are silently absent. Lower
  confidence than the others here — the cache layout may well be unified downstream of
  the source — so confirm on disk before filing.
- Recommended regression test: add `#[test]
  list_skills_covers_the_archive_source_cache_layout` in `src/skills.rs`, pinning the
  directory shape an archive-installed plugin actually produces (capture it first).
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Changed sessions forked with `/fork` to create a new worktree of their own instead of working in the original session's checkout (2.1.221)

- Checklist row: `CLAUDE-FILE-01` — `src/transcript.rs::get_session_jsonl_path`
- Why it threatens the row: the transcript directory is derived from the cwd. A `/fork`
  now relocates the session to a new worktree, so the fork's JSONL lands under a
  different encoded project directory than the chat Mainframe is tracking. The
  worktree-relocation case in `SESSIONS_JSONL.md` is verified against 2.1.220 — this
  change is the very next version, so the doc does not cover this trigger.
- Recommended regression test: add `#[test]
  a_forked_session_transcript_resolves_under_the_fork_worktree` in `src/transcript.rs`,
  pinning the encoded directory for the fork's worktree cwd.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Changed fast mode to report on the stream when usage credits run out mid-session, instead of failing silently (2.1.221)

- Checklist row: `CLAUDE-EVT-01` — `src/events.rs::handle_system_event`; fast mode is driven from `CLAUDE-CTRL-03` (`fastMode` in `apply_flag_settings`)
- Why it threatens the row: Mainframe turns fast mode on, so it can hit this state. The
  new report arrives as stream content the adapter has never seen, and per the crate's
  contract an unrecognized event type is debug-logged and skipped. The upstream fix for
  "failing silently" then still reads as silent inside Mainframe.
- Recommended regression test: add `#[test]
  fast_mode_credit_exhaustion_surfaces_to_the_user` in `src/events.rs`, feeding the
  captured event and asserting a user-visible signal rather than the debug fall-through.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- **`SendMessage` / `ListAgents` built-in tools** (2.1.224) — new tool names will appear
  in `assistant` tool_use events and fall outside the hardcoded category lists in
  `src/adapter.rs::get_tool_categories` and the inline literal in
  `src/messages/display_pipeline.rs`, so they render generically. Size: small.
- **PR detection for REST-API-created PRs** (2.1.222) — the CLI now links PRs created
  after the push, including through the GitHub REST API. Mainframe's
  `src/pr_detection.rs` reads Bash command text only, so a PR opened via REST or MCP is
  invisible to it. Size: medium.
- **Auto permission mode** (2.1.225, and repeatedly through this range) — `CLAUDE-FLAG-01`
  pins a four-value mode vocabulary that has no `auto`. Upstream is investing heavily in
  auto mode (classifier rules, parallel-check caching, a `/permissions` tab). Size:
  medium — mode selector plus classifier semantics.
- **Sanitize invisible Unicode in the permission gate** (2.1.223) — upstream now stops
  tabs and invisible Unicode from hiding part of a command in its approval dialog.
  Mainframe renders the `can_use_tool` `input` verbatim in its own gate, so the same
  spoof still works there. This is a Mainframe-side gap, not upstream drift. Size: small.

## Relevant, no action

**2.1.228**

- Fixed session cleanup deleting contents inside a project's memory folder — `CLAUDE-FILE-05`: the scan reads `skills`, `commands`, and `agents`; the memory folder is not among them.
- Fixed background plugin-cache cleanup deleting a plugin's cache when its only version is a symlinked development checkout — `CLAUDE-FILE-05`: an upstream fix that keeps a directory the scan reads from vanishing.
- Fixed the deferred-tools reminder occasionally being sent to the model twice after a skill invocation — `CLAUDE-EVT-03`: the reminder rides in a meta user event that is already suppressed.
- Hardened skills synced from claude.ai — `CLAUDE-FILE-05`: description text changes only; the directory scan and frontmatter strip are untouched.
- Improved compaction progress: retry countdown and stall hint — `CLAUDE-EVT-01`: interactive rendering; the `compact_boundary` and `status == "compacting"` signals are unchanged.

**2.1.225**

- Added gateway spend-limit support to Claude Code's usage warning — `CLAUDE-PROBE-03`: gateway-gated copy in a limit-reached warning, not `/usage` output, and the quota pull deliberately runs without the proxy env so it always reports the real account.
- Added a workspace trust prompt to `claude agents` for untrusted directories — `CLAUDE-IO-01`: added to a subcommand Mainframe never spawns; the `claude` stderr advisory the trust router matches is unchanged.
- Fixed a transient 401 replacing a long-lived `CLAUDE_CODE_OAUTH_TOKEN` — `CLAUDE-ENV-01`: token-precedence fix; Mainframe's contract already strips `ANTHROPIC_API_KEY` and supplies its own auth token.
- Fixed auto mode counting a safety-filter refusal toward the consecutive-block limit — `CLAUDE-FLAG-01`: auto is outside the four modes Mainframe passes. (Adoption angle noted above.)

**2.1.224**

- Fixed plugin install records being silently corrupted when the same plugin is installed in multiple projects — `CLAUDE-FILE-05`: an upstream fix; corrupted records could previously make the scan miss entries.
- Fixed Remote Control and SDK clients showing a blank "(no content)" message after `/clear` — `CLAUDE-EVT-03`: `CLEAR.md` is a feasibility study, not shipped behaviour — the adapter has no `/clear` handling, so this removes a message nothing reads.
- Removed the 200-subagent-per-session spawn cap — `CLAUDE-FILE-04`: no shape change; sidechain discovery has no cap of its own.
- Fixed a session resume silently reconnecting Remote Control after the user turned it off (`--resume`, SDK hosts) — `CLAUDE-FLAG-01`: a fix on a flag Mainframe passes, in Mainframe's favour.

**2.1.223**

- Added a warning when a requested subagent model is restricted and the parent model runs instead — `CLAUDE-IO-01`: `^Warning:` is already filtered; only a differently-prefixed line would surface.
- Fixed a Bash permission bypass where a crafted command could hide parts of itself — `CLAUDE-CTRL-01`: more `can_use_tool` requests, same shape.
- Fixed permission prompts so commands padded with tabs or invisible Unicode can no longer hide part of the command — `CLAUDE-CTRL-01`: same, plus the Mainframe-side gap noted under opportunities.
- Fixed a permission gap where an agent definition's `bypassPermissions` mode ignored the org disable policy — `CLAUDE-FLAG-01`: scoped to agent-definition bypass; Mainframe sets the mode at spawn.
- Fixed resuming a session after a mid-session `/cd` coming back empty — `CLAUDE-FILE-01`/`CLAUDE-FILE-02`: the stored `session_file_path` is checked before the derived path.
- Fixed gateway model discovery hiding Claude models registered under provider-prefixed IDs — `CLAUDE-PROBE-01`: additive catalog entries, and `split_endpoint` strips `cliproxy/` by length, so a bare id containing further slashes survives intact.
- Fixed `modelOverrides` keys that aren't Anthropic model IDs being treated as canonical — `CLAUDE-PROBE-01`: Mainframe passes `--model` directly and never writes `modelOverrides`.
- Fixed a resumed session failing every turn when its history held a malformed diagnostics attachment — `CLAUDE-FILE-04`: history reconstruction already skips unknown blocks.
- Changed `/review` to be an alias of `/code-review` — `CLAUDE-IO-02`: command text is forwarded verbatim and still resolves.

**2.1.222**

- Fixed the startup connectivity check hanging behind an HTTPS proxy — `CLAUDE-ENV-01`: proxy sessions previously risked a hung start; it now fails fast.
- Fixed "Connection closed mid-response" errors on responses that had completed — `CLAUDE-EVT-04`: fewer spurious `is_error` results.
- Fixed org-restricted `model: opus`-style family aliases dropping to the parent model — `CLAUDE-PROBE-02`: Mainframe passes resolved ids, never family aliases.
- Fixed stream idle timeout firing on custom `ANTHROPIC_BASE_URL` gateways despite keep-alive pings — `CLAUDE-ENV-01`: directly on Mainframe's proxy path, and a fix — a plausible retrospective explanation for past CLIProxy session drops.
- Fixed tool errors not being displayed for tools no longer available locally — `CLAUDE-EVT-03`: error text now present in `toolUseResult` where there was none.
- Improved the refusal when Claude invokes a skill with `disable-model-invocation` — `CLAUDE-EVT-02`: a refusal produces no `Skill` tool_use, so the panel simply does not fire.
- Removed ultraplan feature — `CLAUDE-CTRL-03`: Mainframe sends `ultracode`, never `ultraplan`. Worth watching: the neighbouring key in the same `apply_flag_settings` payload was just removed.

**2.1.221**

- Fixed a Bash permission-check bypass where zsh could execute hidden commands in `[[ ]]` conditionals — `CLAUDE-CTRL-01`: more requests, same shape.
- Fixed the thinking toggle having no effect for a session that started with thinking off — `CLAUDE-CTRL-03`: a fix on `alwaysThinkingEnabled`, which Mainframe drives; mid-session tuning changes now take effect.
- Fixed MCP servers from `--mcp-config` not being connected before the first turn in print mode — `CLAUDE-FLAG-02`: the `-p` spawns pass no `--mcp-config`.
- Fixed WebSearch failing with a 400 at effort `xhigh`/`max` when thinking is disabled — `CLAUDE-CTRL-03`: a combination Mainframe can produce, fixed upstream with no adapter change.
- Fixed `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=0` not being honored — `CLAUDE-FLAG-01`: Mainframe does not set the var, so auto-resume behaviour is unchanged. Setting it to `0` is a possible way to stop surprise turns on resume.
- Fixed session renames from Desktop or claude.ai not reaching the CLI; names now sanitized — `CLAUDE-FILE-03`: the external scan is stat-only and reads uuid filenames, not names.
- Fixed plugin- and org-delivered skills named after terminal-only built-ins being un-invocable in non-interactive sessions — `CLAUDE-FILE-05`/`CLAUDE-IO-02`: directly on Mainframe's session kind; such skills were listed but no-oped when sent, and now work.
- Improved auto mode: parallel permission checks and mode switching mid-check — `CLAUDE-CTRL-03`: auto is outside Mainframe's mode vocabulary.
- Improved Stats panel to count cache tokens with a breakdown — `CLAUDE-EVT-04`: a TUI aggregation of the same `usage` fields; the stream shape is unchanged.
- Changed plugins installed from `/plugin` to activate immediately — `CLAUDE-FILE-05`: the scan is filesystem-based, so directories simply appear sooner.
- Changed the Gateway `model` field validation to reject non-string values — `CLAUDE-ENV-01`: Mainframe always sends a string.

## Dropped as irrelevant (98)

Per-version: 2.1.228 (13), 2.1.227 (5), 2.1.226 (1), 2.1.225 (10), 2.1.224 (24),
2.1.223 (8), 2.1.222 (12), 2.1.221 (25). The categories: TUI and fullscreen rendering,
Vim mode, VSCode extension entries, Remote Control and cloud-session behaviour,
`claude self-hosted-runner`, cross-session messaging inboxes, sandbox and
credential-masking settings, managed-settings and marketplace policy, Bedrock and
Vertex authentication, Windows-only fixes, and the single "Bug fixes and reliability
improvements" line in 2.1.226.
