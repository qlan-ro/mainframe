import { create } from 'zustand';

export interface FindMatch {
  messageId: string;
  partIndex: number;
  charStart: number;
  charEnd: number;
}

interface FindInChatState {
  isOpen: boolean;
  query: string;
  /** All matches in message order. */
  matches: FindMatch[];
  /** Index into matches[] of the currently focused match. */
  activeIndex: number;

  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  setMatches: (matches: FindMatch[]) => void;
  setActiveIndex: (index: number) => void;
  next: () => void;
  prev: () => void;
}

export const useFindInChatStore = create<FindInChatState>((set, get) => ({
  isOpen: false,
  query: '',
  matches: [],
  activeIndex: 0,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: '', matches: [], activeIndex: 0 }),
  setQuery: (query) => set({ query, activeIndex: 0 }),
  setMatches: (matches) => set({ matches, activeIndex: 0 }),
  setActiveIndex: (activeIndex) => set({ activeIndex }),

  next: () => {
    const { matches, activeIndex } = get();
    if (matches.length === 0) return;
    set({ activeIndex: (activeIndex + 1) % matches.length });
  },

  prev: () => {
    const { matches, activeIndex } = get();
    if (matches.length === 0) return;
    set({ activeIndex: (activeIndex - 1 + matches.length) % matches.length });
  },
}));
