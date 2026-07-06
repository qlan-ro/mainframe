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

export function FindBar(): React.ReactElement | null {
  const isOpen = useFindInChatStore((s) => s.isOpen);
  const query = useFindInChatStore((s) => s.query);
  const matches = useFindInChatStore((s) => s.matches);
  const activeIndex = useFindInChatStore((s) => s.activeIndex);
  const close = useFindInChatStore((s) => s.close);
  const setQuery = useFindInChatStore((s) => s.setQuery);
  const setMatches = useFindInChatStore((s) => s.setMatches);
  const next = useFindInChatStore((s) => s.next);
  const prev = useFindInChatStore((s) => s.prev);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isOpen) return;
    debounceRef.current = setTimeout(() => setMatches(searchMessages(query)), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, setMatches]);

  useEffect(() => {
    if (!isOpen) return;
    return paintHighlights(matches, activeIndex);
  }, [matches, activeIndex, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        prev();
      }
    },
    [next, prev, close],
  );

  if (!isOpen) return null;

  const count = matches.length;
  const current = count > 0 ? activeIndex + 1 : 0;
  const btn = 'rounded p-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30';

  return (
    <div
      data-testid="find-bar"
      className="flex items-center gap-2 border-b border-border bg-card px-[12px] py-[6px] text-caption"
    >
      <input
        ref={inputRef}
        data-testid="thread-find-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in chat…"
        aria-label="Find in chat"
        className={cn(
          'flex-1 rounded border border-border bg-background px-2 py-1 text-body text-foreground',
          'placeholder:text-muted-foreground focus:border-ring focus:outline-none',
        )}
      />
      <span className="min-w-[3rem] shrink-0 text-center text-muted-foreground">
        {query ? `${current}/${count}` : ''}
      </span>
      <button
        data-testid="thread-find-prev"
        type="button"
        onClick={prev}
        disabled={count === 0}
        aria-label="Previous match"
        className={btn}
      >
        <ChevronUp size={14} />
      </button>
      <button
        data-testid="thread-find-next"
        type="button"
        onClick={next}
        disabled={count === 0}
        aria-label="Next match"
        className={btn}
      >
        <ChevronDown size={14} />
      </button>
      <button data-testid="thread-find-close" type="button" onClick={close} aria-label="Close find bar" className={btn}>
        <X size={14} />
      </button>
    </div>
  );
}
