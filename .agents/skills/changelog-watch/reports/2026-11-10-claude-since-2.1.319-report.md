# changelog-watch: claude 2.1.319 → 2.1.321 (2026-11-10)

Entries seen: 118 · risks: 1 · opportunities: 1 (inline with the risk) · relevant, no action: 31 · dropped as irrelevant: 86

Codex: no changes, current at rust-v0.167.0.

The changelog skips from 2.1.319 to 2.1.321, so this pass covers a single version. The installed CLI is 2.1.318, so nothing here ran live. I downloaded the 2.1.321 darwin-arm64 package and read its strings without running it. Consumers were read at `0a18c702` (`origin/main`).

No wire shape Mainframe parses changed. The one risk is the usual new-model lag in the hand-kept fallback catalog. The `fable` alias now points at a model Mainframe's catalog doesn't know.

## Compatibility risks

### low — Added Claude Fable 5.2 (`claude-fable-5-2`), now the default Fable model — 1M context, $8/$40 per Mtok with $0.20/Mtok cache reads (2.1.321)

- Checklist row: CLAUDE-PROBE-02 — `src/models_catalog.rs::CURRENT_MODELS`, read by `src/models.rs::{claude_models, enrich_with_context_window}`
- Why it threatens the row: the probe reports the `fable` alias with a tagline description and `resolvedModel` set to the concrete id. `enrich_one` gets the window by looking up that resolved id in the static catalog, which is what `models_catalog_tests.rs::tagline_aliases_receive_registry_windows` pins for `claude-fable-5-1`. In 2.1.321 the registry has `fable: {default: "claude-fable-5-2"}` and `latest_per_family.fable = "claude-fable-5-2"`. `CURRENT_MODELS` has no such entry, so `fable`, and `default` on plans where it resolves to Fable, get `context_window: None`. Effects:
  - `deriveContextPct` (`ui/.../session-bar-status.ts:16`) shows no context percent until the first `get_context_usage` answer (CLAUDE-CTRL-02) arrives. After that it uses the CLI's own number.
  - `handoff_send.rs::budget_for` loses `model_window` and falls back to `native.last_context_max_tokens`.
  - When the probe fails, the fallback picker offers no Fable 5.2 at all.

  Nothing errors, and the session keeps working.
- Opportunity, same entry: the 2.1.321 registry entry lists `fast_mode`, `max_effort` and `xhigh_effort`, with `default_effort: "medium"`. Fable 5.1 has no fast mode (`fast: false` in the catalog). A working probe already shows the fast toggle through `supportsFastMode` (CLAUDE-PROBE-01). The fallback entry should say `fast: true` and use `EFFORTS_TO_MAX` if the probe confirms `max`. Size: small, one `ModelSpec`.
- Recommended regression test: in `src/models_catalog_tests.rs`, change `tagline_probe()` so `fable` and `default` resolve to `claude-fable-5-2`. That makes `tagline_aliases_receive_registry_windows` assert `Some(1_000_000)` for the new id. Add `("claude-fable-5-2", "Fable 5.2", "claude-fable-5-1")` to `new_catalog_entries_match_registry_and_precede_previous_versions`. Both fail today and pass once the `ModelSpec` lands.
- Verify live: .claude/skills/claude-protocol-debugger/. After upgrading to 2.1.321, capture the `initialize` response and check the `fable` entry's `resolvedModel` (whether it has a `[1m]` suffix), `supportsFastMode` and `supportedEffortLevels`.

## Adoption opportunities

- Fast mode on Fable 5.2: see the risk above. Size: small.

Standing, unchanged in this release: MCP tasks for long orchestration calls, `permissions.denyInsteadOfPrompting` for unattended runs, sign-in expiry warning, slash-command feedback, subagent effort and MCP elicitation.

## Relevant, no action

