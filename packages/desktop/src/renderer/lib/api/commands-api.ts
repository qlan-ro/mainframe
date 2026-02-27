import { fetchJson, API_BASE } from './http';
import type { CustomCommand } from '@mainframe/types';

export async function getCommands(): Promise<CustomCommand[]> {
  const json = await fetchJson<{ success: boolean; data: CustomCommand[] }>(`${API_BASE}/api/commands`);
  return json.data;
}
