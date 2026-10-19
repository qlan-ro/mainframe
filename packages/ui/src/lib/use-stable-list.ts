import { useRef } from 'react';

/**
 * Hands back the previously returned array while `next` holds the same
 * elements in the same order (`same`, Object.is by default). A projection
 * re-derived from a fresh source array — a thread-list reload — then keeps
 * its identity when nothing in it moved, so the memos and context values
 * built on it stay put.
 *
 * The ref is written during render on purpose (as in `useChatExtrasState`):
 * whichever array is held, it is element-for-element interchangeable with the
 * latest input, so a discarded concurrent render cannot leave a wrong value.
 */
export function useStableList<T>(next: T[], same: (a: T, b: T) => boolean = Object.is): T[] {
  const held = useRef(next);
  const prev = held.current;
  if (prev !== next && (prev.length !== next.length || prev.some((value, index) => !same(value, next[index]!)))) {
    held.current = next;
  }
  return held.current;
}
