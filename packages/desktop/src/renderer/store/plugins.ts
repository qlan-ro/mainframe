import { create } from 'zustand';
import type { PluginUIContribution } from '@mainframe/types';

interface PluginLayoutState {
  contributions: PluginUIContribution[];
  activeFullviewId: string | null;
  activeLeftPanelId: string | null;
  activeRightPanelId: string | null;

  registerContribution(c: PluginUIContribution): void;
  unregisterContribution(pluginId: string): void;
  activateFullview(pluginId: string): void;
  setActiveLeftPanel(pluginId: string | null): void;
  setActiveRightPanel(pluginId: string | null): void;
}

export const usePluginLayoutStore = create<PluginLayoutState>((set) => ({
  contributions: [],
  activeFullviewId: null,
  activeLeftPanelId: null,
  activeRightPanelId: null,

  registerContribution: (c) =>
    set((state) => ({
      contributions: [...state.contributions.filter((x) => x.pluginId !== c.pluginId), c],
    })),

  unregisterContribution: (pluginId) =>
    set((state) => ({
      contributions: state.contributions.filter((c) => c.pluginId !== pluginId),
      activeFullviewId: state.activeFullviewId === pluginId ? null : state.activeFullviewId,
      activeLeftPanelId: state.activeLeftPanelId === pluginId ? null : state.activeLeftPanelId,
      activeRightPanelId: state.activeRightPanelId === pluginId ? null : state.activeRightPanelId,
    })),

  activateFullview: (pluginId) =>
    set((state) => ({
      activeFullviewId: state.activeFullviewId === pluginId ? null : pluginId,
    })),

  setActiveLeftPanel: (pluginId) => set({ activeLeftPanelId: pluginId, activeFullviewId: null }),

  setActiveRightPanel: (pluginId) => set({ activeRightPanelId: pluginId, activeFullviewId: null }),
}));
