/**
 * Ghost-chat prune set (todo #346).
 *
 * new-thread-coordinator's abandon cleanup can discard a chat that never went
 * through any row/aui interaction — it is aui-free by design, called from a
 * non-React create workflow. A discard removes the chat server-side, but
 * `list()` reports a discarded chat by simply OMITTING it, not by flagging a
 * status change — so the merge in `RemoteThreadListThreadListRuntimeCore`'s
 * `reload()` (`{...state.threadData, ...fresh.threadData}`) keeps serving the
 * stale `status: 'regular'` entry forever: a ghost sidebar row that 404s on
 * click, never pruned by anything downstream.
 *
 * This module is the seam: the coordinator marks a discarded remote id in a
 * PERSISTENT set here; `useGhostChatPrune` reconciles that set against the
 * live thread list on every `items` change (not a one-shot drain) and removes
 * a ghost's stale entry via `aui.threads.item(id).delete()` once the id
 * actually appears in `items`, clearing it from the set only after that
 * delete succeeds.
 *
 * A persistent, reconciled-on-every-change set (replacing the original
 * notify-then-drain queue) fixes two real bugs the drain design had:
 *  - an id marked before a stale in-flight reload lands could be dropped by a
 *    drain that ran before the id was ever present in `items`, with nothing
 *    left to re-add it once the reload actually caught up;
 *  - an id marked before `useGhostChatPrune` had subscribed (e.g. during the
 *    very first render) was never drained at all, since there was no
 *    listener yet to receive the notification.
 */
const discardedChatIds = new Set<string>();

/** Mark a remote chat id as discarded outside any row/aui interaction. */
export function markChatDiscarded(remoteId: string): void {
  discardedChatIds.add(remoteId);
}

/** The ids still pending a local prune. Live view — do not mutate directly. */
export function getDiscardedChatIds(): ReadonlySet<string> {
  return discardedChatIds;
}

/** Remove an id once its local entry has actually been pruned. */
export function clearDiscardedChatId(remoteId: string): void {
  discardedChatIds.delete(remoteId);
}