- Changed saved Fable 5.1 model picks to move to `fable`: on Pro and Max plans at once, on Team and Enterprise plans once your organization allows it; use `/model claude-fable-5-1` to switch back — CLAUDE-CTRL-06: `get_settings` then reports `applied.model = "fable"`. That is an id the probe lists, and Mainframe passes it on inherited resumes. Chats with an explicit `claude-fable-5-1` keep it, because the entry says the full id still selects 5.1. Users who inherit a saved Fable 5.1 pick move to 5.2.
- Changed `AskUserQuestion` in `claude -p` and SDK sessions to deny a host's permission answer that sets the undocumented `afkTimeoutMs` input field — CLAUDE-CTRL-04: `build-control-response.ts:40` answers with `{ ...e.request.input, answers }`. In the binary, `afkTimeoutMs` is in the tool's output schema ("Set when the dialog auto-resolved…"), not its input schema, so the request input never has it. The same host-answer validator (`host_field`, `unknown_field`, `changed_shown_field`) is already in 2.1.318, and Mainframe's answer passes it.
- Fixed MCP OAuth requests sending secrets such as refresh tokens to another host when a server redirected them — CLAUDE-FLAG-04: the `mainframe` server authenticates with a bearer header from `MAINFRAME_MCP_TOKEN`, not OAuth.
- Fixed an MCP server sometimes showing as connected with no tools after it was reconnected or the session's directory changed while its tools were still loading — CLAUDE-FLAG-04: a fix. Mainframe never moves a session's directory.
- Fixed a case where a read-only Bash command ran outside the sandbox without a permission prompt — CLAUDE-CTRL-01: more prompts, same `can_use_tool` shape.
- Fixed a case where Bash permission checks judged a file write from the wrong folder and didn't prompt — CLAUDE-CTRL-01: same.
- Fixed deny rules and protected-file prompts not applying to the file that a `cp` or `mv` into a directory writes — CLAUDE-CTRL-01: same.
- Changed `cp` and `mv` spelled by a path, such as `/bin/cp`, to get the same path checks as `cp` and `mv` — CLAUDE-CTRL-01: same.
- Fixed Bash reads such as `grep -r foo "$PWD/src"` asking for permission when the same command with the path typed out runs without asking — CLAUDE-CTRL-01: fewer prompts, same shape.
- Fixed apps that embed Claude Code getting their own PreToolUse hook's `ask` reason instead of another hook's when both asked — CLAUDE-CTRL-01: `decision_reason` gets the right text. Mainframe registers no hooks, so this only affects users' own hooks.
- Fixed a PreToolUse hook's `ask` being lost when another hook's `defer` finished first and could not be honored — CLAUDE-CTRL-01: the lost prompt now arrives as `can_use_tool`. Mainframe registers no defer hook.
- Fixed a rare crash on permission prompts and background tasks — CLAUDE-CTRL-01: a crash fix with no shape change.
- Changed mods' own tool calls (`$.tool.call`, `$.mcp.call`) to raise no permission prompt, even under your own ask rules or in `dontAsk` and `-p` runs; deny rules and organization policy still apply — CLAUDE-CTRL-01: fewer `can_use_tool` requests, same shape.
- Fixed context usage estimates overcounting tool definitions when exact token counts are unavailable — CLAUDE-CTRL-02: `get_context_usage` numbers may read lower. Mainframe shows what the CLI reports.
- Fixed auto mode losing a background subagent's report that had started a turn when the conversation was compacted before Claude answered it — CLAUDE-EVT-01: the existing task events cover it.
- Improved auto mode in headless sessions, the desktop app and VS Code: reports from background subagents that wait together are answered in one model call, as in the terminal — CLAUDE-EVT-01: `task_notification` is handled per `task_id`, whatever the model batches into one turn.
- Changed background command notifications and TaskStop results to show Claude only the start and end of a command over 1,000 characters, which saves context — CLAUDE-EVT-01: `task_events.rs:165` takes the command from the Bash `tool_use` input, not the notification. The `summary` text may be shorter, which only changes display.
- Fixed project skills, commands and agents disappearing from the menu in SDK and desktop sessions after Claude entered a worktree — CLAUDE-FILE-05: Mainframe lists skills from disk in `skills.rs`, not from the CLI's menu.
- Fixed project skills, commands and agents staying missing after their folder was removed and came back mid-session, such as with `git stash`, including after entering a worktree — CLAUDE-FILE-05: same.
- Changed nested skill loading: `.claude/skills` folders inside `~/.claude/plugins` no longer load when Claude works on files there — CLAUDE-FILE-05: `skills.rs` reads fixed plugin directories and doesn't walk nested folders.
- Changed headless sessions to reload mods in `.claude/skills` when their files change; set `CLAUDE_CODE_PLUGIN_DIR_WATCH=0` to turn this off — CLAUDE-FILE-05: the reload happens inside the CLI. Mainframe doesn't set the variable, and the entry names no new event.
- Fixed fast mode losing replies, switching models or retrying for minutes when fast serving is rate-limited, overloaded or failing; it now tries standard speed on the same model first — CLAUDE-CTRL-03: the `fastMode` flag setting is unchanged, and the fallback stays on the same model.
- Changed the fast mode labels in `/fast`, `/config` and `/model` to name your current model when it supports fast mode, and removed "(Opus only)" from the VS Code row — CLAUDE-PROBE-01: label change only. Mainframe reads fast support per model from `supportsFastMode`.
- Improved the `/model` picker: "More models" is now an unnumbered row below every other, and older models open under it without renumbering the rest — CLAUDE-PROBE-01: TUI only.
- Fixed new messages not being saved, and `claude -p`, SDK and VS Code sessions hanging, when memory ran out while the transcript was being read — CLAUDE-FILE-01: a fix on the resume path. The transcript format is unchanged.
- Fixed a blank screen or no answer at startup, and empty `claude mcp list` output, when a stored MCP sign-in record was null — CLAUDE-EVT-01: fixes a session that never reached `init`.
- Fixed the Artifact tool telling Claude to add filters when an artifact's database collection is too large to sort; it now says to read the collection page by page and sort the results — CLAUDE-RPC-01: database only. Mainframe calls only `list` and `read`.
- Improved the messages shown when an artifact is in another organization: `/login` is offered only if it's one of yours, and Claude now says where a copy may be after an account move — CLAUDE-RPC-01: the wording changes inside an `isError` result, which `artifact_client.rs` already treats as a refusal.
- Fixed the fallback model sometimes declining a request or mentioning a stopped response when the first model was blocked before replying — CLAUDE-FLAG-01: Mainframe never passes `--fallback-model`, and the reply arrives through the same events.
- Gateway: Changed Bedrock, Vertex and Foundry upstreams to ignore the `ANTHROPIC_*_BASE_URL` variables in the gateway's environment. Set `base_url` on the upstream to use another endpoint — CLAUDE-ENV-01: only the gateway process changes. The CLI child still honours `ANTHROPIC_BASE_URL` for `cliproxy/` chats.
- Fixed `claude -p` sometimes telling Claude that background commands get 30 minutes when they are stopped after 10 — CLAUDE-FLAG-02: the title and quota one-shots run no Bash.

