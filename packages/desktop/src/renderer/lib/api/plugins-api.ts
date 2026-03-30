import type { UIZone } from '@qlan-ro/mainframe-types';
import { API_BASE, fetchJson } from './http';

interface PluginPanel {
  panelId: string;
  zone: UIZone;
  label: string;
  icon?: string;
}

interface PluginActionInfo {
  id: string;
  pluginId: string;
  label: string;
  shortcut: string;
  icon?: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  /** All registered panels for this plugin. */
  panels?: PluginPanel[];
  /** Legacy single-panel field for backwards compat. */
  panel?: Omit<PluginPanel, 'panelId'>;
  actions?: PluginActionInfo[];
}

interface GetPluginsResponse {
  plugins: PluginInfo[];
}

export async function getPlugins(): Promise<PluginInfo[]> {
  const data = await fetchJson<GetPluginsResponse>(`${API_BASE}/api/plugins`);
  return data.plugins;
}
