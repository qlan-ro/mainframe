# changelog-watch: claude 2.1.317 → 2.1.318 (2026-11-04)

Entries seen: 84 · risks: 1 · opportunities: 2 new · relevant, no action: 27 · dropped as irrelevant: 54

Codex: no changes, current at rust-v0.166.0.

The installed CLI is still 2.1.310, so nothing here was run live. Consumers were read on `origin/main` (56b0d77e), not on this branch, which is behind it. The one risk is low severity and only affects a log line. No wire shape Mainframe parses changed.

Three things to check live after upgrading:

- Where the new slash-command output lands (see the second opportunity). If it arrives in `result` or a `<local-command-*>` wrapper, Mainframe still shows nothing.
- Whether `credential_expires_at` is on the stream-json `result` event. The entry only promises `claude -p` JSON results.
- That the new sign-in warning stays out of stream-json. It is documented for text output only. On a stream-json session, `handle_stderr` would surface it as a chat error unless its first word is `Warning:`.

The email-address prompt check from the 2026-11-03 report is also still open.

## Compatibility risks

### low — Added a one-line stderr warning to `claude -p` text output, starting 10 days before a stored claude.ai sign-in ends (2.1.318)

- Checklist row: CLAUDE-FLAG-02 — `src/title_generator.rs::interpret_output`, `src/quota_pull.rs::usage_output_to_result`
- Why it threatens the row: both auxiliary spawns use `-p --output-format text`, so this is exactly the output that gets the warning. Success paths read stdout only and are unaffected. On a nonzero exit, `interpret_output` uses stderr when it is non-empty and only falls back to stdout otherwise (`title_generator.rs:81`). That fallback exists because the CLI reports "Not logged in" and usage-limit refusals on stdout. During the 10-day window the warning fills stderr, so the error names the sign-in warning and the real reason is lost. `usage_output_to_result` already ignores stdout on failure, so it stays as diagnostic-poor as it was. The chat layer only receives `Option<String>` from `generate_title`, so nothing user-visible changes.
- Recommended regression test: add `#[test] failed_exit_keeps_the_stdout_reason_when_stderr_holds_only_a_warning` in `src/title_generator_tests.rs`, pinning `exited(1, "Not logged in · Please run /login\n", "<one warning line>\n")` and asserting the detail contains `Not logged in`. The warning's exact wording is not available on 2.1.310, so the fix should report both streams rather than match the copy.
- Verify live: .claude/skills/claude-protocol-debugger/

## Adoption opportunities

- Sign-in expiry warning. `Added the date a stored claude.ai sign-in ends to `claude auth status` (`loginExpiresAt`) and to `claude -p` JSON results (`credential_expires_at`)`. Mainframe learns about an expired sign-in only when a turn fails. It could warn ahead of time. Would land in `src/event_result.rs::handle_result_event` if the field is on the stream-json `result` event, otherwise in a new `claude auth status` probe, plus a provider-status affordance in the UI. Size: medium.
- Slash-command feedback. `Fixed custom slash commands that fail, or that only Claude can invoke, printing nothing in `claude -p` and SDK sessions` (`CLAUDE-IO-02`). Mainframe won't get this fix for free. `result` text is read in one place, `src/event_result.rs::surface_command_error`, which passes it on only when it starts with `unknown command:` or `unknown skill:`. `on_result` sends `result: None`, and `is_local_command_wrapper` hides wrapped output. So in either likely route the user keeps seeing nothing, which matches today's behaviour. Widening that allowlist needs the live shape first, and `surface_command_error` has no tests yet. Size: small.

Standing, unchanged in this release: subagent effort (`CLAUDE_CODE_SUBAGENT_EFFORT`) and MCP elicitation.

## Relevant, no action

