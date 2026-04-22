# @qlan-ro/mainframe-desktop

## 0.12.0

### Minor Changes

- [#230](https://github.com/qlan-ro/mainframe/pull/230) [`29f192c`](https://github.com/qlan-ro/mainframe/commit/29f192c95f9507a6625e42d134fe599cb3f000b1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a project from the sidebar. Two discoverable entry points route through the same confirm-and-cleanup flow:
  - Hover the project group header (in the "All" view) → trash icon fades in next to "New Session".
  - When filtered to a specific project, the active filter pill shows a chevron — clicking it opens a menu with "Delete Project".

  Confirming stops all running CLI sessions in that project, removes all its chats from the database in a transaction, and resets any active filter or selected chat that belonged to the deleted project. Files on disk are not affected.

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831), [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5)]:
  - @qlan-ro/mainframe-types@0.12.0
  - @qlan-ro/mainframe-core@0.12.0
