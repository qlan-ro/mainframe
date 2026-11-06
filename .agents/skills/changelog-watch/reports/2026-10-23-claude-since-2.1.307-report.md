# changelog-watch: claude 2.1.307 → 2.1.309 (2026-10-23)

Entries seen: 80 · risks: 0 · opportunities: 0 · relevant, no action: 16 · dropped as irrelevant: 64

Delta: `reports/2026-10-23-claude-since-2.1.307-delta.md` (2.1.308 one entry, 2.1.309 79).

Run notes:

- Installed CLI: 2.1.308. Nothing here was verified live. Every classification comes from the changelog text and the Mainframe source.
- Codex was not reviewed. Every `fetch-delta.mjs --tool codex` attempt (six) failed with GitHub HTTP 504 on `releases?per_page=100`. A manual `gh api 'repos/openai/codex/releases?per_page=30'` shows no stable release after `rust-v0.163.0` (2026-10-15), only `rust-v0.164.0-alpha.*` prereleases. The skill only trusts an empty delta when the fetcher prints `no changes`, so Codex state was left alone.

## Compatibility risks

None in this range.

## Adoption opportunities

None in this range.

## Relevant, no action

- Fixed a disabled MCP server being reconnected by a later permission prompt in print and SDK sessions (2.1.309) — CLAUDE-FLAG-04: Mainframe never disables the `mainframe` server it injects. This is a fix for user-disabled servers.
- Fixed sandboxed commands and auto-accepted edits being able to modify the MCP config file passed with `--mcp-config` (2.1.309) — CLAUDE-FLAG-04: `orchestration_args.rs` passes `--mcp-config` as inline JSON, not a file path, so there is no file to protect.
- Fixed the Bash permission check trusting a variable set by a command whose redirect can fail to open (2.1.309) — CLAUDE-CTRL-01: some commands now prompt that used to auto-pass. They arrive as the same `can_use_tool` request Mainframe already handles.
- Fixed Bash permission checks not prompting for some compound commands that change directory before running git when the `cd` is wrapped or prefixed, as they do for a plain `cd` (2.1.309) — CLAUDE-CTRL-01: same as above, more `can_use_tool` prompts and no shape change.
- Fixed an `Edit(path)` deny rule not blocking a Bash redirect to that path in some commands that also held a subshell (2.1.309) — CLAUDE-CTRL-01: rule enforcement happens inside the CLI. Mainframe sees the resulting tool error as an ordinary `tool_result`.
- Fixed Claude asking for permission on each artifact update for the rest of a turn after the conversation was compacted in that turn (2.1.309) — CLAUDE-CTRL-01: fewer `can_use_tool` requests. Nothing Mainframe parses changes.
- Changed `sed -i` to get the standard Bash prompt and run as written, not a simulated file-edit preview; like other Bash edits, it is no longer restored by `/rewind` (2.1.309) — CLAUDE-CTRL-01: Mainframe has no `sed` special case (grep over `core-rs/crates`, `ui/src` and `types/src` finds none). A `sed -i` call is a Bash `can_use_tool` either way.
- Changed the dangerous `rm` and `rmdir` prompt in bypass permissions mode in the Desktop app and VS Code to deny the command at once with a rewrite hint, so unattended sessions keep going (2.1.309) — CLAUDE-CTRL-01: scoped to the Desktop app and VS Code hosts. Mainframe spawns the CLI as a stream-json host and sets no `CLAUDE_CODE_ENTRYPOINT`. If `rm` in a Mainframe `bypassPermissions` chat starts coming back as a denial with no prompt, the gate is wider than the changelog says; look here first.
- Changed commands the settings exclude from the sandbox to ask before writing to its write-list paths while the sandbox is enabled but cannot run; the unsandboxed fallback is refused there (2.1.309) — CLAUDE-CTRL-01: only with a user-configured sandbox. The extra asks arrive as `can_use_tool`.
- Changed `claude ultrareview` to require workspace trust: it asks on a terminal, else refuses; scripts pass `--trust-workspace`, which takes no value (put a PR number or base branch before it), or set `CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK=1` (2.1.309) — CLAUDE-FLAG-02 / CLAUDE-FILE-06: Mainframe never spawns `claude ultrareview`. Trust for its own spawns still goes through `~/.claude.json` and the stderr advisory (CLAUDE-IO-01).
- Fixed sessions compacting repeatedly after reading files under a very large nested CLAUDE.md; a nested CLAUDE.md over the size limit now loads only its start (2.1.309) — CLAUDE-EVT-01: fewer `compact_boundary` / `status == "compacting"` events. The event shapes are unchanged.
- Fixed long tool output previews being cut through an emoji, leaving session transcripts that `jq` could not parse (2.1.309) — CLAUDE-FILE-04: older transcripts may still hold such lines. `history.rs`, `history_paths.rs` and `history_discovery.rs` parse line by line and skip a line that fails `serde_json::from_str`, and `presentation_history.rs` uses `filter_map(.. .ok())`, so one bad line drops that entry and nothing else. New transcripts stop producing them.
- Fixed sessions renamed with `/rename` appearing to other sessions under a generated name after a VS Code window reload or a non-interactive `--resume` (2.1.309) — CLAUDE-FILE-03: `external_session_enrich.rs` reads `customTitle`. The fix keeps the user's title in the transcript after a `--resume`, which Mainframe always uses, so discovered titles get more accurate.
- Fixed a skill in an `--add-dir` folder being unreachable when another skill already held its name; it is now offered as `<folder>:<name>` (2.1.309) — CLAUDE-FILE-05: Mainframe never passes `--add-dir` (no hit in the adapter), so its skill discovery never meets the new `<folder>:<name>` form.
- Fixed plugins and skills synced from claude.ai being removed, sometimes mid-session, after a disk read error (2.1.309) — CLAUDE-FILE-05: a fix that stops synced skills disappearing from disk. Discovery then finds them more reliably. The paths are unchanged.
- Improved disk-full handling: a Bash command cut off by a full disk now says so and names the folder to free up, and starting on a full temp volume prints a clear message, not a raw ENOSPC error (2.1.309) — CLAUDE-IO-01: the startup message misses the noise filters and is reported as an error, which is what it is. It has nothing in common with the trust-advisory strings.

## Dropped as irrelevant (64)

2.1.308 "Bug fixes and reliability improvements"; sandbox containment fixes ×4 (shell startup files, macOS `denyWrite` through symlinks, profile store through symlinks, Linux write denies after session end); worktree isolation guard ×2 (locale prefixes, zsh arithmetic); worktree git replace refs; worktree on-demand fetch; TUI ×3 (ctrl+enter queueing, key-bound slash commands in `!` mode, ctrl+o pending messages); PDF Read in Linux sandboxes; Claude Desktop-hosted message loss; Desktop app account mismatch; `claude remote-control` status line; split-pane teammate deny rules; `/rewind` "No code changes"; `/privacy-settings`; feedback ×2; `/verify` and `/code-review` nested skills; `/claude-api` skill ×7; dataviz skill; PowerShell hooks (Windows); mod `turn.step` alias; artifact publish refusals; Bedrock fine-grained tool streaming; "Waiting for API response" hint; GitHub mentions; Windows PowerShell `Set-Location`; macOS Command Line Tools dialog; self-hosted runner ×2; Windows git speed and English git errors; nested hooks-module error; VSCode ×10; Cloud sessions ×5; Claude Tag ×5; Code Review ×2.
