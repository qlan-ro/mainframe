import type { UIZone } from '@mainframe/types';
import { API_BASE, fetchJson } from './http';

interface PluginPanel {
  zone: UIZone;
  label: string;
  icon?: string;
}

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  panel?: PluginPanel;
}

interface GetPluginsResponse {
  plugins: PluginInfo[];
}

export async function getPlugins(): Promise<PluginInfo[]> {
  const data = await fetchJson<GetPluginsResponse>(`${API_BASE}/api/plugins`);
  return data.plugins;
}
