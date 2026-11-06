# changelog-watch: claude 2.1.247 → 2.1.263 (2026-10-17)

Pass 1 of 5. Versions covered: 2.1.248, 2.1.250, 2.1.251, 2.1.252, 2.1.257, 2.1.258,
2.1.259, 2.1.260, 2.1.261, 2.1.263. The delta has no section for 2.1.249, 2.1.253–2.1.256
or 2.1.262. 2.1.258 fixes "a regression introduced in 2.1.255", so 2.1.255 shipped
without its own changelog section.

Entries seen: 402 · risks: 7 · opportunities: 5 · relevant, no action: 65 · dropped as irrelevant: 325

Per-version dropped counts: 2.1.263 1, 2.1.261 57, 2.1.260 48, 2.1.259 29, 2.1.258 2,
2.1.257 85, 2.1.252 1, 2.1.251 55, 2.1.250 1, 2.1.248 46. Most of the dropped entries are
VSCode-tagged, Remote Control, Claude apps gateway, `claude agents`/background-session,
cloud, and TUI changes.

The checklist itself is behind the code in two places. `CLAUDE-FLAG-01` lists the
permission modes as `default|acceptEdits|bypassPermissions|plan`, but
`src/session_controls.rs::execution_mode_cli` maps `ExecutionMode::Auto` to `auto`
(`src/session_tests_spawn_part_1.rs::auto_mode_passes_permission_mode_auto`).
`CLAUDE-EVT-06` says `stream_event` is deliberately unhandled, but `src/events.rs` routes it
to `partial_stream::handle_stream_event`, and `build_args` conditionally passes
`--include-partial-messages`. Because Mainframe does run auto mode, this pass classifies
auto-mode permission entries as relevant instead of treating them as code paths
Mainframe never enters.

## Compatibility risks

### high — Added a Spend limit bar to `/usage` and a `rate_limits.spend_limit` status line field for developers behind a Claude apps gateway with spend limits (2.1.251)

- Checklist row: `CLAUDE-PROBE-03` — `src/quota_parse.rs::parse_claude_usage`
- Why it threatens the row: the parser fails closed by design. Any non-empty line
  before "What's contributing" that is not a session, weekly, or weekly-model row
  returns `unknown(now)` for the whole provider
  (`fails_the_whole_provider_to_unknown_on_an_unclassifiable_non_empty_line` pins this).
  A Spend limit bar is that kind of line, so every gateway user with a spend limit gets
  quota Unknown and no error. The audience is narrow, but the failure is silent. This is
  the fourth `/usage` layout change the watch has flagged, after 2.1.222, 2.1.236 and
  2.1.243 in the 2026-08-27 passes. It supports pass 3's recommendation to re-derive the
  parser rather than keep patching anchors.
- Recommended regression test: add `#[test]
  a_spend_limit_row_does_not_fail_the_usage_parse` in `src/quota_parse_tests.rs`. Pin
  a `/usage` body captured from a gateway account with a spend limit (capture it live
  first) and assert that `status` is known and the session window's `used_percent`
  equals the captured value, not `ProviderQuotaStatus::Unknown`.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Added Claude Fable 5.1 (`claude-fable-5-1`), now the default Fable model — 1M context, $10/$50 per Mtok with $0.25/Mtok cache reads (2.1.257)

- Checklist row: `CLAUDE-PROBE-02` — `src/models.rs::{claude_models, enrich_with_context_window}`; also `CLAUDE-PROBE-01`
- Why it threatens the row: the static catalog lists `claude-fable-5` but not
  `claude-fable-5-1`. `enrich_one` assigns a window from a description hint, the
  static id, or the entry's `resolvedModel`, in that order. A `fable` alias that used to
  resolve to `claude-fable-5` (found in the catalog, so 1M) now resolves to
  `claude-fable-5-1` (not found). Unless the probe description happens to contain "1M",
  the window comes back `None`
  (`unknown_windows_require_a_description_hint`). If the probe fails, the fallback
  catalog does not offer Fable 5.1 at all. 2.1.260's "/model picker not showing Fable
  5.1" fix means more organizations now get this entry from the probe.
- Recommended regression test: add `#[test]
  gives_claude_fable_5_1_the_extended_window_via_its_resolved_model` in
  `src/models_tests.rs`. Pin `probed_full("fable", "<captured description>",
  "claude-fable-5-1")` and assert `Some(1_000_000)`. Also extend
  `model_windows_and_effort_ladders_match_the_cli_registry` to require `claude-fable-5-1`
  at `EXTENDED_CONTEXT_WINDOW`.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Fixed concurrent sessions silently reverting each other's `~/.claude.json` changes — workspace trust no longer resets and MCP/project state is no longer lost when running many sessions at once (2.1.259)

