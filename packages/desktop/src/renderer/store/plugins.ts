import { create } from 'zustand';
import type { PluginAction, PluginUIContribution, ZoneId } from '@qlan-ro/mainframe-types';
import { registerPluginToolWindow, unregisterPluginToolWindow } from '../components/zone/tool-windows';
import { useLayoutStore } from './layout';

interface TriggeredAction {
  pluginId: string;
  actionId: string;
}

/** Composite key used to uniquely identify a panel contribution. */
function panelKey(pluginId: string, panelId: string): string {
  return `${pluginId}::${panelId}`;
}

interface PluginLayoutState {
  contributions: PluginUIContribution[];
  actions: PluginAction[];
  triggeredAction: TriggeredAction | null;
  activeFullviewId: string | null;

  registerContribution(c: PluginUIContribution): void;
  /** Remove a specific panel by panelId, or (omit panelId) remove all panels for pluginId. */
  unregisterContribution(pluginId: string, panelId?: string): void;
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
    const key = panelKey(c.pluginId, c.panelId);
    set((s) => ({
      contributions: [...s.contributions.filter((x) => panelKey(x.pluginId, x.panelId) !== key), c],
    }));
    if (c.zone !== 'fullview') {
      registerPluginToolWindow({ id: key, label: c.label, defaultZone: c.zone as ZoneId });
      useLayoutStore.getState().registerToolWindow(key, c.zone as ZoneId);
    }
  },

  unregisterContribution: (pluginId, panelId) => {
    if (panelId !== undefined) {
      const key = panelKey(pluginId, panelId);
      set((s) => ({
        contributions: s.contributions.filter((c) => panelKey(c.pluginId, c.panelId) !== key),
        activeFullviewId: s.activeFullviewId === pluginId ? null : s.activeFullviewId,
      }));
      unregisterPluginToolWindow(key);
      useLayoutStore.getState().unregisterToolWindow(key);
    } else {
      // Remove all panels for this plugin.
      set((s) => {
        const remaining = s.contributions.filter((c) => c.pluginId !== pluginId);
        return {
          contributions: remaining,
          activeFullviewId: s.activeFullviewId === pluginId ? null : s.activeFullviewId,
        };
      });
      unregisterPluginToolWindow(pluginId);
      useLayoutStore.getState().unregisterToolWindow(pluginId);
    }
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