Dropped (86): Remote Control ×10; cloud sessions and Cowork ×8; Claude apps gateway and `Gateway:` ×7; plugins, mods and managed marketplaces ×5; Claude Desktop ×4; Windows ×4; TLS, proxy and NFS ×4; screen reader ×3; hooks Mainframe doesn't register ×3; plan and upsell copy (Ultra, usage credits) ×3; agent view and `claude agents` ×3; Claude in Chrome and computer use ×2; network-path Edit and NotebookEdit ×2; telemetry ×2; install and MDM ×2; [VSCode] ×2; other TUI, tool and model-facing fixes ×22 (git status context, workflow stop notice, WebFetch empty reply, image dedup, skill-name characters, self-hosted runner, artifact design typefaces, and similar).

## Standing items, not from this delta

- Deadline: Opus 4.8 fast mode is removed on 2026-11-30, 20 days away. `src/models_catalog.rs:134` still has `fast: true` for `claude-opus-4-8`. 2.1.321 still has 11 strings mentioning it.
- Fixture drift: `models_catalog_tests.rs::tagline_probe()` and `effective_model.rs` tests use `claude-fable-5-1` as what `fable` and `default` resolve to. That was true for 2.1.318 and is stale from 2.1.321. The risk above covers the update.
- Checklist drift, still unfixed (from the 2026-11-07 report): CLAUDE-EVT-06 and the "Not consumed" list versus `--include-partial-messages`, CLAUDE-EVT-01 missing `task_progress` and `api_error`, and rows citing `src/events.rs::{handle_system_event, handle_result_event}` after those moved.
