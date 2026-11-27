import { useEffect, type RefObject } from 'react';
import { SCROLLBAR_DRAG_EVENT } from '@/lib/overlay-scrollbars/thumb';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTranscriptScroll } from '../../thread/transcript-scroll-context';
import { useSubagentHistoryStore } from './subagent-history-store';

const VIEWPORT = '[data-conversation-scroller], [data-mf-chat-thread]';

const KEYS = { older: ['ArrowUp', 'PageUp', 'Home', ' '], newer: ['ArrowDown', 'PageDown', 'End', ' '] };
const FIELDS = 'input, textarea, [contenteditable="true"]';

/**
 * Loads a page when the reader scrolls towards an edge of a sub-agent's held steps: up within a
 * viewport of the top boundary loads an older page, down within a viewport of the bottom boundary
 * a newer one (pages below are dropped once the window is full, `subagent-window.ts`).
 *
 * Only the reader's own input counts (wheel, keys, touch, a scrollbar drag): it arms a load, and a
 * scroll while armed can fire it. A scroll the browser's anchoring or the owner makes when a page
 * lands is not input, so it cannot chain one page into the next. Re-armed for every new page.
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
    let armed = false;
    const check = () => {
      if (!armed) return;
      const box = viewport.getBoundingClientRect();
      const top = node.getBoundingClientRect().top;
      const distance = older ? top - box.top : top - box.bottom;
      if (Math.abs(distance) > viewport.clientHeight) return;
      armed = false;
      load();
    };
    const arm = () => {
      armed = true;
      check();
    };
    const wheel = (event: WheelEvent) => {
      if (older ? event.deltaY < 0 : event.deltaY > 0) arm();
    };
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element).closest(FIELDS)) return;
      if (KEYS[side].includes(event.key) && (event.key !== ' ' || event.shiftKey === older)) arm();
    };
    let lastY: number | null = null;
    const touch = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      // A finger moving down scrolls the content up.
      if (lastY !== null && y !== lastY && y > lastY === older) arm();
      lastY = y;
    };
    const events: Array<[string, EventListener]> = [
      ['wheel', wheel as EventListener],
      ['keydown', key as EventListener],
      ['touchmove', touch as EventListener],
      [SCROLLBAR_DRAG_EVENT, arm],
      ['scroll', check],
    ];
    for (const [name, listener] of events) viewport.addEventListener(name, listener, { passive: true });
    return () => {
      for (const [name, listener] of events) viewport.removeEventListener(name, listener);
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
