---
'@qlan-ro/mainframe-core': patch
---

fix(core): reconcile queued-message state on every result event

The previous gated sweep (`queueRemaining === 0`) couldn't escape the
common stranded-state where a leftover `queuedRefs` entry kept the count
non-zero and pinned `processState='working'` forever, while the renderer's
composer banner showed stale rows that no event would ever clear.

`onResult` now reconciles bidirectionally:
- Cached `metadata.queued` with no matching ref → strip the flag and emit
  `message.queued.processed(uuid)`.
- `queuedRef` with no matching cached message → drop the ref and emit
  `message.queued.processed(ref.uuid)`.
- Always emits `message.queued.snapshot` so the renderer's
  `queuedMessages` map converges on the daemon's truth — defends against
  any out-of-order delivery between `message.queued` and
  `message.queued.processed`.

`processState` now uses the post-reconcile count.
