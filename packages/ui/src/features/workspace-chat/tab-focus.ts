import { useLayoutEffect, type RefObject } from 'react';
import { create } from 'zustand';
import { useLayoutStore } from '@/store/layout';

interface FocusRequest {
  tabId: string;
  cancel: () => void;
}

const useTabFocus = create<{ request: FocusRequest | null }>(() => ({ request: null }));

export function clearTabFocus(): void {
  useTabFocus.getState().request?.cancel();
}

export function focusTabBody(tabId: string, opener: Element | null): void {
  clearTabFocus();
  const cancel = () => {
    clearTimeout(timeout);
    observer.disconnect();
    unsubscribe();
    useTabFocus.setState({ request: null });
  };
  const observer = new MutationObserver(() => {
    if (opener && !opener.isConnected) cancel();
  });
  if (opener && opener !== document.body) observer.observe(document.body, { childList: true, subtree: true });
  const timeout = setTimeout(cancel, 250);
  const unsubscribe = useLayoutStore.subscribe((state, previous) => {
    const active = state.run?.panes.find((pane) => pane.active === tabId);
    const otherActivated = state.run?.panes.some(
      (pane) =>
        pane.active !== tabId && pane.active !== previous.run?.panes.find((before) => before.id === pane.id)?.active,
    );
    if (!active || otherActivated || state.activeSessionId !== previous.activeSessionId) cancel();
  });
  useTabFocus.setState({ request: { tabId, cancel } });
}

/** What scrolls, so the arrow keys work at once; the whole body while it has nothing to scroll. */
const SCROLLER = '[data-conversation-scroller], [data-mf-chat-thread]';

export function useTabBodyFocus(ref: RefObject<HTMLElement | null>, tabId: string, active: boolean): void {
  const request = useTabFocus((s) => (s.request?.tabId === tabId ? s.request : null));
  useLayoutEffect(() => {
    const body = ref.current;
    if (!request || !active || body == null || useTabFocus.getState().request !== request) return;
    request.cancel();
    // A composer that took it on mounting keeps it.
    if (body.contains(document.activeElement)) return;
    (body.querySelector<HTMLElement>(SCROLLER) ?? body).focus({ preventScroll: true });
  }, [ref, request, active]);
}
