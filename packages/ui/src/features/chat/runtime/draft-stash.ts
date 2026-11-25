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

function isEmptyDraft(draft: DraftStash): boolean {
  return draft.text === '' && draft.attachments.length === 0;
}

/**
 * Call from the runtime hook's unmount cleanup. No-op unless `markForStash`
 * was called for this id.
 *
 * Guards against a lost-draft race (the chat-switch regression this fixed):
 * `handoffDraft` can land a non-empty stash for this SAME id (this instance
 * handed off whatever the user typed before it lost displayed status)
 * BEFORE `OffloadRelease` later marks and evicts this now-empty instance. An
 * empty capture must never clobber that — it would overwrite the user's real
 * draft with the cleared composer nobody is looking at.
 */
export function captureIfMarked(chatId: string, draft: DraftStash): void {
  if (!pending.delete(chatId)) return;
  const existing = stash.get(chatId);
  if (isEmptyDraft(draft) && existing != null && !isEmptyDraft(existing)) return;
  stash.set(chatId, draft);
  notifyWaiters(chatId);
}

/** Call from the runtime hook's mount effect. One-shot: consumes the stash. */
export function takeStash(chatId: string): DraftStash | undefined {
  const draft = stash.get(chatId);
  stash.delete(chatId);
  return draft;
}

/**
 * Pass a draft from the composer that stops showing a chat to the one that
 * starts: the chat column's to a workspace tab's when the chat opens there, and
 * a tab's own on its way out (`DraftKeeper`). Unconditional: the caller holds the
 * latest state.
 */
export function handoffDraft(chatId: string, draft: DraftStash): void {
  stash.set(chatId, draft);
  notifyWaiters(chatId);
}

/**
 * Wait for a draft to arrive for `chatId` when `takeStash` found nothing YET.
 * Whether the composer giving it up has run its handoff by the time the one
 * taking over mounts is NOT guaranteed (two commits, either order). Call
 * `takeStash` first; only register a waiter if it returns nothing. Returns an
 * unsubscribe function — call it on cleanup so an unmounted consumer that never
 * got a draft doesn't leak a listener.
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
