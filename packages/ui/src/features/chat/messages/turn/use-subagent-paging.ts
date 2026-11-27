import { useEffect, type RefObject } from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTranscriptScroll } from '../../thread/transcript-scroll-context';
import { useSubagentHistoryStore } from './subagent-history-store';

const VIEWPORT = '[data-conversation-scroller], [data-mf-chat-thread]';

/**
 * Loads a page when the reader scrolls towards an edge of a sub-agent's held steps: up within a
 * viewport of the top boundary loads an older page, down within a viewport of the bottom boundary
 * a newer one (pages below are dropped once the window is full, `subagent-window.ts`).
 */
export function useEdgePaging(
  boundary: RefObject<HTMLElement | null>,
  side: 'older' | 'newer',
  enabled: boolean,
  load: () => void,
) {
  useEffect(() => {
    const node = boundary.current;
    const viewport = node?.closest<HTMLElement>(VIEWPORT);
    if (!viewport || !node || !enabled) return;
    const older = side === 'older';
    const check = () => {
      const box = viewport.getBoundingClientRect();
      const top = node.getBoundingClientRect().top;
      const distance = older ? top - box.top : top - box.bottom;
      if (Math.abs(distance) <= viewport.clientHeight) load();
    };
    let scrollTop = viewport.scrollTop;
    const scroll = () => {
      const moved = viewport.scrollTop - scrollTop;
      scrollTop = viewport.scrollTop;
      if (older ? moved < 0 : moved > 0) check();
    };
    const wheel = (event: WheelEvent) => {
      if (older ? event.deltaY < 0 : event.deltaY > 0) check();
    };
    viewport.addEventListener('wheel', wheel, { passive: true });
    viewport.addEventListener('scroll', scroll, { passive: true });
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('scroll', scroll);
    };
  }, [boundary, side, enabled, load]);
}

/**
 * On the plain list, tells the scroll owner of the view showing these steps that rows are about to
 * change around the reader, so it can hold their place (`use-scroll-owner.ts`, `beforePrepend`). A
 * store listener runs inside the store update, before React commits the new rows. The first page
 * moves nothing the reader was reading, so it is not announced.
 */
export function useAnnounceSubagentPages(key: string) {
  const scroll = useTranscriptScroll();
  const plain = useUiPrefs((s) => s.plainTranscript);
  const beforePrepend = plain && scroll?.owned ? scroll.beforePrepend : undefined;
  useEffect(() => {
    if (!beforePrepend) return;
    return useSubagentHistoryStore.subscribe((state, previous) => {
      const next = state.entries.get(key);
      const was = previous.entries.get(key);
      if (next && was && next.messages !== was.messages && was.messages.length > 0) beforePrepend();
    });
  }, [key, beforePrepend]);
}
