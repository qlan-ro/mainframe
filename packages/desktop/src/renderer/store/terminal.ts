import { create } from 'zustand';

export interface TerminalTab {
  id: string;
  name: string;
}

interface TerminalState {
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  addTerminal: (tab: TerminalTab) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,

  addTerminal: (tab) =>
    set((state) => ({
      terminals: [...state.terminals, tab],
      activeTerminalId: tab.id,
    })),

  removeTerminal: (id) =>
    set((state) => {
      const next = state.terminals.filter((t) => t.id !== id);
      const activeGone = state.activeTerminalId === id;
      return {
        terminals: next,
        activeTerminalId: activeGone ? (next[next.length - 1]?.id ?? null) : state.activeTerminalId,
      };
    }),

  setActiveTerminal: (id) => set({ activeTerminalId: id }),
}));
