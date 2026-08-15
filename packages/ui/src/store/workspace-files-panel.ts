/**
 * workspace-files-panel — the docked Files sidebar's open state.
 *
 * Persisted PER SCOPE (project/worktree — the same `scopeKey`
 * (`buildLaunchScope`) that launch/terminal/file tabs use, read live from
 * `store/active-bases-store`), not globally: opening the tree in one project
 * doesn't force it open, or closed, in another.
 *
 * Reversal of the earlier transient, light-dismissed floating panel (see
 * packages/ui/CLAUDE.md, 2026-08-15, for the why) — the panel is a persistent
 * docked sidebar now, so its open state persists like any other docked chrome.
 *
 * Lives in store/ (not features/) because the intent subscriber opens it for
 * `toggle-workspace-files` and `reveal-file`, and store/ must not import
 * features/.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { daemonScopedKey } from '@/lib/daemon/daemon-scoped-storage';
import { useActiveBasesStore } from './active-bases-store';

/** Bucket for a draft/unresolved session with no scope yet — keeps the panel
 *  toggleable (e.g. the no-project empty state) without a real scope to key on. */
const UNSCOPED = '__unscoped__';

interface WorkspaceFilesPanelStore {
  /** Per-scope open state. Absent keys read as closed — see isWorkspaceFilesPanelOpen. */
  openByScope: Record<string, boolean>;
  /** Sets the flag for the CURRENT active scope (active-bases-store), not a passed-in one —
   *  every call site already has the active session in view. */
  setOpen: (open: boolean) => void;
}

/** Selector helper: a scope with no recorded state reads as closed. */
export function isWorkspaceFilesPanelOpen(openByScope: Record<string, boolean>, scopeKey: string | null): boolean {
  return openByScope[scopeKey ?? UNSCOPED] ?? false;
}

export const useWorkspaceFilesPanel = create<WorkspaceFilesPanelStore>()(
  persist(
    (set) => ({
      openByScope: {},
      setOpen: (open) => {
        const scopeKey = useActiveBasesStore.getState().scopeKey ?? UNSCOPED;
        set((s) => ({ openByScope: { ...s.openByScope, [scopeKey]: open } }));
      },
    }),
    {
      name: 'mf:workspace-files-panel',
      version: 1,
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(daemonScopedKey(name)),
        setItem: (name, value) => localStorage.setItem(daemonScopedKey(name), value),
        removeItem: (name) => localStorage.removeItem(daemonScopedKey(name)),
      })),
    },
  ),
);
