/**
 * Last-session store — remembers which session was open when the app closed, so
 * boot can restore it instead of always landing on the most-recent-by-time one.
 *
 * Persisted (localStorage `mf:last-session`). The stored id is the daemon chat id
 * (`SessionItem.remoteId`) — the stable identity that survives a reboot — NOT the
 * aui thread id, which can be a per-run `__LOCALID_*` value. The boot selector
 * (`pickInitialSession`) treats it as a preference and silently falls back to the
 * most-recent session when it no longer maps to a live, non-archived chat.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { daemonScopedKey } from '@/lib/daemon/daemon-scoped-storage';

interface LastSessionState {
  /** Daemon chat id of the last opened session, or null if none. */
  lastSessionId: string | null;
  setLastSessionId: (id: string | null) => void;
  /** Maps projectId → daemon chat id of the last opened session in that project. */
  lastByProject: Record<string, string>;
  setLastForProject: (projectId: string, chatId: string) => void;
}

export const useLastSessionStore = create<LastSessionState>()(
  persist(
    (set) => ({
      lastSessionId: null,
      setLastSessionId: (id) => set({ lastSessionId: id }),
      lastByProject: {},
      setLastForProject: (projectId, chatId) =>
        set((s) => ({ lastByProject: { ...s.lastByProject, [projectId]: chatId } })),
    }),
    {
      name: 'mf:last-session',
      version: 2,
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(daemonScopedKey(name)),
        setItem: (name, value) => localStorage.setItem(daemonScopedKey(name), value),
        removeItem: (name) => localStorage.removeItem(daemonScopedKey(name)),
      })),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<LastSessionState>;
        if (version < 2 && p.lastByProject == null) p.lastByProject = {};
        return p as LastSessionState;
      },
    },
  ),
);
