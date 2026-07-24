# @qlan-ro/mainframe-core

## 2.0.0-rc.13

### Patch Changes

- [#502](https://github.com/qlan-ro/mainframe/pull/502) [`f202afd`](https://github.com/qlan-ro/mainframe/commit/f202afd5f72c5da542eb81cc8b40792f9d82c4eb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions whose transcript failed to load in the Rust daemon. When a session's `thread/read` history contained an item type this port didn't know — `contextCompaction` (emitted after a context compaction) or `subAgentActivity` (multi-agent) — the whole payload failed to deserialize and the transcript rendered empty. Unrecognized items are now skipped on reload, matching the Node daemon, so the rest of the history still loads.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.13
