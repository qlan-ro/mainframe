/**
 * The in-page find of the virtualized list: it reads the rows the DOM holds, so it only sees what
 * is loaded and mounted. Daemon search (`DaemonFind.tsx`) replaces it everywhere it is available,
 * and the plain transcript list never uses it: that list has no virtualizer to keep rows out of the
 * DOM, and a daemon without `historySearch` shows no results there rather than a partial count.
 * Delete this file and `search-messages.ts` together with the old list.
 */
import { useEffect } from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useFindInChatStore } from './find-in-chat-store';
import { searchMessages, rangeFromOffsets } from './search-messages';

const DEBOUNCE_MS = 80;

/** Paint matches via the CSS Custom Highlight API and scroll the active one into view. */
function paintHighlights(matches: ReturnType<typeof searchMessages>, activeIndex: number): () => void {
  const noop = () => {};
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return noop;
  const reg = CSS.highlights;

  if (matches.length === 0) {
    reg.delete('mf-find-match');
    reg.delete('mf-find-active');
    return noop;
  }

  const threadEl = document.querySelector('[data-mf-chat-thread]');
  if (!threadEl) return noop;

  const allRanges: Range[] = [];
  let activeRange: Range | null = null;
  const partCache = new Map<string, NodeListOf<Element>>();

  matches.forEach((mm, i) => {
    let textEls = partCache.get(mm.messageId);
    if (!textEls) {
      const msgEl = threadEl.querySelector(`[data-message-id="${mm.messageId}"]`);
      if (!msgEl) return;
      textEls = msgEl.querySelectorAll('[data-text-part]');
      partCache.set(mm.messageId, textEls);
    }
    const partEl = textEls[mm.partIndex];
    if (!partEl) return;
    const range = rangeFromOffsets(partEl, mm.charStart, mm.charEnd);
    if (!range) return;
    if (i === activeIndex) activeRange = range;
    else allRanges.push(range);
  });

  reg.set('mf-find-match', new Highlight(...allRanges));
  reg.set('mf-find-active', activeRange ? new Highlight(activeRange) : new Highlight());

  if (activeRange) {
    const rect = (activeRange as Range).getBoundingClientRect();
    const viewport = threadEl as HTMLElement;
    if (rect.top < 0 || rect.bottom > viewport.clientHeight) {
      viewport.scrollTo({ top: viewport.scrollTop + rect.top - viewport.clientHeight / 2, behavior: 'smooth' });
    }
  }

  return () => {
    reg.delete('mf-find-match');
    reg.delete('mf-find-active');
  };
}

export function useLegacyFind() {
  const plain = useUiPrefs((s) => s.plainTranscript);
  const { query, isOpen, daemon, matches, activeIndex, setMatches } = useFindInChatStore();
  useEffect(() => {
    if (!isOpen || daemon || plain) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setMatches(searchMessages(query));
      }, DEBOUNCE_MS);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    const viewport = document.querySelector('[data-mf-chat-thread]');
    if (viewport) observer.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [query, isOpen, setMatches, daemon, plain]);
  useEffect(() => {
    if (isOpen && !daemon && !plain) return paintHighlights(matches, activeIndex);
  }, [matches, activeIndex, isOpen, daemon, plain]);
}
