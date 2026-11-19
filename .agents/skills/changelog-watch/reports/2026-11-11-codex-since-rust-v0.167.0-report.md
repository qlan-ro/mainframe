# changelog-watch: codex rust-v0.167.0 → rust-v0.167.1 (2026-11-11)

Entries seen: 1 · risks: 0 · opportunities: 0 · relevant, no action: 0 · dropped as irrelevant: 1

The rust-v0.167.1 release notes have no text, only the compare link. The release names no surface, so the filter drops it. Because empty notes say nothing, I read the compare (`gh api repos/openai/codex/compare/rust-v0.167.0...rust-v0.167.1`) to confirm the drop. It holds 3 commits:

- `3e9cb463` Add opt-in incremental tools for regular OpenAI Responses (#59832)
- `ba8b4035` Restrict legacy incremental tools to Amazon Bedrock providers (#60040)
- `0a94398f` version bump (`codex-rs/Cargo.toml`)

The changed files are all in `codex-rs/core` (turn and step context, remote compaction, world state, tests), plus `codex-rs/features` and `core/config.schema.json`. They add one feature key, `incremental_tools_legacy` (stage `UnderDevelopment`, off by default). No app-server, protocol or rollout file changed. Mainframe passes no `features.*` overrides (CODEX-FLAG-01, CODEX-FLAG-05), so no checklist row is touched. The installed CLI is 0.163.0.

## Compatibility risks

None.

## Adoption opportunities

None.

## Relevant, no action

None.

Dropped (1): rust-v0.167.1, empty release notes; the commits are model-context internals behind a default-off feature flag.