- Checklist row: `CLAUDE-FILE-06` — `src/trust_store.rs::write_workspace_trust`
- Why it threatens the row: Mainframe is one of those concurrent writers. It reads the
  file, modifies it, and replaces it with an atomic tmp+rename, without taking any lock.
  Upstream has now added some cross-process coordination between CLI processes (a lock
  or a re-read-and-merge). Mainframe's writer is outside that protocol. A Mainframe trust
  write can still be reverted by a running session, which brings back the trust prompt.
  Mainframe's own rewrite can also drop a key a CLI session wrote between Mainframe's read
  and rename, and that loss is silent. The existing tests only cover sequential writes.
- Recommended regression test: first find out how the CLI coordinates writes (look for
  a lock file next to `~/.claude.json`, or merge-on-write). Then add `#[tokio::test]
  write_workspace_trust_honours_the_cli_config_lock` in `src/trust_store_tests.rs`. Hold
  the CLI's lock in the test and assert the write waits for it or re-reads, so a key added
  under the lock survives.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Added a one-time prompt in auto mode before the first file read outside the working directories, with the option to block such reads (`permissions.blockReadsOutsideWorkingDirectories`) (2.1.257)

- Checklist row: `CLAUDE-CTRL-01` — `src/event_control.rs::handle_control_request_event` (imported into `src/events.rs`); also `CLAUDE-CTRL-04`
- Why it threatens the row: Mainframe runs auto mode, so in a headless session this
  prompt arrives as a `can_use_tool`. The "block such reads" choice probably travels as a
  permission suggestion of a type Mainframe does not model. `permission_suggestions` is
  deserialized as one `Vec<ControlUpdate>` through `.ok()` and then `unwrap_or_default()`.
  A single unknown `type` therefore empties the whole list silently, and the card loses
  its "always allow" options along with the new one. The same all-or-nothing path is
  worth checking for `setMode` suggestions, because `PermissionMode` spells
  bypass as `yolo`.
- Recommended regression test: add `#[test]
  can_use_tool_keeps_known_suggestions_beside_an_unknown_one` in
  `src/events_tests_control.rs`. Feed `permission_suggestions: [{type:"addRules",…},
  {type:"<captured type>",…}]` and assert the emitted `ControlRequest.suggestions` still
  contains the `AddRules` entry.
- Verify live: .claude/skills/claude-protocol-debugger/

### medium — Added server-managed settings diagnostics: a startup warning when the settings fail to load, and a `/doctor` and `/status` line explaining a load failure or why they weren't fetched (Bedrock/Vertex/third-party provider, custom `ANTHROPIC_BASE_URL`) (2.1.248)

- Checklist row: `CLAUDE-IO-01` — `src/events.rs::{is_informational, handle_stderr}`
- Why it threatens the row: every stderr line that does not start with one of the six
  filtered prefixes goes to `sink.on_error`. If this startup warning reaches stderr in
  headless mode without a `Warning:` prefix, every spawn for an affected user shows an
  error. The trigger list includes "custom `ANTHROPIC_BASE_URL`", and that is every
  CLIProxy session (`CLAUDE-ENV-01`). This is the same class as pass 2's
  `[claude-code:unrecognized_model]` stderr line.
- Recommended regression test: extend
  `src/events_tests_stderr.rs::stderr_filters_informational_and_empty` with the warning
  text captured verbatim from a headless spawn behind `ANTHROPIC_BASE_URL`. Assert that
  no `on_error` fires and that `stderr_emits_error_for_non_informational` still holds.
- Verify live: .claude/skills/claude-protocol-debugger/

### low — Fixed plugins being able to read files outside their own directory through a declared command, agent, skill, hooks or other component path that is a symlink; such paths are now refused with an error (2.1.257)

- Checklist row: `CLAUDE-FILE-05` — `src/skills/scan.rs::list_skills` (re-exported from `src/skills.rs`)
- Why it threatens the row: the scan calls `fs::canonicalize` on each `SKILL.md`, so it
  follows symlinks. A plugin skill that links outside its plugin directory still appears
  in Mainframe's panel even though the CLI now refuses to load it. This continues the
  plugin-layout series from the 2026-08-27 passes.