- Added a record of your answer when Claude Code asks to turn on the mods it writes in a session — `CLAUDE-FILE-04`: a new transcript record, if it is one, falls through history's `type` checks. Mainframe only acts on the entry types it knows.
- Fixed `--continue` sometimes losing the earlier conversation after a malformed tool call's retries ran out (regression in 2.1.314) — `CLAUDE-FLAG-01`: Mainframe resumes with `--resume <id>` and never passes `--continue`.
- Fixed `/logout`, `claude auth logout` and `claude mcp remove` reporting success, and changes to trust, consent or MCP settings being dropped with no word, when the config file could not be updated on a shared network home directory — `CLAUDE-FILE-06`: Mainframe runs none of these, and `write_workspace_trust` reports its own write errors.
- Fixed jobs exiting with `Not logged in` when another terminal or host signs in again to the same account and organization on the same home — `CLAUDE-FLAG-02`: fewer failed title and quota spawns. Their handling is unchanged.
- Fixed `claude mcp add` and `remove` writing the config without its lock: they now wait for it or exit 1, though another job's save can still replace a saved server — `CLAUDE-FILE-06`: Mainframe runs neither. `write_workspace_trust` doesn't take that lock either, but it wasn't taking one before.
- Fixed idle compaction replacing a conversation with a reply that was not a summary — `CLAUDE-EVT-03`: compaction events and `COMPACT_SUMMARY_PREAMBLE` handling are unchanged.
- Fixed `claude -p` and Agent SDK sessions reporting success when an API error cut off a reply while a mod hooked `turn.step` — `CLAUDE-EVT-04`: `subtype` and `is_error` get more accurate and are read the same way.
- Fixed a message sent right after a model change still running after Stop in headless sessions: Stop now cancels or stops it as it would a queued message — `CLAUDE-CTRL-03`: this fixes Mainframe's own `set_model`-then-send sequence. The `interrupt` request itself doesn't change.
- Fixed a deleted session transcript being re-created with its last prompt when an idle non-interactive session exited — `CLAUDE-FILE-02`: a missing transcript now stays missing, which the presence probe already handles.
- Fixed a restarted session re-sending a message that failed with an API error, ahead of the newer message waiting behind it — `CLAUDE-FILE-01`: a fix to what gets replayed. The transcript path and resume argv are unchanged.
- Fixed a restarted session dropping its interrupted turn when the restart came right after Claude read a large image or retried a tool call — `CLAUDE-FILE-01`: same reason.
- Fixed every connection failing when the `NODE_EXTRA_CA_CERTS` file is empty, not PEM, or starts with a damaged certificate: readable certificates are now used, with a warning on stderr — `CLAUDE-IO-01`: only with a damaged cert file. A stray chat error replaces every connection failing.
- Fixed a mod's `turn.step` hook making a stopped reply finish as a success in headless runs — `CLAUDE-EVT-04`: same as the other `turn.step` fix.
- Fixed retention cleanup leaving a home that only runs `claude -p` with no `~/.claude.json` backup: it now takes a fresh backup before deleting the last good one — `CLAUDE-FILE-06`: backups only. The keys Mainframe reads are unchanged.
- Fixed non-interactive launches replacing a `~/.claude.json` that isn't valid JSON with defaults; the start now fails, says how to restore the file, and leaves it as is (anthropics/claude-code#87551) — `CLAUDE-FILE-06`: a corrupt file now fails a session loudly instead of being silently reset. `write_workspace_trust` already refuses to touch a corrupt file, and `write_atomic` shouldn't produce one. The message reaches the chat through `handle_stderr`.
- Fixed an empty `~/.claude.json` with no backup being reported as corrupted; Claude Code now starts as it does when the file is missing — `CLAUDE-FILE-06`: Mainframe still treats an empty file as malformed (identity transient, trust write errors). That only matters until the CLI's first save.
- Fixed the restore command printed for a damaged or missing `~/.claude.json` naming an empty or cut-off backup, or failing on a read-only file — `CLAUDE-FILE-06`: copy only, and Mainframe doesn't parse it.
- Fixed the sign-in failure when a stored claude.ai login reaches its time limit: it now says so, and in `claude -p` names `claude auth login` and `claude setup-token` — `CLAUDE-FLAG-02`: nothing in core-rs or the UI matches sign-in copy. It is passed through as text.
- Improved how `~/.claude.json`, settings files and the stored login survive saves on shared network home directories: they are less often deleted, briefly emptied or replaced by a near-empty or older copy — `CLAUDE-FILE-06`: helps identity reads, and the format is unchanged.
- Improved sessions on network file systems to look again when the configuration file is wrongly reported as missing, so fewer start without your MCP servers and trusted folders — `CLAUDE-FILE-06`: fewer false untrusted starts, and the trust key is unchanged.
- Improved MCP tool errors: a call made before the tool is loaded now returns its input schema — `CLAUDE-FLAG-04`: this makes a premature `mcp__mainframe__*` call easier to recover from. The tools and config are unchanged.
- Improved unattended runs (`claude -p`, SDK apps) to stop rewriting `~/.claude.json` on every run when nothing in it changed — `CLAUDE-FILE-06`: Mainframe's auxiliary spawns stop racing `write_workspace_trust`'s read-modify-write as often.
- Changed subagents to stop instead of switching models when "Switch models when a message is flagged" is set to "Ask each time" — `CLAUDE-EVT-01`: expected to end like any other stopped subagent, through the existing task events.
- Changed background subagents to move a shell command to the background after 3 minutes on all providers, so the prompt cache doesn't expire while it runs — `CLAUDE-EVT-01`: shell commands only, through the existing `task_started` path. It doesn't touch the long MCP calls CLAUDE-FLAG-04 worries about.
- Changed subagent progress summaries on Bedrock, Vertex, Foundry, or with telemetry off: on a cold prompt cache, one can now wait up to 5 minutes for the subagent's pending response — `CLAUDE-EVT-01`: timing only. `workflow_events.rs::handle_task_progress` reads the same event.
- Changed what a mod attaches at `prompt.submit` to stay in the user's turn rather than go out as a system message — `CLAUDE-EVT-03`: Mainframe ships no mods. It can only affect a user's own mod, whose text would show in that turn.
- Removed the 2.1.288 fix that kept the model's earlier thinking when resuming a conversation started on 2.1.286 or earlier; that thinking can now be dropped — `CLAUDE-FILE-04`: this changes what the model is sent on resume. History reads the transcript on disk.

