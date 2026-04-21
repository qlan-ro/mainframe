---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Fix queued messages not clearing from the composer (#116).

The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:

- Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
- Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
- Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
- Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
- Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.
