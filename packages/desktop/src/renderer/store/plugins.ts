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
  activeLeftPanelId: string | null;
  activeRightPanelId: string | null;

  registerContribution(c: PluginUIContribution): void;
  /** Remove a specific panel by panelId, or all panels for a plugin when panelId is omitted. */
  unregisterContribution(pluginId: string, panelId?: string): void;
  registerAction(action: PluginAction): void;
  unregisterAction(pluginId: string, actionId: string): void;
  triggerAction(pluginId: string, actionId: string): void;
  clearTriggeredAction(): void;
  activateFullview(pluginId: string): void;
  setActiveLeftPanel(pluginId: string | null): void;
  setActiveRightPanel(pluginId: string | null): void;
}

export const usePluginLayoutStore = create<PluginLayoutState>((set) => ({
  contributions: [],
  actions: [],
  triggeredAction: null,
  activeFullviewId: null,
  activeLeftPanelId: null,
  activeRightPanelId: null,

  registerContribution: (c) =>
    set((s) => ({
      contributions: [...s.contributions.filter((x) => x.panelId !== c.panelId), c],
    })),

  unregisterContribution: (pluginId, panelId?) =>
    set((s) => {
      const contributions = panelId
        ? s.contributions.filter((c) => c.panelId !== panelId)
        : s.contributions.filter((c) => c.pluginId !== pluginId);
      const hasPlugin = contributions.some((c) => c.pluginId === pluginId);
      return {
        contributions,
        activeFullviewId: s.activeFullviewId === pluginId && !hasPlugin ? null : s.activeFullviewId,
        activeLeftPanelId: s.activeLeftPanelId === pluginId && !hasPlugin ? null : s.activeLeftPanelId,
        activeRightPanelId: s.activeRightPanelId === pluginId && !hasPlugin ? null : s.activeRightPanelId,
      };
    }),

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

  setActiveLeftPanel: (pluginId) => set({ activeLeftPanelId: pluginId, activeFullviewId: null }),

  setActiveRightPanel: (pluginId) => set({ activeRightPanelId: pluginId, activeFullviewId: null }),
}));
