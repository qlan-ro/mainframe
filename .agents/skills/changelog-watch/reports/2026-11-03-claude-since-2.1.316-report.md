# changelog-watch: claude 2.1.316 → 2.1.317 (2026-11-03)

Entries seen: 87 · risks: 0 · opportunities: 0 new (2 standing, restated) · relevant, no action: 23 · dropped as irrelevant: 64

The installed CLI is still 2.1.310, so nothing here was run live. Nothing in this release threatens a checklist row. Two entries are worth a live check once the CLI is upgraded:

- The new email-address check adds a permission prompt. It should arrive as an ordinary `can_use_tool` request, but if it comes as a new `control_request` subtype, the CLAUDE-CTRL-01 catch-all drops it and the turn hangs.
- Transcript cleanup now runs on machines where it used to be skipped. Users who had old transcripts kept because cleanup never ran may see one purge of transcripts older than `cleanupPeriodDays`, and Mainframe chats older than that would open as degraded.

The 2.1.316 deadline still stands: Opus 4.8 fast mode is removed on 2026-11-30 (see the 2026-10-31 report).

## Compatibility risks

None.

## Adoption opportunities

No new ones. Two standing ones, restated:

- Subagent effort (from 2.1.316, `CLAUDE_CODE_SUBAGENT_EFFORT`). 2.1.317 shrinks the gap: subagents on a *different* model from the chat now use that model's saved or default effort instead of the session's. So an `xhigh` chat no longer pushes `xhigh` onto, for example, a Sonnet Explore subagent. Same-model subagents still inherit. Would land in `src/session_spawn.rs::build_spawn_command` (env) plus a provider setting. Size: small to medium.
- MCP elicitation. `[Cloud sessions] Added a link card … open or decline a link an MCP server asks you to visit` is URL-mode elicitation. Upstream now has a form card (2.1.316) and a link card (2.1.317) for it. Mainframe still drops `elicitation` control requests (`CLAUDE-CTRL-01`, `src/events.rs::handle_control_request_event`). The entry itself is counted as dropped (product surface).

## Relevant, no action

