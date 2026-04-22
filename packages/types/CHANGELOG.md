# @qlan-ro/mainframe-types

## 0.12.0

### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.
