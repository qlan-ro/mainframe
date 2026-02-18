import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { File, Bot, FolderOpen, Globe } from 'lucide-react';
import { useComposerRuntime } from '@assistant-ui/react';
import { focusComposerInput } from '../../lib/focus';
import { useSkillsStore, useProjectsStore, useChatsStore } from '../../store';
import { searchFiles, addMention } from '../../lib/api';
import { cn } from '../../lib/utils';
import type { AgentConfig } from '@mainframe/types';

type MentionItem =
  | { type: 'agent'; name: string; description: string; scope: string }
  | { type: 'file'; name: string; path: string };

const SCOPE_ICON: Record<string, React.ReactNode> = {
  project: <FolderOpen size={12} />,
  global: <Globe size={12} />,
};

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

const SEARCH_DEBOUNCE_MS = 150;

function useComposerText(): string {
  const composerRuntime = useComposerRuntime();
  const subscribe = useCallback(
    (cb: () => void) => {
      try {
        return composerRuntime.subscribe(cb);
      } catch {
        return () => {};
      }
    },
    [composerRuntime],
  );
  const getSnapshot = useCallback(() => {
    try {
      return composerRuntime.getState()?.text ?? '';
    } catch {
      return '';
    }
  }, [composerRuntime]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function AtMentionMenu(): React.ReactElement | null {
  const { agents } = useSkillsStore();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const text = useComposerText();
  const composerRuntime = useComposerRuntime();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [fileResults, setFileResults] = useState<{ name: string; path: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Detect @query: match @ preceded by whitespace or at start
  const atMatch = text.match(/(?:^|\s)@(\S*)$/);
  const isActive = atMatch !== null;
  const query = atMatch?.[1] ?? '';

  // Server-side file search with debounce
  useEffect(() => {
    if (!isActive || query.length < 2 || !activeProjectId) {
      setFileResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchFiles(activeProjectId, query, 30, activeChatId ?? undefined)
        .then((results) =>
          setFileResults(results.filter((r) => r.type === 'file').map((r) => ({ name: r.name, path: r.path }))),
        )
        .catch((err) => {
          console.warn('[at-mention] file search failed:', err);
          setFileResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [isActive, query, activeProjectId, activeChatId]);

  // Build filtered results — agents client-side, files from server
  const filtered: MentionItem[] = [];
  if (isActive) {
    for (const agent of agents) {
      if (!query || fuzzyMatch(query, agent.name)) {
        filtered.push({ type: 'agent', name: agent.name, description: agent.description, scope: agent.scope });
      }
    }
    for (const file of fileResults) {
      filtered.push({ type: 'file', name: file.name, path: file.path });
    }
  }

  // Cap total
  const visible = filtered.slice(0, 50);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const selectItem = useCallback(
    (item: MentionItem) => {
      try {
        const mention = item.type === 'agent' ? `@${item.name}` : `@${item.path}`;
        // Replace the @query portion with the full mention
        const currentText = composerRuntime.getState()?.text ?? '';
        const matchInText = currentText.match(/(?:^|\s)@(\S*)$/);
        if (matchInText) {
          const start = matchInText.index! + (matchInText[0].startsWith(' ') ? 1 : 0);
          const newText = currentText.slice(0, start) + mention + ' ';
          composerRuntime.setText(newText);
        } else {
          composerRuntime.setText(currentText + mention + ' ');
        }
        focusComposerInput();

        if (activeChatId) {
          addMention(activeChatId, {
            kind: item.type === 'agent' ? 'agent' : 'file',
            name: item.name,
            path: item.type === 'file' ? item.path : undefined,
          }).catch((err) => console.warn('[mention] add mention failed:', err));
        }
      } catch (err) {
        console.warn('[AtMentionMenu] selection failed:', err);
      }
    },
    [composerRuntime, activeChatId],
  );

  useEffect(() => {
    if (!isActive || visible.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = visible[selectedIndex];
        if (item) selectItem(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Remove the @ trigger
        try {
          const currentText = composerRuntime.getState()?.text ?? '';
          const cleaned = currentText.replace(/(?:^|\s)@\S*$/, '').trimEnd();
          composerRuntime.setText(cleaned);
        } catch {}
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, visible, selectedIndex, selectItem, composerRuntime]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!menuRef.current) return;
    const item = menuRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isActive || visible.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[240px] overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-lg z-50"
    >
      {visible.map((item, index) => (
        <button
          key={item.type === 'agent' ? `a:${item.name}` : `f:${item.path}`}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            selectItem(item);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={cn(
            'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors',
            index === selectedIndex ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
          )}
        >
          {item.type === 'agent' ? (
            <Bot size={14} className="text-mf-accent mt-0.5 shrink-0" />
          ) : (
            <File size={14} className="text-mf-text-secondary mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="text-mf-body text-mf-text-primary font-medium font-mono truncate"
                title={item.type === 'agent' ? item.name : item.path}
              >
                {item.type === 'agent' ? item.name : item.path}
              </span>
              <span className="flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-mf-hover text-mf-status text-mf-text-secondary shrink-0">
                {item.type === 'agent' ? (
                  <>
                    {SCOPE_ICON[(item as MentionItem & { type: 'agent' }).scope]}
                    <span>agent</span>
                  </>
                ) : (
                  <span>file</span>
                )}
              </span>
            </div>
            {item.type === 'agent' && item.description && (
              <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={item.description}>
                {item.description}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
