import { create } from 'zustand';

export interface FindMatch {
  messageId: string;
  partIndex: number;
  charStart: number;
  charEnd: number;
  itemId?: string;
  occurrence?: number;
}

export interface FindInChatState {
  serverTotal: number | null;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  navigation: number;
  refresh: number;
  daemon: boolean;
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
  serverTotal: null,
  truncated: false,
  loading: false,
  error: null,
  navigation: 0,
  refresh: 0,
  daemon: false,
  isOpen: false,
  query: '',
  matches: [],
  activeIndex: 0,

  open: () => set({ isOpen: true }),
  close: () =>
    set({
      isOpen: false,
      query: '',
      matches: [],
      activeIndex: 0,
      serverTotal: null,
      truncated: false,
      loading: false,
      error: null,
    }),
  setQuery: (query) => set({ query, activeIndex: 0, matches: [], serverTotal: null, truncated: false }),
  setMatches: (matches) => set({ matches, activeIndex: 0 }),
  setActiveIndex: (activeIndex) => set({ activeIndex }),

  next: () => {
    const { matches, activeIndex } = get();
    if (matches.length === 0) return;
    set({ activeIndex: (activeIndex + 1) % matches.length, navigation: get().navigation + 1 });
  },

  prev: () => {
    const { matches, activeIndex } = get();
    if (matches.length === 0) return;
    set({ activeIndex: (activeIndex - 1 + matches.length) % matches.length, navigation: get().navigation + 1 });
  },
}));
