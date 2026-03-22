import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, FileText, X } from 'lucide-react';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { useProjectsStore } from '../store';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { searchContent } from '../lib/api';

interface FindInPathModalProps {
  scopePath: string;
  scopeType: 'file' | 'directory';
  onClose: () => void;
}

const RESULT_LIMIT = 200;

export function FindInPathModal({ scopePath, scopeType, onClose }: FindInPathModalProps): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchContentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const runSearch = useCallback(
    (q: string, ignored: boolean) => {
      if (!activeProjectId || q.length < 2) {
        setResults([]);
        setSearched(false);
        setLoading(false);
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setSearched(false);

      searchContent(activeProjectId, q, scopePath, ignored, activeChatId ?? undefined, controller.signal)
        .then((res) => {
          setResults(res);
          setSelectedIndex(0);
          setSearched(true);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          setResults([]);
          setSearched(true);
          setLoading(false);
        });
    },
    [activeProjectId, activeChatId, scopePath],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      runSearch(query, includeIgnored);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, includeIgnored, runSearch]);

  // Group results by file
  const grouped = new Map<string, SearchContentResult[]>();
  for (const r of results) {
    const existing = grouped.get(r.file);
    if (existing) {
      existing.push(r);
    } else {
      grouped.set(r.file, [r]);
    }
  }

  const openResult = useCallback(
    (result: SearchContentResult) => {
      useTabsStore.getState().openEditorTab(result.file, undefined, result.line);
      onClose();
    },
    [onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = results[selectedIndex];
      if (result) openResult(result);
    }
  };

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const title = scopeType === 'file' ? 'Find in File' : 'Find in Path';
  const limitReached = results.length >= RESULT_LIMIT;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-center" style={{ paddingTop: '15%' }} onClick={onClose}>
      <div
        className="w-[560px] max-w-[90%] h-fit max-h-[60vh] bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-mf-border shrink-0">
          <div>
            <h2 className="text-mf-body font-semibold text-mf-text-primary">{title}</h2>
            <p className="text-mf-small text-mf-text-secondary truncate max-w-[420px]" title={scopePath}>
              {scopePath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-mf-text-secondary hover:text-mf-text-primary transition-colors mt-0.5"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 py-2 border-b border-mf-border shrink-0">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-mf-text-secondary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              className="flex-1 bg-transparent text-mf-body text-mf-text-primary placeholder:text-mf-text-secondary outline-none"
            />
          </div>
          {scopeType === 'directory' && (
            <label className="flex items-center gap-2 mt-2 text-mf-status text-mf-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeIgnored}
                onChange={(e) => setIncludeIgnored(e.target.checked)}
                className="accent-mf-accent"
              />
              Include ignored files
            </label>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="px-4 py-6 text-center text-mf-body text-mf-text-secondary">Searching...</div>
          )}
          {!loading && searched && results.length === 0 && (
            <div className="px-4 py-6 text-center text-mf-body text-mf-text-secondary">No results found</div>
          )}
          {results.length > 0 && (
            <>
              {Array.from(grouped.entries()).map(([file, hits]) => (
                <div key={file}>
                  {/* File group header */}
                  <div className="flex items-center gap-1.5 px-4 py-1.5 text-mf-status text-mf-text-secondary font-medium sticky top-0 bg-mf-panel-bg border-b border-mf-border">
                    <FileText size={13} className="shrink-0" />
                    <span className="truncate font-mono">{file}</span>
                    <span className="ml-auto shrink-0 text-mf-small opacity-60">{hits.length}</span>
                  </div>
                  {/* Hits */}
                  {hits.map((hit) => {
                    const idx = flatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={`${hit.file}:${hit.line}:${hit.column}`}
                        ref={isSelected ? selectedItemRef : null}
                        onClick={() => openResult(hit)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-baseline gap-2 px-4 py-1 text-left font-mono text-mf-status ${
                          isSelected
                            ? 'bg-mf-hover text-mf-text-primary'
                            : 'text-mf-text-secondary hover:bg-mf-hover/50'
                        }`}
                      >
                        <span className="w-8 text-right text-mf-accent opacity-60 shrink-0">{hit.line}</span>
                        <span className="truncate">{hit.text}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {searched && (
          <div className="px-4 py-2 border-t border-mf-border shrink-0 text-mf-small text-mf-text-secondary">
            {results.length} result{results.length !== 1 ? 's' : ''}
            {limitReached && <span className="ml-1 opacity-70">(limit reached)</span>}
          </div>
        )}
      </div>
    </div>
  );
}
