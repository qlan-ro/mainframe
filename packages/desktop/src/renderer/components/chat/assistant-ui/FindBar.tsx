import React, { useEffect, useRef, useCallback } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { useFindInChatStore } from '../../../store/find-in-chat';
import { useChatsStore } from '../../../store/chats';

/**
 * Search the visible chat messages for text query matches.
 * Returns an ordered list of { messageId, partIndex, charStart, charEnd }.
 *
 * v1 scope: user message text and assistant text parts only.
 */
function searchMessages(query: string, chatId: string | null): import('../../../store/find-in-chat').FindMatch[] {
  if (!query || !chatId) return [];

  const lower = query.toLowerCase();
  const matches: import('../../../store/find-in-chat').FindMatch[] = [];

  // Walk through all rendered text nodes inside [data-mf-chat-thread]
  const threadEl = document.querySelector('[data-mf-chat-thread]');
  if (!threadEl) return [];

  // Find all text-bearing elements with a message id
  const messageEls = threadEl.querySelectorAll('[data-message-id]');
  messageEls.forEach((msgEl) => {
    const messageId = msgEl.getAttribute('data-message-id') ?? '';
    const textEls = msgEl.querySelectorAll('[data-text-part]');
    textEls.forEach((textEl, partIndex) => {
      const text = textEl.textContent ?? '';
      const textLower = text.toLowerCase();
      let idx = 0;
      while (idx < textLower.length) {
        const found = textLower.indexOf(lower, idx);
        if (found === -1) break;
        matches.push({ messageId, partIndex, charStart: found, charEnd: found + query.length });
        idx = found + 1;
      }
    });
  });

  return matches;
}

export function FindBar(): React.ReactElement | null {
  const { isOpen, query, matches, activeIndex, close, setQuery, setMatches, next, prev } = useFindInChatStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when bar opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isOpen) return;
    debounceRef.current = setTimeout(() => {
      const found = searchMessages(query, activeChatId);
      setMatches(found);
    }, 80);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, activeChatId, setMatches]);

  // Scroll active match into view
  useEffect(() => {
    if (!isOpen || matches.length === 0) return;
    const match = matches[activeIndex];
    if (!match) return;
    const threadEl = document.querySelector('[data-mf-chat-thread]');
    if (!threadEl) return;
    const msgEl = threadEl.querySelector(`[data-message-id="${match.messageId}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIndex, matches, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          prev();
        } else {
          next();
        }
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

  return (
    <div
      data-testid="find-bar"
      className="flex items-center gap-2 px-3 py-1.5 bg-mf-sidebar border-b border-mf-border text-mf-small"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in chat…"
        className="flex-1 bg-mf-input-bg border border-mf-border rounded px-2 py-1 text-mf-text-primary placeholder:text-mf-text-secondary/50 focus:outline-none focus:border-mf-accent text-mf-body"
        aria-label="Find in chat"
      />
      <span className="text-mf-text-secondary min-w-[3rem] text-center shrink-0">
        {query ? `${current}/${count}` : ''}
      </span>
      <button
        onClick={prev}
        disabled={count === 0}
        className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary disabled:opacity-30"
        aria-label="Previous match"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={next}
        disabled={count === 0}
        className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary disabled:opacity-30"
        aria-label="Next match"
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={close}
        className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary"
        aria-label="Close find bar"
      >
        <X size={14} />
      </button>
    </div>
  );
}
