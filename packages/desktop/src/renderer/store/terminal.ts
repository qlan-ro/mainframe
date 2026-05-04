import { create } from 'zustand';

export interface TerminalTab {
  id: string;
  name: string;
}

/** Maximum number of terminal tabs retained per project when it is not active. */
const MAX_TERMINALS_PER_PROJECT = 3;

interface TerminalState {
  /** Per-project terminal lists. Keyed by projectId. */
  terminalsByProject: Map<string, TerminalTab[]>;
  /** Per-project active terminal id. Keyed by projectId. */
  activeTerminalByProject: Map<string, string | null>;

  getTerminals: (projectId: string) => TerminalTab[];
  getActiveTerminalId: (projectId: string) => string | null;
  addTerminal: (projectId: string, tab: TerminalTab) => void;
  removeTerminal: (projectId: string, id: string) => void;
  setActiveTerminal: (projectId: string, id: string | null) => void;
  clearProject: (projectId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminalsByProject: new Map(),
  activeTerminalByProject: new Map(),

  getTerminals: (projectId) => get().terminalsByProject.get(projectId) ?? [],

  getActiveTerminalId: (projectId) => get().activeTerminalByProject.get(projectId) ?? null,

  addTerminal: (projectId, tab) =>
    set((state) => {
      const existing = state.terminalsByProject.get(projectId) ?? [];
      // Cap the list so idle projects don't accumulate unlimited tabs
      const capped = existing.length >= MAX_TERMINALS_PER_PROJECT ? existing.slice(1) : existing;
      const terminals = new Map(state.terminalsByProject);
      terminals.set(projectId, [...capped, tab]);
      const active = new Map(state.activeTerminalByProject);
      active.set(projectId, tab.id);
      return { terminalsByProject: terminals, activeTerminalByProject: active };
    }),

  removeTerminal: (projectId, id) =>
    set((state) => {
      const existing = state.terminalsByProject.get(projectId) ?? [];
      const next = existing.filter((t) => t.id !== id);
      const terminals = new Map(state.terminalsByProject);
      terminals.set(projectId, next);

      const active = new Map(state.activeTerminalByProject);
      if (state.activeTerminalByProject.get(projectId) === id) {
        active.set(projectId, next[next.length - 1]?.id ?? null);
      }
      return { terminalsByProject: terminals, activeTerminalByProject: active };
    }),

  setActiveTerminal: (projectId, id) =>
    set((state) => {
      const active = new Map(state.activeTerminalByProject);
      active.set(projectId, id);
      return { activeTerminalByProject: active };
    }),

  clearProject: (projectId) =>
    set((state) => {
      const terminals = new Map(state.terminalsByProject);
      terminals.delete(projectId);
      const active = new Map(state.activeTerminalByProject);
      active.delete(projectId);
      return { terminalsByProject: terminals, activeTerminalByProject: active };
    }),
}));