- Recommended regression test: add `#[tokio::test]
  list_skills_skips_a_plugin_skill_symlinked_outside_its_plugin_dir` to the test module
  in `src/skills/scan.rs`. Create a plugin `skills/x` symlink that points outside the
  plugin's install path and assert it is not listed.
- Verify live: .claude/skills/claude-protocol-debugger/

### low — Fixed managed-settings `disableAutoMode` arriving mid-session not moving an already-running auto-mode session back to default mode (2.1.251)

- Checklist row: `CLAUDE-FLAG-01` — `src/session_controls.rs::execution_mode_cli`; also `src/event_system.rs::handle_system_event`
- Why it threatens the row: Mainframe assumes it owns the permission mode it set. The
  CLI can now change that mode itself. `handle_system_event` reads `status` only for
  `"compacting"`, so a mode change carried on a status event is ignored. The UI keeps
  showing Auto while the CLI is in default mode. The visible symptom is unexpected prompts,
  and it only affects managed-settings organizations.
- Recommended regression test: capture the event the CLI emits when the mode is forced
  back. Then add `#[test] a_status_event_with_a_forced_permission_mode_is_surfaced` in
  `src/events_tests_init.rs` and assert the sink receives the new mode.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- `--append-subagent-system-prompt-file` (2.1.261) would land in `src/session_spawn.rs::build_args` (`CLAUDE-FLAG-01`). It would send the orchestration prompt to subagents, and reading from a file sidesteps argv length limits. Size: small.
- `--permission-prompts none` (2.1.259) would land in `build_args` for unattended chats such as background delegated tasks. Anything that would prompt is denied instead of waiting for an answer that never comes. Size: small.
- `/reload-plugins` is now in headless sessions and the SDK command list (2.1.260). Mainframe could send it through `src/session_prompt.rs::send_command` after a plugin change. The init `slash_commands` list is not read today. Size: small.
- `/advisor` text form for headless sessions (2.1.260) would need a composer affordance for the advisor model, reached through `send_command`. Size: medium.
- `--restricted` / `CLAUDE_CODE_RESTRICTED=1` (2.1.248) could back a restricted chat mode: no command or code tools, file tools kept inside cwd, bypass refused. It needs a flag in `build_args` plus a mode toggle. Size: medium.

## Relevant, no action

