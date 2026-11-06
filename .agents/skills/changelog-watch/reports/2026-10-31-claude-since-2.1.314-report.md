# changelog-watch: claude 2.1.314 → 2.1.316 (2026-10-31)

Entries seen: 55 · risks: 1 · opportunities: 1 · relevant, no action: 8 · dropped as irrelevant: 45

The upstream changelog has no 2.1.315 entry, so this pass covers only 2.1.316. The installed CLI is still 2.1.310, so nothing here was run live. One entry has a deadline: Opus 4.8 fast mode is removed on 2026-11-30, and Mainframe's fallback catalog still advertises it.

## Compatibility risks

### medium — Deprecated fast mode for Opus 4.8 as of October 30, 2026; it will be removed on November 30, 2026. After removal, fast mode requests on Opus 4.8 return an error and do not fall back to standard Opus 4.8. Migrate to Opus 5.5 to keep the speedup (2.1.316)

- Checklist row: `CLAUDE-PROBE-02` — `src/models.rs::OLDER_MODELS` (the `claude-opus-4-8` spec has `fast: true`); downstream `CLAUDE-CTRL-03` — `src/tuning.rs::tuning_to_flag_settings` sends `fastMode: true`.
- Why it threatens the row: Opus 4.8 sits in `OLDER_MODELS`, the list of models the CLI picker hides, so the `initialize` probe (`CLAUDE-PROBE-01`) never reports it and `supportsFastMode` cannot turn off by itself. The hardcoded `fast: true` keeps `supports_fast = Some(true)`, so `mainframe-chat/src/resolve_tuning.rs::model_capability` lets a chat's fast toggle, or a provider `defaultFast`, through. From 2026-11-30, every turn of such a chat fails. The error is visible, which is why this is medium and not high, but the chat can't continue until the user turns fast mode off. The fix is one field: set `fast: false` on the Opus 4.8 spec before 2026-11-30. The capability gate then drops `fastMode` for existing chats with no migration. Check whether Opus 4.7's `fast: true` is still valid; this entry doesn't mention it.
- Recommended regression test: add `#[test] fn opus_4_8_no_longer_offers_fast_mode` in `src/models_tests.rs`, asserting that `older_models()` gives `claude-opus-4-8` `supports_fast == None`. Also extend `mainframe-chat`'s resolve-tuning tests so a chat with `fast: Some(Some(true))` on that model resolves to `fast == false`.
- Verify live: `.claude/skills/claude-protocol-debugger/`. After 2026-11-30, `apply_flag_settings {fastMode:true}` on `--model claude-opus-4-8` should return the upstream error.

## Adoption opportunities

- `CLAUDE_CODE_SUBAGENT_EFFORT` sets the effort subagents run at when nothing else names one. Today they inherit the session's effort, so an `xhigh`/ultracode chat runs every Explore-style subagent at `xhigh` too. This would land as a child env var in `src/session_spawn.rs::build_spawn_command`, plus a provider-level "subagent effort" setting. Size: small (env only) to medium (with a settings affordance).
- Standing, restated: `[Cloud sessions] Added a form card … so you can fill in or decline a form an MCP server asks for` is upstream doing what the 2.1.310 report proposed for Mainframe. Mainframe still drops `elicitation` control requests (`CLAUDE-CTRL-01`, `src/events.rs::handle_control_request_event`). The entry itself is counted as dropped (product surface).

## Relevant, no action

- Fixed shell commands being left running on macOS and Linux when Claude Code exits by itself, for example when credentials are refused or a cloud session is archived — `CLAUDE-FILE-08`: fewer orphaned shells for the daemon's liveness and worktree kill sweeps to reap. Spool paths and task events are unchanged.
- Fixed sub-agents that inherited a parent sub-agent's model moving to the main model when a background job or message woke them — `CLAUDE-EVT-01`: Mainframe reads no per-subagent model. `task_*` events are unchanged.
- Fixed a managed `autoMode.allow` list without `"$defaults"` getting the built-in exceptions back from a host app's `--settings`, a first rule added in `/permissions`, or `/auto-mode-setup` — `CLAUDE-FLAG-01`: Mainframe passes no `--settings` and writes no `autoMode` config. It only selects `--permission-mode auto`.
- Fixed `claude -p` text output sometimes not saying why auto mode stopped a turn when a background agent was still running — `CLAUDE-FLAG-02`: the `--output-format text` spawns (quota, title) never run in auto mode. Chats use stream-json.
- Fixed `CLAUDE_CODE_AUTO_MODE_SERVER=1` being ignored in sessions started by a host application (such as Claude Desktop) behind a proxy or LLM gateway with experimental betas turned off — `CLAUDE-ENV-01`: CLIProxy chats fit "host app behind a proxy", but Mainframe never sets this variable (grep over `packages/core-rs` finds none).
- Fixed plugin MCP `headersHelper` scripts receiving a corrupted `CLAUDE_PLUGIN_ROOT` and server URL when a credential-named environment variable was set to a switch value such as `1` — `CLAUDE-FLAG-04`: the orchestration server uses static `headers` with `${MAINFRAME_MCP_TOKEN}` expansion, not `headersHelper`, and the token is never a switch value.
- Fixed the SDK `register_repo_root` control request not loading the CLAUDE.md of a directory outside the working directory (with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`) — `CLAUDE-CTRL-03`: `register_repo_root` is not among the outbound subtypes Mainframe sends.
- Fixed `/model <id>` not warning when the model isn't recognized by this version and auto-compact will assume a 200K context window — `CLAUDE-CTRL-03`/`CLAUDE-ENV-01`: Mainframe switches models via `set_model`, not the `/model` TUI command, so it gets no warning either way. Assuming 200K for unrecognized ids (e.g. `cliproxy/…`) is existing behaviour, not new.

Dropped (45): admin, gateway, and env entries Mainframe doesn't touch (`CLAUDE_CODE_DISABLE_ULTRATHINK`, pooled budgets, looped cross-cert, `policy_mode: layered`, Bedrock guardrail tagging, gateway model checks, `claude auth login`); Bash tool shell fixes (multi-line aliases, `SHELLOPTS`); PowerShell hooks; truncated compressed responses; Vertex/Bedrock alias fallback; `--restricted` uploads; invisible-character prompts; cloud auto-mode failure marking; Artifact tool rules; push-to-talk hint; Windows Grep/Glob; plan restore after `/clear`; first-run copy; Enterprise survey; self-hosted runner ×2; Windows Git Bash; `/code-review` card; `/diff` speed; `/ultrareview` messages; SSL error copy; `autoMode.allow` scheduled-task rule; server-managed settings approval; and 15 bracketed product-surface entries: [VSCode] ×5, [Cloud sessions] ×5, [Claude Tag] ×4, [Code Review] ×1.
