# changelog-watch: claude 2.1.302 → 2.1.305 (2026-10-21)

Entries seen: 115 · risks: 1 · opportunities: 1 · relevant, no action: 20 · dropped as irrelevant: 94

Delta: `reports/2026-10-21-claude-since-2.1.302-delta.md` (2.1.303 one entry, 2.1.304 76, 2.1.305 38).

Run notes:

- The first fetch failed with `unknown anchor: 2.1.302 — absent from the complete upstream list`. The anchor was not missing. Upstream `CHANGELOG.md` is now 1,063,371 bytes. For files over 1 MB, the GitHub contents API returns `content: ""` with `encoding: "none"`, so the fetcher parsed zero sections. `scripts/fetch-delta.mjs::fetchChangelogText` now requests `Accept: application/vnd.github.raw`. `buildDelta` also refuses an empty section list, so this failure can no longer look like an unknown anchor. All 23 script tests pass.
- Verification used the installed 2.1.304 CLI and the `@anthropic-ai/claude-code-darwin-arm64@2.1.305` binary. The 2.1.305 binary was unpacked into `/tmp` and only searched as text, never run. Three live checks ran on 2.1.304:
  - `claude -p "/usage"`: parses into all three windows.
  - `-p /usage` in a project with an invalid `.claude/settings.json`: the warning goes to stderr and stdout is unchanged.
  - The 2.1.305 headless `/usage` composer (`call` → `formatRateLimits` + `formatBehaviors`) was read directly.

## Compatibility risks

### medium — Changed tool search to be on by default behind a custom `ANTHROPIC_BASE_URL`; a 400 or 422 from the gateway is retried without it (2.1.304)

- Checklist row: CLAUDE-ENV-01 — `src/session_spawn.rs::build_spawn_command`, `src/cliproxy.rs::resolve_env`
- Why it threatens the row: every `cliproxy/` chat runs behind a custom `ANTHROPIC_BASE_URL`, so as of 2.1.304 these chats send deferred tools and the tool-search beta to CLIProxyAPI. The 2.1.304 retry was broken, and the 2.1.305 entry "Fixed every request failing on Vertex, Bedrock and other providers when the endpoint or a gateway rejects tool search … (a 2.1.304 regression)" confirms it. So on 2.1.304, the version installed on this machine, a proxy chat fails every request if CLIProxyAPI refuses the beta. That failure is visible. The quieter case is still open on 2.1.305: if CLIProxyAPI accepts the request but drops `defer_loading`/`tool_reference` while translating to a non-Anthropic backend, deferred tools may never load. That includes the orchestration `mcp__mainframe__*` tools (CLAUDE-FLAG-04). The 2.1.305 binary names the opt-out: "ENABLE_TOOL_SEARCH=false avoids the refused request".
- Recommended regression test: once the env decision is made, add `#[test] a_proxy_session_pins_tool_search_off` in `src/session_tests_spawn_part_1.rs`, beside `a_proxy_session_is_pointed_at_the_endpoint_and_stripped_of_the_real_api_key`. It should assert `ENABLE_TOOL_SEARCH == Some("false")` in a proxy spawn's env, and extend `a_native_session_carries_no_endpoint_env` to assert the key is absent there.
- Verify live: `.claude/skills/claude-protocol-debugger/`. Open a `cliproxy/` chat on 2.1.304 and on 2.1.305 and send one turn. Check stream-json for an `api_error`, then call an `mcp__mainframe__*` tool.

## Adoption opportunities

- Resume-cost warning before reopening an idle, long chat. The CLI's version is an Ink dialog only (see no-action below), so Mainframe would build its own from the context tokens it already tracks (CLAUDE-EVT-04) and the live session-window utilization (CLAUDE-EVT-05). It would land in the chat resume path in the UI plus a small daemon field. Size: medium.

## Relevant, no action