Dropped (54): Claude apps gateway ×4 (`assume_role`, federation token log, `trusted_proxies` hints, CountTokens warning); self-hosted runner ×3; Remote Control ×5 (`claude remote-control` spawn, `/remote-control`, `Remote Control:` ×2, `[Remote Control]`); cloud sessions ×12 (`[Cloud sessions]` ×6, approved shell folder after restart, connector after restart, uploads refused, `Setup` hook env, iPhone turn state, `/mcp` tool counts); [VSCode] ×3 and IDE extension install; `claude plugin` ×2; stdio MCP re-probe (the orchestration server is HTTP); `deniedMcpServers` (Anthropic-provided servers and connectors); mod `$.model.fork` effort; version cleanup of another user's process; `/design revoke`; workflows after a usage limit; PushNotification duplicate; too-large image error; background shell runtime dialog; stored login on a full network home; `setup-token` with `forceLoginOrgUUID`; `/bin/bash` commit reliability; admin usage request; remote reconnect speed; toast wording; auto-update retry; `/permissions` dialogs; `/claude-api managed-agents-onboard`; [Claude Tag]; [Code Review]; macOS Bash stall; keys answering permission prompts (TUI); `allowedProviders`; "Now using usage credits" notice (TUI).

## Standing items, not from this delta

- Deadline: Opus 4.8 fast mode is removed on 2026-11-30, 26 days away. `origin/main` still has `fast: true` for `claude-opus-4-8` (`src/models.rs:119`). See the 2026-10-31 report.
- Checklist drift, first noted in the 2026-10-22 report and still unfixed on `origin/main`. CLAUDE-EVT-06 calls `stream_event` deliberately unhandled, CLAUDE-FLAG-01's argv omits the flag, and "Not consumed" lists `--include-partial-messages`. But `session_spawn.rs:169` passes it when enabled and `partial_stream.rs` handles the events. CLAUDE-EVT-01 also omits `task_progress`, which `event_system.rs:16` handles. Stale rows make future passes misjudge these surfaces.
