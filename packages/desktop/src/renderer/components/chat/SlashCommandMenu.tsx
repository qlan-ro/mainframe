import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { Zap, FolderOpen, Globe, Puzzle } from 'lucide-react';
import { useComposerRuntime } from '@assistant-ui/react';
import { focusComposerInput } from '../../lib/focus';
import { useSkillsStore } from '../../store';
import { cn } from '../../lib/utils';
import type { Skill } from '@mainframe/types';

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

export function SlashCommandMenu(): React.ReactElement | null {
  const { skills } = useSkillsStore();
  const text = useComposerText();
  const composerRuntime = useComposerRuntime();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const slashMatch = text.match(/^\/(\S*)$/);
  const isActive = slashMatch !== null;
  const query = slashMatch?.[1] ?? '';

  const filtered = isActive
    ? skills
        .filter((s) => {
          const name = s.invocationName || s.name;
          const display = s.displayName || s.name;
          return !query || fuzzyMatch(query, name) || fuzzyMatch(query, display);
        })
        .sort((a, b) => {
          const scopeOrder = { project: 0, global: 1, plugin: 2 };
          return scopeOrder[a.scope] - scopeOrder[b.scope];
        })
    : [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const selectSkill = useCallback(
    (skill: Skill) => {
      const command = `/${skill.invocationName || skill.name} `;
      composerRuntime.setText(command);
      focusComposerInput();
    },
    [composerRuntime],
  );

  useEffect(() => {
    if (!isActive || filtered.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const skill = filtered[selectedIndex];
        if (skill) selectSkill(skill);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        composerRuntime.setText('');
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, filtered, selectedIndex, selectSkill, composerRuntime]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!menuRef.current) return;
    const item = menuRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isActive || filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[240px] overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-lg z-50"
    >
      {filtered.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            selectSkill(skill);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={cn(
            'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors',
            index === selectedIndex ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
          )}
        >
          <Zap size={14} className="text-mf-accent mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-mf-body text-mf-text-primary font-medium font-mono">
                /{skill.invocationName || skill.name}
              </span>
              <span className="flex items-center gap-0.5 px-1 py-0 rounded-full bg-mf-hover text-mf-status text-mf-text-secondary shrink-0">
                {SCOPE_ICON[skill.scope]}
              </span>
            </div>
            {skill.description && (
              <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={skill.description}>
                {skill.description}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
