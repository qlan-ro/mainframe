---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
---

Make chat title generation adapter-aware and import Codex sessions from disk. Title generation now runs behind an optional `Adapter.generateTitle` (Claude implements it; Codex keeps its deterministic first-message title instead of cross-spawning the `claude` binary). Codex external-session import scans the rollout JSONL files under `~/.codex/sessions` — matching a session to a project by its recorded `cwd` — so sessions started outside Mainframe show up too.
