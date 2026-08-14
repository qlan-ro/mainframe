---
'@qlan-ro/mainframe-ui': patch
---

Pull requests opened from a Codex session are now detected, live and on reload. PR detection moved off the Claude adapter onto the shared message stream every adapter emits, and the cold-load rescan now reads a Codex chat's rollout JSONL instead of `thread/read`, whose 0.147.0 response never carried command output.
