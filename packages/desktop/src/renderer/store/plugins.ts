import { create } from 'zustand';
import type { PluginAction, PluginUIContribution } from '@qlan-ro/mainframe-types';

interface TriggeredAction {
  pluginId: string;
  actionId: string;
}

interface PluginLayoutState {
  contributions: PluginUIContribution[];
  actions: PluginAction[];
  triggeredAction: TriggeredAction | null;
  activeFullviewId: string | null;

  registerContribution(c: PluginUIContribution): void;
  unregisterContribution(pluginId: string): void;
  registerAction(action: PluginAction): void;
  unregisterAction(pluginId: string, actionId: string): void;
  triggerAction(pluginId: string, actionId: string): void;
  clearTriggeredAction(): void;
  activateFullview(pluginId: string): void;
}

export const usePluginLayoutStore = create<PluginLayoutState>((set) => ({
  contributions: [],
  actions: [],
  triggeredAction: null,
  activeFullviewId: null,

  registerContribution: (c) =>
    set((s) => ({
      contributions: [...s.contributions.filter((x) => x.pluginId !== c.pluginId), c],
    })),

  unregisterContribution: (pluginId) =>
    set((s) => ({
      contributions: s.contributions.filter((c) => c.pluginId !== pluginId),
      activeFullviewId: s.activeFullviewId === pluginId ? null : s.activeFullviewId,
    })),

  registerAction: (action) =>
    set((s) => ({
      actions: [...s.actions.filter((a) => !(a.pluginId === action.pluginId && a.id === action.id)), action],
    })),

  unregisterAction: (pluginId, actionId) =>
    set((s) => ({
      actions: s.actions.filter((a) => !(a.pluginId === pluginId && a.id === actionId)),
    })),

  triggerAction: (pluginId, actionId) => set({ triggeredAction: { pluginId, actionId } }),

  clearTriggeredAction: () => set({ triggeredAction: null }),

  activateFullview: (pluginId) =>
    set((s) => ({
      activeFullviewId: s.activeFullviewId === pluginId ? null : pluginId,
    })),
}));
