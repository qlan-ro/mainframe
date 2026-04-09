import { create } from 'zustand';
import type { PluginAction, PluginUIContribution, ZoneId } from '@qlan-ro/mainframe-types';
import { registerPluginToolWindow, unregisterPluginToolWindow } from '../components/zone/tool-windows';
import { useLayoutStore } from './layout';

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

  registerContribution: (c) => {
    set((s) => ({
      contributions: [...s.contributions.filter((x) => x.pluginId !== c.pluginId), c],
    }));
    if (c.zone !== 'fullview') {
      registerPluginToolWindow({ id: c.pluginId, label: c.label, defaultZone: c.zone as ZoneId });
      useLayoutStore.getState().registerToolWindow(c.pluginId, c.zone as ZoneId);
    }
  },

  unregisterContribution: (pluginId) => {
    set((s) => ({
      contributions: s.contributions.filter((c) => c.pluginId !== pluginId),
      activeFullviewId: s.activeFullviewId === pluginId ? null : s.activeFullviewId,
    }));
    unregisterPluginToolWindow(pluginId);
    useLayoutStore.getState().unregisterToolWindow(pluginId);
  },

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
