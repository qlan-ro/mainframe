/**
 * The store-scope thread list, held identity-stable while its entries are.
 *
 * aui rebuilds `s.threads.threadItems` as a fresh array whenever the MAIN
 * thread's state changes — every streamed chunk — although each entry keeps
 * its identity (item states are shallow-memoized, and the chats adapter keeps
 * an unchanged chat's `custom`). A raw `s.threads.threadItems` subscription
 * therefore re-renders its component per token. This hands back the previous
 * array until an entry is added, removed, reordered or replaced; subscribe
 * through it rather than selecting the raw array.
 */
import { useRef } from 'react';
import { useAuiState, type AssistantState } from '@assistant-ui/react';

export type ThreadItems = AssistantState['threads']['threadItems'];

function sameEntries(a: ThreadItems, b: ThreadItems): boolean {
  return a === b || (a.length === b.length && a.every((entry, index) => entry === b[index]));
}

export function useThreadItems(): ThreadItems {
  const held = useRef<ThreadItems | null>(null);
  return useAuiState((s) => {
    const next = s.threads.threadItems;
    const prev = held.current;
    if (prev != null && sameEntries(prev, next)) return prev;
    held.current = next;
    return next;
  });
}
