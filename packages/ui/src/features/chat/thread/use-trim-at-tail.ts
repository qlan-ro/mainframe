import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Cuts the loaded window back to its newest page when the reader comes back to the tail: they
 * scrolled down to the bottom (pinned again), or left a window around a jump target while pinned
 * (the end of the window, a send, the scroll-to-bottom button). They are at the bottom then, so rows
 * leaving above them need no anchoring. Not while in a window: that one is a snapshot, and the live
 * window was cut when it opened.
 */
export function useTrimAtTail(
  owner: { isPinned: () => boolean; subscribePinned: (listener: () => void) => () => void },
  trim: (() => void) | undefined,
  away: boolean,
): void {
  const pinned = useSyncExternalStore(owner.subscribePinned, owner.isPinned, owner.isPinned);
  const was = useRef({ pinned, away });
  useEffect(() => {
    const before = was.current;
    was.current = { pinned, away };
    const pinnedAgain = pinned && !before.pinned;
    const leftWindow = before.away && !away && pinned;
    if ((pinnedAgain || leftWindow) && !away) trim?.();
  }, [pinned, away, trim]);
}
