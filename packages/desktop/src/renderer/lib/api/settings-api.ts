import type { ProviderConfig, GeneralConfig } from '@mainframe/types';
import { fetchJson, putJson, API_BASE } from './http';

export async function getProviderSettings(): Promise<Record<string, ProviderConfig>> {
  const json = await fetchJson<{ success: boolean; data: Record<string, ProviderConfig> }>(
    `${API_BASE}/api/settings/providers`,
  );
  return json.data;
}

export async function updateProviderSettings(adapterId: string, settings: Partial<ProviderConfig>): Promise<void> {
  await putJson(`${API_BASE}/api/settings/providers/${adapterId}`, settings);
}

export async function getGeneralSettings(): Promise<GeneralConfig> {
  const json = await fetchJson<{ success: boolean; data: GeneralConfig }>(`${API_BASE}/api/settings/general`);
  return json.data;
}

export async function updateGeneralSettings(settings: Partial<GeneralConfig>): Promise<void> {
  await putJson(`${API_BASE}/api/settings/general`, settings);
}

export async function getConfigConflicts(adapterId: string): Promise<string[]> {
  const json = await fetchJson<{ success: boolean; data: { conflicts: string[] } }>(
    `${API_BASE}/api/adapters/${adapterId}/config-conflicts`,
  );
  return json.data.conflicts;
}
