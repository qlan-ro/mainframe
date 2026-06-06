/**
 * Persists the set of collapsed project sections to localStorage
 * under 'mf:collapsedProjects'. Ported from desktop ChatsPanel.tsx:29-45.
 * A plain React hook (not zustand) — collapse state is local to the sidebar
 * subtree and does not need to be shared across the component tree.
 */
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'mf:collapsedProjects';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    /* corrupted — fall through */
  }
  return new Set<string>();
}

function saveCollapsed(set: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export interface CollapsedProjectsApi {
  collapsed: Set<string>;
  toggle: (projectId: string) => void;
}

export function useCollapsedProjects(): CollapsedProjectsApi {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggle = useCallback((projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      saveCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
