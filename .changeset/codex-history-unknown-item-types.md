---
'@qlan-ro/mainframe-core': patch
---

Fix Codex sessions whose transcript failed to load in the Rust daemon. When a session's `thread/read` history contained an item type this port didn't know — `contextCompaction` (emitted after a context compaction) or `subAgentActivity` (multi-agent) — the whole payload failed to deserialize and the transcript rendered empty. Unrecognized items are now skipped on reload, matching the Node daemon, so the rest of the history still loads.