- Added a check that asks before a web or shell tool call sends your account email address to the network — `CLAUDE-CTRL-01`: an "ask" goes through the permission-prompt tool as `can_use_tool`, which Mainframe already answers generically. Confirm the subtype live on upgrade (see above).
- Fixed Remote Control and SDK hosts offering "don't ask again" on a mod's tool calls — `CLAUDE-CTRL-01`/`CLAUDE-CTRL-04`: `permission_suggestions` is just shorter for mod tools. Mainframe renders whatever suggestions arrive.
- Added a notice when auto mode's check has no answer for a subagent's tool call, which used to leave nothing in the main view — `CLAUDE-CTRL-01`/`CLAUDE-EVT-01`: if this reaches stream-json as a new `system` subtype, it falls through the debug-log catch-all. Nothing Mainframe parses changes.
- Added `onFailure: "block"` for Agent SDK hook callbacks, so a callback that fails blocks the action instead of letting it run — `CLAUDE-CTRL-01`: Mainframe registers no SDK hooks, and `hook_callback` is on the not-consumed list.
- Removed the Read tool's "file unchanged since your last Read" stub: reading an unchanged file again returns its content — `CLAUDE-EVT-03`: nothing in `packages/core-rs` or `packages/ui` matches on the stub text, so `tool_result` content just gets longer.
- Fixed `claude -p` exiting 0 when a full disk or quota lost its transcript or ~/.claude.json writes; it now prints an error and, in text and json output, exits 1. Full NFS exports may be missed — `CLAUDE-FLAG-02`: `quota_pull.rs` and `title_generator.rs` already treat a nonzero exit as failure. A full disk now fails the pull instead of possibly passing as a success.
- Added `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID`: set it to `1` on a self-hosted runner to have `claude -p` run inside a session use that session's ID and transcript, as in earlier versions — `CLAUDE-FLAG-02`: this only affects cloud and self-hosted runner sessions. The daemon's auxiliary `-p` spawns don't run inside one and pass `--no-session-persistence`.
- Fixed `claude -p` run inside a cloud or self-hosted runner session sharing that session's ID: it wrote into the session's transcript, and a restart could resume the wrong conversation — `CLAUDE-FLAG-02`: runner-only, same reason.
- Fixed `claude -p` run inside a cloud or self-hosted runner session generating a title of its own and sending it to that session — `CLAUDE-FLAG-02`: runner-only. Mainframe's title spawn reads stdout and sends nothing.
- Fixed old transcripts not being cleaned up on machines where some runs skip cleanup, such as runs using `--setting-sources` — `CLAUDE-FILE-02`: retention is upstream's `cleanupPeriodDays` policy. Mainframe's presence probe already handles a missing transcript (`transcript_tests.rs::returns_false_when_neither_stored_nor_derived_path_exists`, `locate_returns_missing_when_neither_path_exists`). Watch item above.
- Fixed session titles being lost in cloud and SDK sessions when a new message or Stop arrived while the title was generating — `CLAUDE-FILE-03`: `aiTitle` gets written more reliably. `external_session_enrich.rs` already falls back to `summary` and then `firstPrompt`.
- Fixed resumed sessions telling Claude again about a file change it already knew about — `CLAUDE-FILE-01`: a fix to what the model is told on resume. The transcript path and resume argv are unchanged.
- Fixed skills synced from claude.ai being lost or downloaded again every ten minutes when they can't be written to disk — `CLAUDE-FILE-05`: synced skills that land on disk stay put, which helps the skills scan.
- Fixed child processes of a stopped shell command sometimes being sent SIGTERM twice, which could make some programs skip their cleanup — `CLAUDE-FILE-08`/`CLAUDE-CTRL-03`: `stop_task` gets cleaner teardown. Spool paths and task events are unchanged.
- Changed SendMessage so a message to a running background agent arrives earlier: its running command moves to the background, without being stopped — `CLAUDE-EVT-01`: a command moved to the background shows up through the existing `task_started`/`task_*` path the tracker handles.
- Changed subagents and teammates on a different model from the main conversation to use that model's saved effort level or its default, instead of the session's effort level — `CLAUDE-CTRL-03`: `apply_flag_settings {effortLevel}` still sets the main conversation's effort. Mainframe sets no per-subagent effort (opportunity above).
- Fixed a project's `effortLevel` setting being ignored by sessions that an app starts ahead of time and then opens in the project, such as new sessions in the desktop app's Code tab — `CLAUDE-CTRL-03`: Mainframe starts no sessions ahead of time, and it sends effort explicitly.
- Fixed a background session sometimes losing a just-made change of permission mode when it was upgraded or retired — `CLAUDE-CTRL-03`: this is about upstream background sessions. Mainframe's `set_permission_mode` goes to a live stdio session.
- Fixed "Prompt is too long" after automatic compaction in sessions whose very large CLAUDE.md changed since it was last sent — `CLAUDE-EVT-01`: a compaction fix. `compact_boundary` and `status: compacting` are unchanged.
- Fixed very long conversations losing their earlier summary when compaction had to shorten its own request — `CLAUDE-EVT-03`: the summary is kept now. `isCompactSummary` and the preamble Mainframe matches are unchanged.
- Fixed auto mode failing every turn when an LLM gateway set as the base URL answers 403 or 422 to its server-side safety check (a 403 with an apiKeyHelper is unchanged) — `CLAUDE-ENV-01`: this helps CLIProxy chats (`ANTHROPIC_BASE_URL` set) in auto mode. The env contract is unchanged.
- Fixed high memory use and slow startup in headless sessions with many plugins that register commands — `CLAUDE-FLAG-01`: a performance gain for Mainframe's stream-json sessions. The argv is unchanged.
- Fixed project and local MCP servers disconnecting after the first turn in some Claude desktop sessions — `CLAUDE-FLAG-04`: desktop-only, and the orchestration server comes from `--mcp-config`, not project or local scope.

Dropped (64): Claude apps gateway and admin ×5 (cost report, IdP group records, Bedrock "Input is too long", startup error copy, `Gateway:` pooled-budget `/usage`); OTel ×4 (new attributes, https/proxy, 403 flood, timeout); self-hosted runner ×6 (5xx/heartbeat recovery ×3, plan-approval restart, interrupted-turn age, MCP switch); agent teams ×3 (inbox re-created, teammate removed, tmux teammates in auto mode); scheduled tasks ×3 (`/schedule` warning, `/schedule` results, stored tasks after turn-off); `/team-onboarding` ×2; `/loop`, `/artifacts`, `/design-sync`, `/feedback`, `/remote-control` ×5; Claude Desktop managed-settings notice; cloud Artifact-tool approvals; synced-plugin connector auth; region-block 403 copy (Mainframe parses no sign-in copy); `claude auth status` (never called); `--from-pr` (never passed); Foundry credential error; TLS issuer certificate; `AWS_BEARER_TOKEN_BEDROCK` for stdio MCP; `DISABLE_PROMPT_CACHING_*`; PDF page count; partial Grep/Glob results; tool switched off on resume; settings-file edits in the first second; exit resume hint repeating launch flags; plugin-monitor exit prompt; `plugin-authoring` share offer; screen reader; Ctrl+C on background agents; second simultaneous permission prompt on claude.ai and mobile (Remote Control rendering); Windows ×2; `Remote Control:` fork names; [VSCode] ×7; [Cloud sessions] ×4; [Remote Control] ×1; [Claude Tag] ×1.