- Fixed every request failing on Vertex, Bedrock and other providers when the endpoint or a gateway rejects tool search, and behind gateways with ToolSearch disallowed or left out of `--tools` (a 2.1.304 regression): Claude Code now retries without it (2.1.305) — CLAUDE-ENV-01: this is the recovery for the risk above. The 2.1.305 binary keeps tool search off for the rest of the conversation after a refusal ("Tool search is off for this conversation: the endpoint refused it earlier").
- Fixed an MCP server passed by a cloud session or by the SDK's `setMcpServers` being replaced later in the session by a same-named server from your own settings (2.1.305) — CLAUDE-FLAG-04: Mainframe injects `mainframe` through `--mcp-config` argv, not `setMcpServers`. The row's "`mainframe` key collision" live check stays pending.
- Fixed startup warnings printing as raw text above the logo: they now go to the debug log, and permission rules that restrict nothing show as warning rows under the banner (2.1.305) — CLAUDE-IO-01: fewer lines reach the terminal. The stderr filters only drop lines, so less input cannot raise a spurious error.
- Improved `/usage`: each warning is now a one-line fix that names its source, and `f` applies the fixes; the same fixes appear in VS Code and `/doctor` (2.1.305) — CLAUDE-PROBE-03: in the 2.1.305 binary, the headless composer renders these as `recommendations` inside `formatBehaviors`, whose first line is the "What's contributing to your limits usage?" anchor where `parse_claude_usage` stops. The `f`/"fix this" copy exists only in the Ink dialog.
- Fixed `/usage` rows being cut off in narrow terminals (2.1.305) — CLAUDE-PROBE-03: an Ink layout fix. The headless `-p` path joins plain `Title: N% used · resets …` lines (`formatRateLimits`).
- Added `decider: "person"` to a mod's `tool.check` answer: only the permission dialog or a host's callback can approve the ask, and it is refused with the mod's reason where nobody can be asked (2.1.304) — CLAUDE-CTRL-01: a host callback is the `can_use_tool` request Mainframe already answers. Only hosts with no callback get the refusal.
- Fixed `rm -r` of a mounted drive or a folder at its top level (`/Volumes`, `/media`, WSL's `/mnt/c`) not getting the safety prompt that `rm -rf /Applications` gets (2.1.304) — CLAUDE-CTRL-01: one more ask through the existing `can_use_tool` path.
- Fixed `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC` dropping messages from the saved transcript when the disk filled up while the file was being trimmed (2.1.304) — CLAUDE-FILE-04: Mainframe never sets the variable, and the fix makes the JSONL less lossy.
- Fixed model switches, messages and interrupts waiting behind a context usage check in SDK and desktop sessions (2.1.304) — CLAUDE-CTRL-03: `set_model`/`interrupt` are answered sooner, so the 10 s SIGINT fallback should fire less often. The protocol is unchanged.
- Fixed `context_management: Extra inputs are not permitted` errors behind LLM gateways; Claude Code now resends the request without that field (2.1.304) — CLAUDE-ENV-01: an upstream fix that helps proxy chats.
- Fixed a "Context limit reached" or "Prompt is too long" error after stopping a turn while Claude Code was compacting a conversation the API had rejected as too long (2.1.304) — CLAUDE-CTRL-03: a fix behind the `interrupt` Mainframe sends. Event shapes are unchanged.
- Fixed `claude --help` text for `--tools`, `--resume`, `--debug`, `--json-schema`, `--disable-slash-commands`, `--system-prompt-snapshot` and `claude update` to match actual behavior (2.1.304) — CLAUDE-FLAG-01: help text only. `--no-session-persistence`, whose help text CLAUDE-FLAG-03 tracks, is not in the list.
- Fixed an interrupt not ending a Read that waits on an idle pipe or device named like an image (2.1.304) — CLAUDE-CTRL-03: a fix behind `interrupt`.
- Added a warning on Pro and Max plans when resuming an inactive conversation would use a noticeable share of your 5-hour usage limit: resume anyway, or start a new conversation and Claude can look up the previous one if you refer to it (2.1.304) — CLAUDE-FLAG-01: binary-verified as an Ink dialog ("Resume this conversation?", Resume / Start a new conversation). A stream-json `--resume` spawn never renders it. Adoption angle noted above.
- Improved `/usage` to say when a rate limit on usage data ends instead of "try again in a moment" (2.1.304) — CLAUDE-PROBE-03: both wordings are unclassifiable lines, so the provider fails to Unknown either way, same as before.
- Added the names of the tools called earlier to the compaction summary in the transcript view (Ctrl+O) (2.1.304) — CLAUDE-EVT-03 / CLAUDE-PROBE-03: `COMPACT_SUMMARY_PREAMBLE` appears in the 2.1.305 binary the same 4 times as in 2.1.304. The check is `starts_with`, so appended tool names don't affect it.
- Improved session file size in auto mode: the safety classifier's context is no longer stored with every request (2.1.304) — CLAUDE-FILE-04: removes data Mainframe's history reader never reads.
- Improved the `claude -p` invalid-settings warning: a file that did not load lists only what stopped it, and long lists are capped per file (2.1.304) — CLAUDE-FLAG-02: verified live on 2.1.304. The warning ("These settings files did not load…") goes to stderr, and the quota pull's stdout still parses. In a stream-json chat the same stderr lines don't match the `^Warning:` filter (CLAUDE-IO-01), so they surface as errors. That was already true, and it fits: the user's settings really are not in effect.
- Improved resume of large compacted sessions in SDK and headless mode: the first request after resuming is sent sooner (2.1.304) — CLAUDE-FLAG-01: `--resume` is unchanged and only faster.
- Changed compaction to send Claude the skill list again afterwards; `/reload-skills` now sends only new or changed skills (2.1.304) — CLAUDE-EVT-03: model-facing context. If it reaches the stream it arrives as meta/synthetic content, which `handle_user_event` already suppresses.

## Notes noticed in passing (not delta entries)

- The structured `get_usage` control request ("Structured /usage data … Experimental") is in both 2.1.304 and 2.1.305. Headless `/usage` also returns it as a `usageReport` twin. It is already tracked as adopt-candidate B1 in `docs/research/adapters/claude/AGENT-SDK-PARITY.md`. Once adopted it would retire CLAUDE-PROBE-03's prose parser, which has now changed in 2.1.236, 2.1.243, 2.1.299 and 2.1.305.
