# changelog-watch: claude 2.1.321 → 2.1.322 (2026-11-11)

Entries seen: 1 · risks: 0 · opportunities: 0 · relevant, no action: 1 · dropped as irrelevant: 0

This pass covers one version with one entry. The installed CLI is still 2.1.318, so nothing here ran live. Consumers were read at `17fe001e` (`origin/chore/changelog-watch-2026-11-10`, which is `origin/main` plus the 2.1.321 anchor commit).

## Compatibility risks

None.

## Adoption opportunities

None new. Standing items carried from earlier passes: fast mode on Fable 5.2 in the fallback catalog (2026-11-10 report), MCP tasks for long orchestration calls, `permissions.denyInsteadOfPrompting` for unattended runs, sign-in expiry warning, slash-command feedback, subagent effort and MCP elicitation.

## Relevant, no action

- Added fast mode on Vertex in the global, us and eu regions, falling back to standard speed if Vertex refuses it — CLAUDE-CTRL-03 / CLAUDE-PROBE-01: Mainframe sets no Vertex variables (`mainframe-adapter-claude/src` has no Vertex or Bedrock references), so only a user's own environment can route a session through Vertex. In that case the composer's fast toggle is still gated by the probe's per-model `supportsFastMode`, `apply_flag_settings` still sends `fastMode`, and the fallback to standard speed happens inside the CLI on the same model, with no new event or field.

## Standing items, not from this delta

- Still open from 2026-11-10: `src/models_catalog.rs::CURRENT_MODELS` has no `claude-fable-5-2` entry. On 2.1.321 and later the `fable` alias resolves to a model with no catalog context window (CLAUDE-PROBE-02, low). The todo draft is in the 2026-11-10 report.
- Deadline: Opus 4.8 fast mode is removed on 2026-11-30, 19 days away. `src/models_catalog.rs:134` still has `fast: true` for `claude-opus-4-8`.
- Checklist drift, still unfixed (from 2026-11-07): CLAUDE-EVT-06 and the "Not consumed" list versus `--include-partial-messages`; CLAUDE-EVT-01 missing `task_progress` and `api_error`; rows citing `src/events.rs::{handle_system_event, handle_result_event}` after those moved.
