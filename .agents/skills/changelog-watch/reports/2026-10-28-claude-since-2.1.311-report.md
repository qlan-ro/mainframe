# changelog-watch: claude 2.1.311 → 2.1.312 (2026-10-28)

Entries seen: 39 · risks: 0 · opportunities: 0 · relevant, no action: 7 · dropped as irrelevant: 32

One version, and no checklist row breaks. The installed CLI is still 2.1.310, so nothing here was run live. One entry looked like a high-severity risk and was checked against the 2.1.310 and 2.1.312 `darwin-arm64` binaries. Strings were extracted from both, and neither binary was executed:

- **Usage-limit copy now says "5-hour limit" instead of "session limit" (#20).** `quota_parse.rs::parse_claude_usage` returns Unknown for the whole provider on any line it can't classify, so a renamed `/usage` title would be a silent quota break. The `/usage` titles are byte-identical in both binaries: `{bar:"five_hour",title:"Current session"…}` and `"Current week (all models)"`. Only the limit-hit and reset copy changed (`five_hour:"session limit"` became `"5-hour limit"`, giving `You've hit your 5-hour limit …`). No production code in `packages/core-rs` or `packages/ui` matches on that text. It appears only as opaque fixture strings, and prompt grouping keys on `promptId`/`parentUuid`.

## Compatibility risks

None.

## Adoption opportunities

None.

## Relevant, no action

- Changed usage limit messages to call the 5-hour window the "5-hour limit" instead of the "session limit" — `CLAUDE-PROBE-03`: the `/usage` titles `Current session` and `Current week (all models)` are unchanged in the 2.1.312 binary. Live quota comes from `rate_limit_event`, keyed by `five_hour` (`CLAUDE-EVT-05`). The renamed limit-hit text is not parsed anywhere. Fixtures in `history_prompt_groups_tests.rs`, `mainframe-display/src/message_grouping_tests.rs` and `mainframe-server/tests/claude_history_prompt_boundaries.rs` still use the old wording as opaque text, and that is harmless.
- Fixed a command with an invalid name stopping all commands from loading, which could leave `claude -p` with no output — `CLAUDE-FLAG-02`: the quota pull and title generation run `claude -p`. This fix removes one cause of their silent empty-stdout failure. The argv is unchanged.
- Fixed a rare case where the first reply after resuming a session in the terminal could be missing the next time the session was resumed — `CLAUDE-FILE-04`: transcripts are more complete. The JSONL shape is unchanged.
- Fixed the spinner, OpenTelemetry `effort` values and transcripts naming a newly picked effort level during a task before the model applied it; they now show the level in force — `CLAUDE-CTRL-03`: Mainframe sends effort through `apply_flag_settings` and reads it back from neither transcripts nor OTel.
- Fixed per-directory and `paths:` skills not being found after a Bash `cd` deeper into a git repository — `CLAUDE-EVT-02`/`CLAUDE-FILE-05`: more nested skills will now be invoked. The transcript skill block takes its path from the `Base directory for this skill:` marker (`user_event_content.rs::extract_skill_block`), so it is correct. See "Found during review" for the live `Skill` tool_use path.
- Changed Bedrock, Vertex, Foundry and Mantle to use the shorter system prompt for model names Claude Code doesn't recognize… — `CLAUDE-ENV-01`: CLIProxy sessions use the first-party provider with `ANTHROPIC_BASE_URL`, not one of these four providers.
- Changed automatic model switches after a flagged message to also cover model names Claude Code doesn't recognize, such as custom deployment names; set `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1` to turn them off — `CLAUDE-ENV-01`: in the 2.1.312 binary, switching is gated on `ms()` = `provider==="firstParty" && Pi()`. `Pi()` is false when `ANTHROPIC_BASE_URL` is set to a non-Anthropic host (`hu()` → `_c(baseUrl)`). CLIProxy sessions point it at `127.0.0.1`, so their unrecognized `cliproxy/` models never switch. Native sessions use recognized model IDs and were already covered before this release.

Dropped (32): `oidc.user_id_claim` gateway; click-to-send queued hint; managed settings after VS Code sign-in; Write large-file read-first guard (tool behaviour only); PDF `pdftoppm`; `/model` and `/effort` cache-warning copy; "waiting on you" detection; agent view ×2; vim `gj`/`gk`; `/verify` description; effort indicator copy; WebFetch cloud errors; cloud session names; prompt/agent hook concurrency (Mainframe registers no hooks); subagent `autoCompactWindow`; OpenTelemetry ×2; [VSCode] ×2; [Cloud sessions] ×6; [Remote Control] ×1; [Claude Tag] ×4; [Code Review] ×1.

## Found during review (not caused by 2.1.312)

### low — live `Skill` tool_use resolves nested per-directory skills to a non-existent path (unverified)

`assistant_event_tools.rs::scan_skill` handles `Skill` with `resolve_skill_path`. That function tries only `<project>/.claude/skills`, `~/.claude/skills` and plugin dirs, then falls back to the conventional `<project>/.claude/skills/<name>/SKILL.md`. For a skill in `<project>/<subdir>/.claude/skills/`, `on_skill_file` receives that fallback path, which does not exist. The later `Base directory for this skill:` injection writes the real path into `skill_path_cache`, so the transcript block is correct. The skill-file panel entry emitted at tool_use time probably is not. This gap predates 2.1.312, but the release makes nested skills fire more often. To verify, invoke a nested skill in a live chat and see what the skill-file panel opens. Fix direction: prefer the injected base dir, or re-emit `on_skill_file` once the injection arrives.

### carry-overs from 2026-10-27 (not re-checked this run)

The medium UTF-8 split in `events.rs::handle_stdout`, the low `CLAUDE-PROBE-02` static-catalog drift, and the `CLAUDE-FLAG-01` doc omission of `auto` were not re-checked in this run.
