import { create } from 'zustand';

interface RegisteredPanel {
  pluginId: string;
  panelId: string;
  label: string;
  icon?: string;
  position: string;
  entryPoint: string;
}

interface PluginsState {
  panels: RegisteredPanel[];
  addPanel(panel: RegisteredPanel): void;
  removePanel(pluginId: string, panelId: string): void;
}

export const usePluginsStore = create<PluginsState>((set) => ({
  panels: [],
  addPanel: (panel) =>
    set((s) => ({
      panels: [...s.panels.filter((p) => !(p.pluginId === panel.pluginId && p.panelId === panel.panelId)), panel],
    })),
  removePanel: (pluginId, panelId) =>
    set((s) => ({
      panels: s.panels.filter((p) => !(p.pluginId === pluginId && p.panelId === panelId)),
    })),
}));
