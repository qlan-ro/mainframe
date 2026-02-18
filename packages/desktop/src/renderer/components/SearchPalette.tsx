import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, MessageSquare, FileText, Folder } from 'lucide-react';
import { useSearchStore, useChatsStore, useProjectsStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { daemonClient } from '../lib/client';
import { searchFiles } from '../lib/api';

interface FileResult {
  name: string;
  path: string;
  type: string;
}

interface SearchItem {
  kind: 'session' | 'file';
  id: string;
  label: string;
  detail?: string;
}

export function SearchPalette(): React.ReactElement | null {
  const { isOpen, query, selectedIndex, close, setQuery, setSelectedIndex } = useSearchStore();
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Global ⌘F / Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          useSearchStore.getState().open();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // Debounced file search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isOpen || query.length < 2 || !activeProjectId) {
      setFileResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const q = queryRef.current;
      searchFiles(activeProjectId, q, 50, activeChatId ?? undefined)
        .then((results) => {
          if (queryRef.current === q) setFileResults(results);
        })
        .catch((err) => console.warn('[search] file search failed:', err));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, activeProjectId]);

  // Build unified items list
  const lowerQ = query.toLowerCase();
  const sessionItems: SearchItem[] = chats
    .filter((c) => c.status !== 'archived' && (c.title || 'New Chat').toLowerCase().includes(lowerQ))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, query ? 10 : 5)
    .map((c) => ({ kind: 'session', id: c.id, label: c.title || 'New Chat', detail: c.adapterId }));

  const fileItems: SearchItem[] = fileResults.map((f) => ({
    kind: 'file',
    id: f.path,
    label: f.name,
    detail: f.path,
  }));

  const items = [...sessionItems, ...fileItems];

  // Actions
  const handleSelect = useCallback(
    (item: SearchItem) => {
      if (item.kind === 'session') {
        useChatsStore.getState().setActiveChat(item.id);
        useTabsStore.getState().openChatTab(item.id, item.label);
        daemonClient.resumeChat(item.id);
      } else {
        useTabsStore.getState().openEditorTab(item.id);
      }
      close();
    },
    [close],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
      } else if (e.key === 'Enter' && items[selectedIndex]) {
        e.preventDefault();
        handleSelect(items[selectedIndex]);
      }
    },
    [selectedIndex, items, setSelectedIndex, handleSelect, close],
  );

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const hasSessionSection = sessionItems.length > 0;
  const hasFileSection = fileItems.length > 0;

  // Map flat index → position accounting for section headers
  let flatIdx = 0;
  const renderItems: React.ReactNode[] = [];

  if (hasSessionSection) {
    renderItems.push(
      <div
        key="h-sessions"
        className="px-3 py-1.5 text-mf-status text-mf-text-secondary font-medium uppercase tracking-wider"
      >
        Sessions
      </div>,
    );
    for (const item of sessionItems) {
      const idx = flatIdx++;
      renderItems.push(
        <button
          type="button"
          key={`s-${item.id}`}
          className={`w-[calc(100%-0.5rem)] text-left bg-transparent border-0 flex items-center gap-2 px-3 py-2 cursor-pointer rounded-mf-input mx-1 ${idx === selectedIndex ? 'bg-mf-hover text-mf-text-primary' : 'text-mf-text-secondary hover:bg-mf-hover/50'}`}
          onMouseEnter={() => setSelectedIndex(idx)}
          onClick={() => handleSelect(item)}
        >
          <MessageSquare size={14} className="shrink-0 opacity-60" />
          <span className="truncate text-mf-body" title={item.label}>
            {item.label}
          </span>
          {item.detail && (
            <span className="ml-auto text-mf-status opacity-50 shrink-0" title={item.detail}>
              {item.detail}
            </span>
          )}
        </button>,
      );
    }
  }

  if (hasFileSection) {
    renderItems.push(
      <div
        key="h-files"
        className="px-3 py-1.5 text-mf-status text-mf-text-secondary font-medium uppercase tracking-wider mt-1"
      >
        Files
      </div>,
    );
    for (const item of fileItems) {
      const idx = flatIdx++;
      const Icon = item.detail?.includes('/') ? FileText : Folder;
      renderItems.push(
        <button
          type="button"
          key={`f-${item.id}`}
          className={`w-[calc(100%-0.5rem)] text-left bg-transparent border-0 flex items-center gap-2 px-3 py-2 cursor-pointer rounded-mf-input mx-1 ${idx === selectedIndex ? 'bg-mf-hover text-mf-text-primary' : 'text-mf-text-secondary hover:bg-mf-hover/50'}`}
          onMouseEnter={() => setSelectedIndex(idx)}
          onClick={() => handleSelect(item)}
        >
          <Icon size={14} className="shrink-0 opacity-60" />
          <span className="truncate text-mf-body" title={item.label}>
            {item.label}
          </span>
          {item.detail && item.detail !== item.label && (
            <span className="ml-auto text-mf-status opacity-50 truncate max-w-[200px] shrink-0" title={item.detail}>
              {item.detail}
            </span>
          )}
        </button>,
      );
    }
  }

  if (!hasSessionSection && !hasFileSection && query.length >= 2) {
    renderItems.push(
      <div key="empty" className="px-3 py-6 text-center text-mf-text-secondary text-mf-label">
        No results found
      </div>,
    );
  }

  if (!query) {
    if (!hasSessionSection) {
      renderItems.push(
        <div key="hint" className="px-3 py-6 text-center text-mf-text-secondary text-mf-label">
          Type to search sessions and files...
        </div>,
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center" style={{ paddingTop: '20%' }} onClick={close}>
      <div
        className="w-[480px] max-w-[90%] h-fit max-h-[60vh] bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-mf-border/50">
          <Search size={14} className="text-mf-text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions and files..."
            className="flex-1 bg-transparent text-mf-body text-mf-text-primary placeholder:text-mf-text-secondary/50 outline-none"
          />
          <kbd className="text-mf-status text-mf-text-secondary border border-mf-border/50 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto py-1">
          {renderItems}
        </div>
      </div>
    </div>
  );
}
