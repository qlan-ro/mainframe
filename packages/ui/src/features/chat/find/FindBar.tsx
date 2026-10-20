import React, { useEffect, useRef, useCallback } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
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

function useLegacyFind() {
  const { query, isOpen, daemon, matches, activeIndex, setMatches } = useFindInChatStore();
  useEffect(() => {
    if (!isOpen || daemon) return;
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
  }, [query, isOpen, setMatches, daemon]);
  useEffect(() => {
    if (isOpen && !daemon) return paintHighlights(matches, activeIndex);
  }, [matches, activeIndex, isOpen, daemon]);
}

function useFindKeyboard() {
  const { next, prev, close } = useFindInChatStore();
  return useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)) prev();
      else next();
    },
    [next, prev, close],
  );
}

function FindNavigation({ count }: { count: number }) {
  const { prev, next, close } = useFindInChatStore();
  const buttons = [
    { id: 'prev', label: 'Previous match', action: prev, Icon: ChevronUp },
    { id: 'next', label: 'Next match', action: next, Icon: ChevronDown },
    { id: 'close', label: 'Close find bar', action: close, Icon: X },
  ];
  return buttons.map(({ id, label, action, Icon }) => (
    <button
      key={id}
      data-testid={`thread-find-${id}`}
      type="button"
      onClick={action}
      disabled={id !== 'close' && count === 0}
      aria-label={label}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
    >
      <Icon size={14} />
    </button>
  ));
}

export function FindBar(): React.ReactElement | null {
  const { isOpen, serverTotal, loading, error, truncated, query, matches, activeIndex, setQuery } =
    useFindInChatStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const handleKeyDown = useFindKeyboard();
  useLegacyFind();
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);
  if (!isOpen) return null;
  const count = serverTotal ?? matches.length;
  const current = matches.length > 0 ? activeIndex + 1 + Math.max(0, count - matches.length) : 0;
  return (
    <div
      data-testid="find-bar"
      className="flex items-center gap-2 border-b border-border bg-card px-[12px] py-[6px] text-xs"
    >
      <input
        ref={inputRef}
        data-testid="thread-find-input"
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in chat…"
        aria-label="Find in chat"
        className={cn(
          'flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground',
          'placeholder:text-muted-foreground focus:border-ring focus:outline-none',
        )}
      />
      <span className="min-w-[3rem] shrink-0 text-center text-muted-foreground">
        {query ? `${current}/${count}` : ''}
      </span>
      {loading && <span role="status">Searching...</span>}
      {truncated && <span data-testid="thread-find-limit">Stepping through the newest 2,000 matches</span>}
      {error && <span role="alert">{error}</span>}
      <FindNavigation count={count} />
    </div>
  );
}
