import { create } from 'zustand';
import { nanoid } from 'nanoid';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
  chatId?: string;
}

interface ToastState {
  toasts: Toast[];
  add: (type: Toast['type'], title: string, description?: string, chatId?: string) => void;
  dismiss: (id: string) => void;
}

const MAX_TOASTS = 20;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (type, title, description, chatId) =>
    set((s) => {
      const next = [...s.toasts, { id: nanoid(8), type, title, description, chatId }];
      return { toasts: next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next };
    }),
  dismiss: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));
