/**
 * store/active-bases-store.ts
 *
 * Thin bridge store that carries the active workspace bases (worktreePath +
 * projectPath) from React-land into the intent subscriber (which runs outside
 * React). React components call `setActiveBases` on every active-session
 * change; the subscriber reads `getState()` at intent time.
 *
 * Only one set of bases is live at a time — the currently active thread.
 * An empty `{}` means "no active session" (new/draft thread).
 *
 * `scopeKey` is the active session's launch scope (`buildLaunchScope`), stamped
 * onto every workspace tab created outside React (terminals, files) so they
 * scope-filter alongside launch-config tabs. `null` for a draft/unresolved
 * session.
 */
import { create } from 'zustand';
import type { FileBases } from '@/lib/files/file-ref';

export interface ActiveFileTree {
  daemonId: string;
  projectId: string;
  chatId?: string;
  port: number;
}

interface ActiveBasesStore {
  tree: ActiveFileTree | null;
  bases: FileBases;
  scopeKey: string | null;
  setActiveBases: (bases: FileBases, scopeKey: string | null, tree?: ActiveFileTree | null) => void;
}

export const useActiveBasesStore = create<ActiveBasesStore>()((set) => ({
  bases: {},
  tree: null,
  scopeKey: null,
  setActiveBases(bases, scopeKey, tree = null) {
    set({ bases, scopeKey, tree });
  },
}));
