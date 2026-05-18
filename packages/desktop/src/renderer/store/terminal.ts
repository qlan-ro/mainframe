import { create } from 'zustand';

export interface TerminalTab {
  id: string;
  name: string;
}

/** Maximum number of terminal tabs retained per scope when it is not active. */
const MAX_TERMINALS_PER_SCOPE = 3;

// Stable empty array — returning a fresh `[]` from `getTerminals` would make
// `useSyncExternalStore` see a new snapshot on every render, infinite-looping
// `TerminalPanel` with React error #185.
const EMPTY_TERMINALS: readonly TerminalTab[] = Object.freeze([]);

interface TerminalState {
  /**
   * Per-scope terminal lists. The "scope" is the active chat id when there is
   * one (so each session's terminals follow its worktree), falling back to
   * the project id when no chat is active.
   */
  terminalsByScope: Map<string, TerminalTab[]>;
  /** Per-scope active terminal id. */
  activeTerminalByScope: Map<string, string | null>;

  getTerminals: (scopeId: string) => TerminalTab[];
  getActiveTerminalId: (scopeId: string) => string | null;
  addTerminal: (scopeId: string, tab: TerminalTab) => void;
  removeTerminal: (scopeId: string, id: string) => void;
  setActiveTerminal: (scopeId: string, id: string | null) => void;
  clearScope: (scopeId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminalsByScope: new Map(),
  activeTerminalByScope: new Map(),

  getTerminals: (scopeId) => get().terminalsByScope.get(scopeId) ?? (EMPTY_TERMINALS as TerminalTab[]),

  getActiveTerminalId: (scopeId) => get().activeTerminalByScope.get(scopeId) ?? null,

  addTerminal: (scopeId, tab) =>
    set((state) => {
      const existing = state.terminalsByScope.get(scopeId) ?? [];
      // Cap the list so idle scopes don't accumulate unlimited tabs
      const capped = existing.length >= MAX_TERMINALS_PER_SCOPE ? existing.slice(1) : existing;
      const terminals = new Map(state.terminalsByScope);
      terminals.set(scopeId, [...capped, tab]);
      const active = new Map(state.activeTerminalByScope);
      active.set(scopeId, tab.id);
      return { terminalsByScope: terminals, activeTerminalByScope: active };
    }),

  removeTerminal: (scopeId, id) =>
    set((state) => {
      const existing = state.terminalsByScope.get(scopeId) ?? [];
      const next = existing.filter((t) => t.id !== id);
      const terminals = new Map(state.terminalsByScope);
      terminals.set(scopeId, next);

      const active = new Map(state.activeTerminalByScope);
      if (state.activeTerminalByScope.get(scopeId) === id) {
        active.set(scopeId, next[next.length - 1]?.id ?? null);
      }
      return { terminalsByScope: terminals, activeTerminalByScope: active };
    }),

  setActiveTerminal: (scopeId, id) =>
    set((state) => {
      const active = new Map(state.activeTerminalByScope);
      active.set(scopeId, id);
      return { activeTerminalByScope: active };
    }),

  clearScope: (scopeId) =>
    set((state) => {
      const terminals = new Map(state.terminalsByScope);
      terminals.delete(scopeId);
      const active = new Map(state.activeTerminalByScope);
      active.delete(scopeId);
      return { terminalsByScope: terminals, activeTerminalByScope: active };
    }),
}));
