import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { File, Bot, Zap, FolderOpen, Globe, Puzzle, Wrench } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:chat');
import { useComposerRuntime } from '@assistant-ui/react';
import { focusComposerInput } from '../../lib/focus';
import { useSkillsStore, useProjectsStore, useChatsStore } from '../../store';
import { searchFiles, addMention } from '../../lib/api';
import { cn } from '../../lib/utils';
import type { Skill, CustomCommand } from '@mainframe/types';

type FilterMode = 'all' | 'agents-files' | 'skills';

type PickerItem =
  | { type: 'agent'; name: string; description: string; scope: string }
  | { type: 'file'; name: string; path: string }
  | { type: 'skill'; skill: Skill }
  | { type: 'command'; command: CustomCommand };

const SCOPE_ICON: Record<string, React.ReactNode> = {
  project: <FolderOpen size={12} />,
  global: <Globe size={12} />,
  plugin: <Puzzle size={12} />,
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

export interface ContextPickerMenuProps {
  forceOpen: boolean;
  onClose: () => void;
}

export function ContextPickerMenu({ forceOpen, onClose }: ContextPickerMenuProps): React.ReactElement | null {
  const { agents, skills, commands } = useSkillsStore();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const text = useComposerText();
  const composerRuntime = useComposerRuntime();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [fileResults, setFileResults] = useState<{ name: string; path: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Track whether user typed while picker was force-open, to auto-close on full delete
  const pickerHadQueryRef = useRef(false);

  const atMatch = text.match(/(?:^|\s)@(\S*)$/);
  const slashMatch = !atMatch && text.match(/^\/(\S*)$/);

  let filterMode: FilterMode = 'all';
  if (atMatch) filterMode = 'agents-files';
  else if (slashMatch) filterMode = 'skills';

  // In all mode (button-triggered, no @ or / trigger), use the trailing word as query
  const allModeQuery = filterMode === 'all' ? (text.match(/(\S+)$/)?.[1] ?? '') : '';
  const query = atMatch?.[1] ?? slashMatch?.[1] ?? allModeQuery;
  const isOpen = forceOpen || atMatch !== null || slashMatch !== null;

  // Auto-close when user typed then deleted everything (forceOpen mode only)
  useEffect(() => {
    if (!forceOpen) {
      pickerHadQueryRef.current = false;
      return;
    }
    if (allModeQuery !== '') {
      pickerHadQueryRef.current = true;
    } else if (pickerHadQueryRef.current) {
      pickerHadQueryRef.current = false;
      onClose();
    }
  }, [forceOpen, allModeQuery, onClose]);

  // File search (agents-files mode only, query >= 1 char)
  useEffect(() => {
    if (filterMode !== 'agents-files' || query.length < 1 || !activeProjectId) {
      setFileResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchFiles(activeProjectId, query, 30, activeChatId ?? undefined)
        .then((r) => setFileResults(r.filter((f) => f.type === 'file').map((f) => ({ name: f.name, path: f.path }))))
        .catch((err) => {
          log.warn('file search failed', { err: String(err) });
          setFileResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [filterMode, query, activeProjectId, activeChatId]);

  // Build item list (no hint items — composer placeholder already guides file search)
  const items: PickerItem[] = [];
  if (isOpen) {
    if (filterMode === 'all' || filterMode === 'agents-files') {
      agents
        .filter((a) => !query || fuzzyMatch(query, a.name))
        .forEach((a) => items.push({ type: 'agent', name: a.name, description: a.description, scope: a.scope }));
    }
    if (filterMode === 'agents-files') {
      fileResults.forEach((f) => items.push({ type: 'file', name: f.name, path: f.path }));
    }
    if (filterMode === 'all' || filterMode === 'skills') {
      skills
        .filter((s) => {
          if (!query) return true;
          return fuzzyMatch(query, s.invocationName || s.name) || fuzzyMatch(query, s.displayName || s.name);
        })
        .sort((a, b) => {
          const order: Record<string, number> = { project: 0, global: 1, plugin: 2 };
          return (order[a.scope] ?? 99) - (order[b.scope] ?? 99);
        })
        .forEach((s) => items.push({ type: 'skill', skill: s }));
      commands
        .filter((c) => !query || fuzzyMatch(query, c.name))
        .forEach((c) => items.push({ type: 'command', command: c }));
    }
  }

  useEffect(() => setSelectedIndex(0), [filterMode, query]);

  const selectItem = useCallback(
    (item: PickerItem) => {
      try {
        const cur = composerRuntime.getState()?.text ?? '';
        const ins =
          item.type === 'agent'
            ? `@${item.name} `
            : item.type === 'file'
              ? `@${item.path} `
              : item.type === 'command'
                ? `/${item.command.name} `
                : `/${item.skill.invocationName || item.skill.name} `;
        const aInText = cur.match(/(?:^|\s)@(\S*)$/);
        const sInText = cur.match(/^\/(\S*)$/);
        if (aInText) {
          const start = aInText.index! + (aInText[0].startsWith(' ') ? 1 : 0);
          composerRuntime.setText(cur.slice(0, start) + ins);
        } else if (sInText) {
          composerRuntime.setText(ins);
        } else {
          // all mode: replace trailing query word (if any) with the insertion
          const trailingWord = cur.match(/(\S+)$/);
          if (trailingWord) {
            composerRuntime.setText(cur.slice(0, trailingWord.index!) + ins);
          } else {
            const prefix = cur.length === 0 || cur.endsWith(' ') ? '' : ' ';
            composerRuntime.setText(cur + prefix + ins);
          }
        }
        focusComposerInput();
        if (activeChatId && (item.type === 'agent' || item.type === 'file')) {
          addMention(activeChatId, {
            kind: item.type === 'agent' ? 'agent' : 'file',
            name: item.name,
            path: item.type === 'file' ? item.path : undefined,
          }).catch((err) => log.warn('add mention failed', { err: String(err) }));
        }
      } catch (err) {
        log.warn('selection failed', { err: String(err) });
      }
      onClose();
    },
    [composerRuntime, activeChatId, onClose],
  );

  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) selectItem(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        try {
          const cur = composerRuntime.getState()?.text ?? '';
          const cleaned = cur
            .replace(/(?:^|\s)@\S*$/, (m) => (m.startsWith(' ') ? ' ' : ''))
            .replace(/^\/\S*$/, '')
            .trimEnd();
          composerRuntime.setText(cleaned);
        } catch {
          /* expected: composer may not be mounted */
        }
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, items, selectedIndex, selectItem, composerRuntime, onClose]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[240px] overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-lg z-50"
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const key =
          item.type === 'agent'
            ? `a:${item.name}`
            : item.type === 'file'
              ? `f:${item.path}`
              : item.type === 'command'
                ? `c:${item.command.name}`
                : `s:${item.skill.id}`;
        return (
          <button
            key={key}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              selectItem(item);
            }}
            onMouseEnter={() => setSelectedIndex(index)}
            className={cn(
              'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors',
              isSelected ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
            )}
          >
            {item.type === 'agent' && <Bot size={14} className="text-mf-accent mt-0.5 shrink-0" />}
            {item.type === 'file' && <File size={14} className="text-mf-text-secondary mt-0.5 shrink-0" />}
            {item.type === 'skill' && <Zap size={14} className="text-mf-accent mt-0.5 shrink-0" />}
            {item.type === 'command' && <Wrench size={14} className="text-mf-text-secondary mt-0.5 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {item.type === 'skill' ? (
                  <span className="text-mf-body text-mf-text-primary font-medium font-mono">
                    /{item.skill.invocationName || item.skill.name}
                  </span>
                ) : item.type === 'command' ? (
                  <span className="font-mono text-mf-small text-mf-text-primary truncate">/{item.command.name}</span>
                ) : (
                  <span
                    className="text-mf-body text-mf-text-primary font-medium font-mono truncate"
                    title={item.type === 'agent' ? item.name : item.path}
                  >
                    {item.type === 'agent' ? item.name : item.path}
                  </span>
                )}
                <span className="flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-mf-hover text-mf-status text-mf-text-secondary shrink-0">
                  {item.type === 'agent' && (
                    <>
                      {SCOPE_ICON[item.scope]}
                      <span>agent</span>
                    </>
                  )}
                  {item.type === 'file' && <span>file</span>}
                  {item.type === 'skill' && SCOPE_ICON[item.skill.scope]}
                  {item.type === 'command' && (
                    <span className="ml-auto text-[10px] text-mf-text-secondary/60 shrink-0">
                      {item.command.source}
                    </span>
                  )}
                </span>
              </div>
              {item.type === 'agent' && item.description && (
                <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={item.description}>
                  {item.description}
                </div>
              )}
              {item.type === 'skill' && item.skill.description && (
                <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={item.skill.description}>
                  {item.skill.description}
                </div>
              )}
              {item.type === 'command' && item.command.description && (
                <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={item.command.description}>
                  {item.command.description}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
