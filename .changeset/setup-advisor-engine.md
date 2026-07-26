---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-app-tauri': patch
---

Add the Setup Advisor's detection engine and rule catalog. The daemon can now fingerprint a project — languages, frameworks, testing and tooling configs, git host, project size — and match it against 76 recommendations spanning MCP servers, skills, hooks, subagents, and plugins. Each recommendation carries the evidence that earned it and where its command comes from, so a third-party install is a decision rather than a surprise. A read-only `GET /api/projects/{id}/automation-recommendations` route serves the report; parsing `pyproject.toml` for Python dependencies adds the `toml` crate (declared `0.8`, resolved 0.8.23) to `packages/core-rs`.
