import { create } from 'zustand';
import type { PluginUIContribution, UIZone } from '@mainframe/types';

// Shape expected by useDaemon for plugin.panel.registered events
interface AddPanelPayload {
  pluginId: string;
  zone: UIZone;
  label: string;
  icon?: string;
}

interface PluginsState {
  addPanel(event: AddPanelPayload): void;
  removePanel(pluginId: string, panelId?: string): void;
}

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

  setActiveRightPanel: (pluginId) => set({ activeRightPanelId: pluginId }),
}));

// usePluginsStore is a thin facade used by useDaemon to handle
// plugin.panel.registered / plugin.panel.unregistered WS events.
// It delegates to usePluginLayoutStore so a single store owns all state.
export const usePluginsStore = create<PluginsState>(() => ({
  addPanel: (event) => {
    usePluginLayoutStore.getState().registerContribution({
      pluginId: event.pluginId,
      zone: event.zone,
      label: event.label,
      icon: event.icon,
    });
  },

  removePanel: (pluginId) => {
    usePluginLayoutStore.getState().unregisterContribution(pluginId);
  },
}));
