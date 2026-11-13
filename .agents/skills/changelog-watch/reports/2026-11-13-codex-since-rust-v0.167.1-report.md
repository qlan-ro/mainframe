# changelog-watch: codex rust-v0.167.1 → rust-v0.167.2 (2026-11-13)

Entries seen: 1 · risks: 0 · opportunities: 0 · relevant, no action: 0 · dropped as irrelevant: 1

One curated bullet: "Codex now sends tool updates incrementally by default on Google Cloud Vertex AI. To opt out, set `incremental_tools_legacy_gcp = false` under `[features]` in `config.toml`." (#60617, #60848). It concerns how Codex declares tools to a Vertex-hosted model. It names no app-server method, notification, item type, rollout field or state file, so the filter drops it.

To confirm the drop, I read the compare (`gh api repos/openai/codex/compare/rust-v0.167.1...rust-v0.167.2`). It holds 3 commits:

- `6dca0328` Support incremental tool declarations on GCP (#60617)
- `b97af6c4` Enable incremental tool declarations by default for GCP (#60848)
- `ce21072c` release notes / version bump

The changed files are in `codex-rs/core` (session code and test suite), `codex-rs/features/src` and the workspace manifest. No app-server, protocol or rollout file changed. This continues the `incremental_tools_legacy` work dropped on 2026-11-11 (rust-v0.167.1). Mainframe passes no `features.*` overrides (`CODEX-FLAG-01`, `CODEX-FLAG-05`) and doesn't configure Vertex.

## No relevant changes

Nothing in rust-v0.167.2 touches a checklist row.
