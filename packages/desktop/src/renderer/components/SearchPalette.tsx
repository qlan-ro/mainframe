import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { Search, MessageSquare, FileText, Folder } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:search');
import { useSearchStore, useChatsStore } from '../store';
import { useActiveProjectId } from '../hooks/useActiveProjectId.js';
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
  const activeProjectId = useActiveProjectId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [size, setSize] = useState({ width: 960, height: 480 });
  const resizing = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  // Focus input when opening.
  // Direct call (no rAF) — rAF adds an extra frame of delay that causes
  // keyboard.type() in tests (and fast typists) to miss the first characters.
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Global ⌘F / Ctrl+F and ⌘O / Ctrl+O
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (key === 'f' || key === 'o')) {
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
        .catch((err) => log.warn('file search failed', { err: String(err) }));
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

  // Clamp size to viewport
  useLayoutEffect(() => {
    if (!isOpen) return;
    setSize((s) => ({
      width: Math.min(s.width, window.innerWidth - 32),
      height: Math.min(s.height, window.innerHeight - 64),
    }));
  }, [isOpen]);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizing.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [size],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const w = Math.max(400, resizing.current.startW + (e.clientX - resizing.current.startX));
    const h = Math.max(200, resizing.current.startH + (e.clientY - resizing.current.startY));
    setSize({ width: w, height: h });
  }, []);

  const onResizeEnd = useCallback(() => {
    resizing.current = null;
  }, []);

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
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-mf-body" tabIndex={0}>
                {item.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
          {item.detail && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-auto text-mf-status opacity-50 shrink-0" tabIndex={0}>
                  {item.detail}
                </span>
              </TooltipTrigger>
              <TooltipContent>{item.detail}</TooltipContent>
            </Tooltip>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-mf-body" tabIndex={0}>
                {item.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
          {item.detail && item.detail !== item.label && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-auto text-mf-status opacity-50 truncate max-w-[200px] shrink-0" tabIndex={0}>
                  {item.detail}
                </span>
              </TooltipTrigger>
              <TooltipContent>{item.detail}</TooltipContent>
            </Tooltip>
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[min(20vh,120px)]" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-2xl flex flex-col overflow-hidden"
        style={{ width: size.width, maxHeight: size.height }}
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
        <div ref={listRef} className="overflow-y-auto py-1 flex-1">
          {renderItems}
        </div>

        {/* Resize handle */}
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onLostPointerCapture={onResizeEnd}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5 touch-none"
          aria-hidden="true"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="text-mf-text-secondary opacity-40">
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
            <line x1="9" y1="4" x2="4" y2="9" stroke="currentColor" strokeWidth="1" />
            <line x1="9" y1="7" x2="7" y2="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      </div>
    </div>
  );
}
