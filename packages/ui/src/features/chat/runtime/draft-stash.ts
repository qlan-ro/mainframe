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

/** Call BEFORE detaching a thread whose composer draft should survive the unmount. */
export function markForStash(chatId: string): void {
  pending.add(chatId);
}

/** Call from the runtime hook's unmount cleanup. No-op unless `markForStash` was called for this id. */
export function captureIfMarked(chatId: string, draft: DraftStash): void {
  if (!pending.delete(chatId)) return;
  stash.set(chatId, draft);
}

/** Call from the runtime hook's mount effect. One-shot: consumes the stash. */
export function takeStash(chatId: string): DraftStash | undefined {
  const draft = stash.get(chatId);
  stash.delete(chatId);
  return draft;
}
