/**
 * draft-stash — composer draft continuity across an offload release's
 * detach/remount cycle (#178, AC14: "the draft survives a release").
 *
 * Marking is explicit and consumed by the first capture: `OffloadRelease`
 * marks only the threads it is about to detach, so an unrelated unmount
 * (delete, archive — a subtree that never remounts) never stashes a draft
 * nobody will read. `use-chat-thread-runtime.ts` calls `captureIfMarked` from
 * its unmount cleanup and `takeStash` from its mount effect for the same
 * thread id — a fresh controller for a reopened offloaded chat is keyed by
 * the SAME id (no id-flip), so the stash re-attaches automatically.
 */

export interface DraftStash {
  readonly text: string;
  readonly attachments: readonly File[];
}

const pending = new Set<string>();
const stash = new Map<string, DraftStash>();
const waiters = new Map<string, Set<() => void>>();

function notifyWaiters(chatId: string): void {
  const set = waiters.get(chatId);
  if (set == null) return;
  waiters.delete(chatId);
  for (const callback of set) callback();
}

/** Call BEFORE detaching a thread whose composer draft should survive the unmount. */
export function markForStash(chatId: string): void {
  pending.add(chatId);
}

/** Call from the runtime hook's unmount cleanup. No-op unless `markForStash` was called for this id. */
export function captureIfMarked(chatId: string, draft: DraftStash): void {
  if (!pending.delete(chatId)) return;
  stash.set(chatId, draft);
  notifyWaiters(chatId);
}

/**
 * Seed a thread's composer before it first mounts — a from-message fork puts
 * the chosen message's text here, unsent. Read by the same one-shot
 * `takeStash`, so it lands exactly once and never survives a later remount.
 */
export function seedDraft(chatId: string, text: string): void {
  stash.set(chatId, { text, attachments: [] });
  notifyWaiters(chatId);
}

/** Call from the runtime hook's mount effect. One-shot: consumes the stash. */
export function takeStash(chatId: string): DraftStash | undefined {
  const draft = stash.get(chatId);
  stash.delete(chatId);
  return draft;
}

/**
 * Re-seed a draft this SAME runtime instance already took, the moment it
 * stops being the one actually displayed for `chatId` — a split zone that
 * only fits once the workspace panel parks, for instance: `splitFits` lags
 * `zones` by a render or more (ResizeObserver settles async), so the hidden
 * per-item hook can correctly be the displayed one, take the stash, and then
 * lose that status to `ChatZone` before the user ever sees it render there.
 * Captures whatever the composer holds NOW — the original stash text, or the
 * user's own edit — so the consumer that takes over picks up the latest
 * state instead of losing it. Unlike `seedDraft`, this is an unconditional
 * handoff between two runtime instances for the same chat id, not a
 * fork-prefill seed before first mount.
 */
export function handoffDraft(chatId: string, draft: DraftStash): void {
  stash.set(chatId, draft);
  notifyWaiters(chatId);
}

/**
 * Wait for a draft to arrive for `chatId` when `takeStash` found nothing YET.
 * `ZoneDraftRestore` needs this: whether the outgoing hook instance's
 * handoff effect has already run by the time `ChatZone` mounts and checks is
 * NOT guaranteed — the handoff reacts to that instance's OWN re-render
 * (`skipDraftRestore` flipping true), a separate commit from the one that
 * mounted `ChatZone`, so either side can run first. Call `takeStash` first;
 * only register a waiter if it returns nothing. Returns an unsubscribe
 * function — call it on cleanup so an unmounted consumer that never got a
 * draft doesn't leak a listener.
 */
export function waitForStash(chatId: string, onReady: () => void): () => void {
  let set = waiters.get(chatId);
  if (set == null) {
    set = new Set();
    waiters.set(chatId, set);
  }
  set.add(onReady);
  return () => {
    const current = waiters.get(chatId);
    if (current == null) return;
    current.delete(onReady);
    if (current.size === 0) waiters.delete(chatId);
  };
}