- Added `bashOutputMaxChars` and `taskOutputMaxChars` settings to raise how much command and background-task output Claude receives inline before it is saved to a file, up to 128K characters — CLAUDE-FILE-08: the settings change only the model's inline slice. The spool file Mainframe tails is still written in full.
- Fixed resuming a session losing hook output and other context around parallel tool calls, which changed the resumed request — CLAUDE-FILE-04: the fix is in the CLI's own resume path. Mainframe reads the JSONL independently.
- Fixed SDK and cloud sessions ignoring a Stop or interrupt sent just after the first prompt, before the turn had started; the turn now stops instead of running to completion — CLAUDE-CTRL-03: the protocol `interrupt` now lands, so the SIGINT fallback fires less often.
- Fixed `/usage` and the VS Code usage panel dropping a model-specific weekly limit row when the usage endpoint is rate limited or when opened right after startup — CLAUDE-PROBE-03: `weekly_model_label` matches any `Current week (<label>):` row, so the restored row parses.
- Fixed `claude -p --resume <file>` adopting a malformed session ID recorded in the transcript; it now resumes under a fresh session ID instead — CLAUDE-FILE-09: fork snapshots carry the parent's well-formed UUID, and `--fork-session` already takes a fresh id from `init`.
- Fixed plugin install hints from CLIs run in background Bash commands: they are now detected, and the raw `<claude-code-hint>` tag no longer leaks into the conversation — CLAUDE-EVT-03: upstream now strips the tag before it reaches the transcript.
- Improved the dangerous-`rm` safety prompt to also catch `rm -rf` on positional parameters and inside double-quoted `sh -c` scripts — CLAUDE-CTRL-01: more prompts, sent as ordinary `can_use_tool` requests.
- Changed auto mode to treat a link that packs content into a public diagram renderer's URL as an upload to that site: no longer auto-approved unless you asked for it — CLAUDE-CTRL-01: an auto-mode classifier change that surfaces as an ordinary `can_use_tool`.
- Changed `/context` token counting to use a local estimate when the token-counting API is unavailable, instead of extra small-model requests — CLAUDE-CTRL-02: the response shape is unchanged. CLIProxy sessions get an estimate instead of small-model calls the proxy cannot serve.
- Fixed `Edit`/`Write`/`Read` permission rules whose path contains parentheses being dropped as invalid or ignored by the Bash sandbox, which left "read-only" folders writable — CLAUDE-CTRL-04: rules Mainframe forwards now apply as written.
- Fixed one file permission rule with an uncompilable pattern (e.g. an unclosed `[`) making every file edit fail with `Invalid regular expression`; such a deny rule now guards the literal path it spells — CLAUDE-CTRL-04: a rule-evaluation fix, with no envelope change.
- Fixed Bash permission checks auto-approving zsh commands that hide a command substitution in a REPORTTIME, REPORTMEMORY or DIRSTACKSIZE assignment; these now prompt for approval — CLAUDE-CTRL-01: same `can_use_tool` shape.
- Fixed the `/model` picker not showing Fable 5.1 for organizations that can use it, which was only accepted when typed as `/model claude-fable-5-1` — CLAUDE-PROBE-01: the probe maps the new entry with no code change. The window gap is covered by the Fable 5.1 risk above.
- Fixed model switching staying blocked for the rest of the session after a plugin hook load failure; each switch now re-checks and the refusal names the cause — CLAUDE-CTRL-03: `set_model` goes through `require_success`, which already surfaces the refusal text.
- Fixed model switching being blocked for the session when an organization-managed plugin's marketplace could not be loaded — CLAUDE-CTRL-03: same `require_success` path.
- Fixed SDK-provided MCP servers (e.g. Desktop connectors) sometimes missing from the first turn and only appearing on the next one — CLAUDE-FLAG-04: Mainframe's server is injected with `--mcp-config` and is not SDK-provided.
- Fixed `-p --resume`/`--continue` (as used by the desktop app) failing on every retry once a session's worktree directory lost its git metadata; it now fails once, then resumes without the worktree — CLAUDE-FLAG-01: this covers CLI-managed worktrees. Mainframe spawns with the worktree as cwd.
- Fixed intermittent "task output swap refused" errors when many sessions share a project directory — CLAUDE-FILE-08: the fix is on the CLI's write side. The spool path scheme is unchanged.
- Fixed plugins from a URL marketplace failing to install with "marketplace entry path does not stay inside the marketplace directory" when a host app (e.g. Claude Desktop) stores it as a directory — CLAUDE-FILE-05: an install fix. The plugin still lands in the cache layout the scan walks.
- Glob/Grep: Fixed the search path being probed on disk before the permission check; a missing path is now reported after permission is decided, as Read does — CLAUDE-CTRL-01: only the order changes, and the prompt shape is the same.
- Reverted the 2.1.259 change applying `Read()` deny rules to Bash arguments; it denied `npm run build` under a `Read(./**/build/**)` rule in every mode and made `cd … && grep` prompt even in auto mode — CLAUDE-CTRL-01: fewer prompts, same shape.
- Improved auto-compact for 1M-context models: Opus and Fable sessions now compact shortly before the 1M-token limit, and recovery compaction on very large contexts no longer times out at 10 minutes — CLAUDE-PROBE-02: Opus 5/4.8/4.7 and Fable 5 are already pinned at `EXTENDED_CONTEXT_WINDOW`.
- Improved `/effort` on Claude Fable 5.1 so changing effort mid-session no longer invalidates the prompt cache — CLAUDE-CTRL-03: a cache-cost fix. `apply_flag_settings` is unchanged.
- Changed permission rules with text after the closing parenthesis (e.g. `Bash(ls) x`), which never matched anything, to be reported as invalid settings instead of being silently ignored — CLAUDE-CTRL-04: Mainframe forwards CLI-built suggestions and writes no rules of this form.
- Removed the one-hour time limit on background commands started by subagents; they now run until they exit or are stopped, matching the main session — CLAUDE-FILE-08: nothing in the spool tail or liveness sweep assumes a one-hour cap.
- Fixed Bash `Read()` deny rules not covering files given as option values (`--ignore-revs-file=.env`, `-f.env`, `@file`), `git diff`/`git grep` file operands, or `cd DIR && cat FILE` compounds; `grep -r`/`cp -r` over a directory holding a denied file now asks — CLAUDE-CTRL-01: the new asks come as ordinary `can_use_tool` requests.
- Fixed auto mode running a turn on a model it doesn't support when a command or skill's frontmatter `model:` named one; the turn now keeps the session model — CLAUDE-CTRL-06: the session's applied model is unchanged.
- Fixed `--resume` failing (and `--continue` opening an empty conversation) when a saved session contains an attachment entry with no payload — CLAUDE-FILE-09: `fork_cut` classifies lines by `type` alone, and history reads `attachment` through `Option`.
- Fixed frontmatter `model:` on custom commands and skills being ignored in interactive sessions — CLAUDE-CTRL-06: a per-turn override does not change `get_settings`' applied model.
- Fixed MCP servers that disconnect while their tools are being listed at startup showing as connected with no tools instead of reporting the error — CLAUDE-FLAG-04: Mainframe does not read MCP status from `init`. A broken orchestration server now reports an error instead of looking healthy.
- Improved nested background subagent results to be saved in the parent subagent's transcript, so resumed subagents keep them and shared transcripts show the delivery — CLAUDE-FILE-04: `append_assistant_blocks`/`collect_subagent_tool_results` read only assistant blocks and tool results, so the new delivery entries are skipped.
- Added "Time format" (`timeFormat`) and `timeZone` settings: 12-hour, 24-hour, 24-hour UTC, or a strftime pattern for the turn-end clock and transcript-view timestamps — CLAUDE-PROBE-03: the stated scope is the turn-end clock and transcript view. The `/usage` reset time is best-effort anyway, and the percent anchor does not depend on it.
- Added a Containment Escape rule to auto mode so cloud metadata-credential fetches, egress evasion, and cross-tenant reach are no longer auto-approved unless your environment marks them expected — CLAUDE-CTRL-01: more auto-mode prompts, same shape.
- Added support for a gateway-supplied `description` on discovered `/model` picker entries (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`); entries without one still read "From gateway" — CLAUDE-PROBE-01: `description` is already mapped and feeds the context-window hint.
- Fixed `--disallowedTools` and session deny rules being dropped after the first settings reload when `allowManagedPermissionRulesOnly` is enabled — CLAUDE-CTRL-04: limited to a managed-only setting.
- Fixed subagents stopping when a response was cut off mid-stream by a computer sleep, dropped connection, or server error; they now automatically continue instead of ending with an incomplete response — CLAUDE-EVT-04: subagent results are dropped by `parent_tool_use_id`, so this extends pass 3's 2.1.246 continuation risk without adding an `on_result` path.
- Fixed `claude -p` exiting about 5 seconds after its final result while a Monitor the model armed was still running; it now waits for the watch to fire or time out — CLAUDE-FLAG-02: one-shot spawns never arm a Monitor.
- Fixed a `permissions.ask` rule being skipped in auto mode when the matching command ran inside a compound command or subshell, letting it run without the confirmation prompt — CLAUDE-CTRL-01: same `can_use_tool` shape.
- Fixed unbounded memory growth when non-JSONL data is piped into `claude -p --input-format stream-json`; it now fails fast with a clear error — CLAUDE-IO-02: `write_stdin` sends exactly one compact JSON line per frame.
- Fixed resuming or messaging a subagent whose transcript had grown past 5 MB (for example after reading many images) failing with "No transcript found" — CLAUDE-FILE-04: a CLI-side lookup fix. Mainframe's reader has no size cap.
- Fixed background commands that detach from their shell (for example under `timeout` or `setsid`) surviving a task stop or Claude Code exit — CLAUDE-CTRL-03: `stop_task` now kills more completely.
- Fixed Claude not being told when you stop a background command from the tasks panel or a connected client — CLAUDE-EVT-01: the notice goes to the model, and Mainframe's tracker already records the stop.
- Fixed stopping a background subagent leaving its monitors running — CLAUDE-CTRL-03: makes `stop_task` more thorough.
- Fixed Bash permission checks auto-approving certain `[[ ]]` conditionals that zsh parses differently from bash; these commands now prompt for approval — CLAUDE-CTRL-01: same `can_use_tool` shape.
- Improved liveness reporting to SDK hosts while a response is held open by gateway keep-alives, so long waits under a raised `CLAUDE_STREAM_IDLE_TIMEOUT_MS` are not mistaken for a hung session — CLAUDE-EVT-01: Mainframe runs no idle watchdog, and any new keep-alive event falls through to the debug log.
- Changed `--effort` to lift a new model's default-effort hold for that session only rather than permanently; an effort picked on claude.ai for a Remote Control session now applies during the hold — CLAUDE-CTRL-03: Mainframe never passes `--effort`. Effort goes through `apply_flag_settings`.
- Changed `defaultMode: "bypassPermissions"` in `.claude/settings.json` or `.claude/settings.local.json` to be ignored, like `"auto"`; set it in user or managed settings, or pass `--permission-mode` — CLAUDE-FLAG-01: Mainframe always passes `--permission-mode`.
- Fixed Bash commands failing with "task output swap refused (tasks dir moved or linked)" on some Macs — CLAUDE-FILE-08: `/tmp` and `/private/tmp` resolve to the same spool directory.
- Fixed "always allow" not saving in a project that has no .claude/settings.local.json yet — CLAUDE-CTRL-04: fixes the `localSettings` destination Mainframe forwards as-is.
- Fixed background task notifications with very large failure output (for example git errors on a full disk) making the conversation exceed the API request size limit — CLAUDE-EVT-01: Mainframe reads status and usage fields, not the notification body.
- Added `PreModelSwitch` and `PostModelSwitch` hook events (block, confirm, or annotate a model switch); `SessionStart` resume hooks now receive session staleness and the estimated re-cache cost — CLAUDE-CTRL-03: a blocking hook fails `set_model`, and `require_success` surfaces that. How "confirm" behaves in headless mode is unverified.
- Fixed the first launch on a fresh install starting in default mode instead of auto mode for accounts whose startup default is auto mode — CLAUDE-FLAG-01: Mainframe always passes `--permission-mode`.
- Fixed Opus 5 requests failing with "effort … is not supported when thinking is disabled" when effort was xhigh/max and thinking was turned off; effort is now sent as `high` in that case — CLAUDE-CTRL-03: the request now succeeds. The only issue is cosmetic: the picker shows xhigh.
- Fixed `--input-format stream-json`: client-injected assistant tool calls sent without a message id were merged into the first one and their results lost, including when resuming older sessions — CLAUDE-IO-02: Mainframe never injects assistant messages.
- Fixed session transcripts being silently overwritten when a directory change relocated a session onto an existing same-ID transcript — CLAUDE-FILE-02: the probe checks the stored `session_file_path` first, and the fix only prevents the overwrite.
- Fixed plugin commands declared in a marketplace entry being able to point outside the plugin directory; such paths are now rejected with a path-traversal error — CLAUDE-FILE-05: the scan walks `<installPath>/skills` and never reads marketplace-declared paths.
- Fixed SDK and cloud sessions hanging indefinitely when an SDK MCP server's handshake acknowledgment was lost; the wait now times out after 70 seconds and marks only that server failed — CLAUDE-FLAG-04: Mainframe's server is an HTTP `--mcp-config` server, not an SDK MCP server.
- Fixed Bash permission checks auto-approving commands that assign an arithmetic expression to an integer shell variable (e.g. `OPTIND=1/0`, `RANDOM=2+2`); these now prompt for approval — CLAUDE-CTRL-01: same `can_use_tool` shape.
- Improved retry when the model's tool call is malformed: the broken output is now dropped from the retry context, including on Bedrock, Vertex, and Foundry — CLAUDE-EVT-02: only the model's context changes. Nothing says the stream emission changes.
- Changed the default commit trailer to `Co-Authored-By: Claude Code` when the active model isn't a recognized Claude model (e.g. third-party models behind a custom `ANTHROPIC_BASE_URL`) — CLAUDE-ENV-01: affects CLIProxy sessions, but Mainframe never reads trailers.
- Changed the default model for seat-based Enterprise subscriptions to Opus 5, matching other premium plans — CLAUDE-CTRL-06: Mainframe reads the default from `get_settings` and does not assume it.
- Changed `/effort` to save your default effort level per model, so each model keeps its own setting when you switch — CLAUDE-CTRL-03: Mainframe sets effort per session through the flag layer, not the saved default.
- Changed how Bash command output files are created and read back when commands run in the sandbox, so a sandboxed command cannot redirect or replace them — CLAUDE-FILE-08: limited to sandboxed commands, with no stated path change.
- Changed project-level `.claude/settings.json` `env` to no longer set `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_TMPDIR`, or `TMPDIR`/`TMP`/`TEMP`; set them in your shell, user, or managed settings instead — CLAUDE-FILE-08: Mainframe never read project-settings env, so this removes a divergence.
- Fixed Claude Desktop and Cowork sessions disappearing after 30 days: the transcript cleanup now keeps desktop-written sessions while they are in the app (unless org policy manages retention); the new `desktopSessionCleanupPeriodDays` setting caps the exemption — CLAUDE-FILE-02: Mainframe sessions were already subject to `cleanupPeriodDays`, and degraded-chat recovery handles a missing transcript. If the exemption keys on an entrypoint marker, Mainframe could opt in.
