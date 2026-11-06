# changelog-watch: claude 2.1.310 → 2.1.311 (2026-10-27)

Entries seen: 92 · risks: 0 · opportunities: 0 · relevant, no action: 15 · dropped as irrelevant: 77

One large version. No checklist row breaks. Three entries looked like risks and were checked against code and the live CLI:

- **`[1m]` suffix dropped from model IDs (#69).** The `initialize` catalog on this account is identical on 2.1.310 and 2.1.311 (13 entries, none with `[1m]`), so nothing changes here. The check exposed standing drift in `CLAUDE-PROBE-02`, listed under "Found during review" below.
- **stream-json escapes DEL, C1 and format characters (#68).** `events.rs::handle_stdout` splits on `\n` and parses with `serde_json`, so the parsed values are unchanged. Reading this path turned up a separate UTF-8 bug, also listed below.
- **`/usage` gains prompt-cache-miss lines (#44).** Ran `claude -p "/usage"` on 2.1.311. The window lines still come before `What's contributing…`, and `quota_parse.rs` stops scanning at that anchor.

Codex: `no changes: codex is current at rust-v0.164.0`.

## Compatibility risks

None.

## Adoption opportunities

None new.

## Relevant, no action

- Fixed interrupting Claude not taking effect until a timeout while an MCP server had not answered a resource read or a skill was still downloading — `CLAUDE-CTRL-03`: the protocol `interrupt` now lands in that case, so the `stop_task` → SIGINT escalation fires less often. The escalation stays correct either way.
- Fixed standard-context sessions stopping with "Usage credits required for 1M context" when a request ran over 200K tokens; Claude Code now compacts the conversation and continues — `CLAUDE-EVT-01`/`CLAUDE-EVT-04`: a turn that used to end in an error `result` now emits `compact_boundary` and continues. Both paths are already handled.
- Fixed Write and Edit stalling for up to 5 seconds after they ran, and reporting 0 lines changed, when changing thousands of lines in a file — `CLAUDE-EVT-03`: the `toolUseResult` for large edits is now correct; the shape is unchanged.
- Fixed subagents being unable to use MCP tools from servers that finish connecting after the subagent starts — `CLAUDE-FLAG-04`: subagents started before the `mainframe` HTTP server connects now get `mcp__mainframe__*`. This is a fix that helps us.
- Fixed `claude -p` and SDK sessions saving transcript messages out of order or keeping messages that were taken back — `CLAUDE-FILE-04`/`CLAUDE-FILE-09`: new transcripts are now in order, which helps history rebuilds and the prefix-cut fork. Transcripts already on disk from older CLIs can still be out of order. That is a pre-existing condition this version does not create.
- Fixed background agents in auto mode that wait on their own shells starting a new main conversation turn on every wake — `CLAUDE-EVT-04`: Mainframe runs `--permission-mode auto`, so this removes spurious unprompted turns. No shape change.
- Fixed agent teams sessions showing an empty task list when coming back with `--resume`, `--continue`, `/resume` or `--session-id`, including after `/clear` or a crash, and `/branch` writing to the original session's list — `CLAUDE-EVT-02`: Mainframe builds its task list from the `TaskCreate`/`TaskUpdate` tool stream, not the CLI's restored list. Only what the model sees after a resume changes.
- Fixed `/usage` never showing large prompt-cache misses under "What's contributing to your limits usage?" — `CLAUDE-PROBE-03`: the new lines sit below the `What's contributing` anchor where `parse_claude_usage` stops. Verified live on 2.1.311: Session, Week (all models) and Week (Fable) all parse before the anchor.
- Fixed Claude Code retrying requests the API marked not to retry, which could hold a turn for minutes or, in unattended retry mode (`CLAUDE_CODE_RETRY_WATCHDOG`), indefinitely — `CLAUDE-EVT-04`: such turns now end quickly with an error `result`, a path already handled.
- Improved shell commands that reach their timeout: the result now shows the output so far and says the command is still running in the background — `CLAUDE-EVT-01`/`CLAUDE-EVT-03`: only the `tool_result` text changes. Background continuation is still reported through `task_*` system events.
- Improved compaction: when the model's reply has no summary in it, Claude Code now usually asks for the summary once more before it replaces the conversation — `CLAUDE-EVT-01`: `compact_boundary` and the compacting status are unchanged. `COMPACT_SUMMARY_PREAMBLE` (`CLAUDE-PROBE-03`) is not mentioned.
- Changed `ultrathink` in the interactive terminal to run its turn at xhigh effort on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 through Anthropic's API; typed while Claude is working, it raises the rest of that turn — `CLAUDE-CTRL-03`: limited to the interactive terminal. In stream-json sessions effort still travels only through `apply_flag_settings`.
- Changed `--output-format json` and `stream-json` output to write DEL, C1 control and Unicode format characters inside strings as `\uXXXX` escapes; parsed values are unchanged — `CLAUDE-EVT-*`: `events.rs::handle_stdout` frames on `\n` and parses with `serde_json::from_str`, with no raw-substring checks before parsing. The escaping slightly reduces exposure to the UTF-8 bug below, because those characters no longer arrive as raw multi-byte sequences.
- Changed model names and IDs to drop the `[1m]` suffix and its label on models where the suffix has no effect; the suffix is still accepted — `CLAUDE-PROBE-01`/`CLAUDE-PROBE-02`/`CLAUDE-CTRL-06`: the live `initialize` catalog on this account is byte-identical between 2.1.310 and 2.1.311 and had no `[1m]` entries before the change. `models.rs::base_id`, `context_variants::known_base_variant`, and the UI's `model-catalog.ts::matchCatalogModel` all accept IDs with or without the suffix. The CLI still accepts chats saved with a `[1m]` ID. On accounts whose catalog did list `[1m]` variants, the window now comes from the static table, and that table hits the drift described below.
- Changed Claude Code on Bedrock, Mantle, Vertex, and Foundry to load model settings from a signed file on downloads.claude.ai; set CLAUDE_CODE_MODEL_CATALOG=off to turn this off — `CLAUDE-PROBE-01`: the catalog's content source changes on those providers. The `initialize` response shape does not.

Dropped (77): self-hosted-runner ×2; output-style tip; CLAUDE.md list-item freeze; stale MEMORY.md after compaction; `SubagentStop` hook cadence (Mainframe registers no hooks); @ picker; subagent worktree lifetime; Bash tool description and environment shell naming; `claude mcp` CLI ×2 and `/mcp` ×2; Remote Control and cloud ×3; Cowork ×2; `claude daemon` and background service ×4 (#22–24, #54); `/effort` plan warning; `/ide` ×2; Write preview; agent tab ↑; image-path paste; feedback card; lone-backslash rendering; `DISABLE_COMPACT` ×3 (Mainframe never sets it); `/code-review` ×2; Vertex/Foundry thinking idle; Pro/Max billing copy; diff pane; `--plugin-dir` ×2; status line links; `/rewind` ×2; screen reader ×3; startup time ×2; `/teleport`; artifacts ×2; Connection-dropped copy; sign-in copy; Slack connector; `ultrathink` rainbow; Ctrl+D; settings warnings; `CLAUDE_CODE_SYNC_SKILLS`; scrollbar; `claude purge`; and the 16 bracketed product-surface entries: [VSCode] ×8, [Cloud sessions] ×3, [Claude Tag] ×3, [Code Review] ×2.

## Found during review (not caused by 2.1.311)

### low — static fallback catalog is missing the current model generation (`CLAUDE-PROBE-02`)

The live probe resolves `default`→`claude-fable-5-1`, `fable`→`claude-fable-5-1`, `sonnet`→`claude-sonnet-5-5` and `haiku`→`claude-haiku-5-5`. Every description is now a tagline ("For your toughest challenges") with no `NNN context` phrase and no `[1m]`. `models.rs::CURRENT_MODELS` stops at `claude-opus-5-5`/`claude-fable-5`/`claude-sonnet-5`, so for those four entries `enrich_one` finds no suffix, no description window and no static match, and leaves `context_window: None`.

Effect: the picker label lacks its `· 1M` size, and `deriveContextPct` has no token-estimate fallback. The gauge still works once the CLI reports `usage_update`. The handoff budget falls back to `native_max`. Fix: add `claude-fable-5-1`, `claude-sonnet-5-5` and `claude-haiku-5-5` to `CURRENT_MODELS` with windows taken from the CLI's model registry, and extend `models_tests.rs` with a probe fixture using exactly these four entries, asserting `context_window == Some(..)` for each.

### medium — multi-byte UTF-8 split across a stdout read becomes U+FFFD (live stream only)

`mainframe-runtime/src/process/pumps.rs::spawn_chunk_pump` hands raw 8 KiB reads to `events.rs::handle_stdout`, which runs `String::from_utf8_lossy(chunk)` on each read before buffering. A multi-byte character that straddles a read boundary (`—`, `·`, emoji, CJK) is replaced with U+FFFD in the live transcript. Long stream-json lines, such as tool results, make this routine. History reload goes through `BufReader::lines()` and is unaffected, so the corruption disappears on reload, which makes it look intermittent. Fix: buffer bytes (`Vec<u8>`), split on `b'\n'`, and decode each complete line. Regression test: add a `#[test]` in `src/events_tests_*.rs` that feeds one assistant-text event split mid-codepoint across two `handle_stdout` calls and asserts the emitted text equals the original string.

### carry-over — `CLAUDE-FLAG-01` still omits `auto`

The 2026-10-24 report flagged this. `origin/main`'s checklist still lists `--permission-mode <default|acceptEdits|bypassPermissions|plan>`. Doc fix only.
