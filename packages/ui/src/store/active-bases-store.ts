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
 * onto every Run tab created outside React (terminals, Files guests) so they
 * scope-filter alongside launch-config tabs. `null` for a draft/unresolved
 * session.
 */
import { create } from 'zustand';
import type { FileBases } from '@/lib/files/file-ref';

interface ActiveBasesStore {
  bases: FileBases;
  scopeKey: string | null;
  setActiveBases: (bases: FileBases, scopeKey: string | null) => void;
}

export const useActiveBasesStore = create<ActiveBasesStore>()((set) => ({
  bases: {},
  scopeKey: null,
  setActiveBases(bases, scopeKey) {
    set({ bases, scopeKey });
  },
}));
