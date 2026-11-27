import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Cuts the loaded window back to its newest page when the reader comes back to the tail. They are at
 * the bottom then, so rows leaving above them need no anchoring. Not in a window around a jump
 * target: that one is a snapshot, and the live window was cut when it opened.
 */
export function useTrimAtTail(
  owner: { isPinned: () => boolean; subscribePinned: (listener: () => void) => () => void },
  trim: (() => void) | undefined,
  away: boolean,
): void {
  const pinned = useSyncExternalStore(owner.subscribePinned, owner.isPinned, owner.isPinned);
  const was = useRef(pinned);
  useEffect(() => {
    const returned = pinned && !was.current;
    was.current = pinned;
    if (returned && !away) trim?.();
  }, [pinned, away, trim]);
}
