/**
 * Client-side unread tracking. No server concept exists for unread.
 * markUnread is called by session-list-router on chat.notification /
 * permission.requested with notify; clearUnread is called on thread activate.
 */
import { create } from 'zustand';

interface UnreadState {
  unread: Set<string>;
  markUnread: (id: string) => void;
  clearUnread: (id: string) => void;
  isUnread: (id: string) => boolean;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  unread: new Set<string>(),

  markUnread: (id) =>
    set((state) => {
      if (state.unread.has(id)) return state;
      const next = new Set(state.unread);
      next.add(id);
      return { unread: next };
    }),

  clearUnread: (id) =>
    set((state) => {
      if (!state.unread.has(id)) return state;
      const next = new Set(state.unread);
      next.delete(id);
      return { unread: next };
    }),

  isUnread: (id) => get().unread.has(id),
}));
