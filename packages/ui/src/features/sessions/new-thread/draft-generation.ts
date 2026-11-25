/**
 * Tells one draft in assistant-ui's reused new-thread slot from the next, so an
 * Undo offered for a draft cannot act on its successor.
 */
const generations = new Map<string, number>();
let next = 0;
let daemonEpoch = 0;

export const draftGeneration = (threadId: string): string => `${daemonEpoch}:${generations.get(threadId) ?? 0}`;

export function startDraftGeneration(threadId: string): void {
  generations.set(threadId, ++next);
}

/** A daemon switch ends every draft. */
export function endDraftGenerations(): void {
  generations.clear();
  daemonEpoch += 1;
}
