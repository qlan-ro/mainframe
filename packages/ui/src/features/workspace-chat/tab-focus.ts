/**
 * Moves the keyboard to a chat or agent tab as it opens, for an opener that
 * goes away as it does: the floating session panel closes over the row that was
 * pressed, and a docked one can make way for the workspace. An opener that
 * stays on screen keeps its focus.
 */
import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';

/** The tab asked for, until its body takes the focus. */
const useTabFocus = create<{ tabId: string | null }>(() => ({ tabId: null }));

export function focusTabBody(tabId: string): void {
  useTabFocus.setState({ tabId });
}

/** What scrolls, so the arrow keys work at once; the whole body while it has nothing to scroll. */
const SCROLLER = '[data-conversation-scroller], [data-mf-chat-thread]';

export function useTabBodyFocus(ref: RefObject<HTMLElement | null>, tabId: string, active: boolean): void {
  const asked = useTabFocus((s) => s.tabId === tabId);
  useEffect(() => {
    const body = ref.current;
    if (!asked || !active || body == null) return;
    useTabFocus.setState({ tabId: null });
    // A composer that took it on mounting keeps it.
    if (body.contains(document.activeElement)) return;
    (body.querySelector<HTMLElement>(SCROLLER) ?? body).focus({ preventScroll: true });
  }, [ref, asked, active]);
}
