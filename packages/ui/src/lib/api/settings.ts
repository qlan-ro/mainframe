import type { ProviderConfig, ProviderConfigUpdate, GeneralConfig, GeneralConfigPatch } from '@qlan-ro/mainframe-types';
import { GeneralConfigSchema, GeneralConfigPatchSchema } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export type GeneralSettingsPatch = GeneralConfigPatch;

function asRecord(data: unknown): Record<string, unknown> {
  if (data == null || typeof data !== 'object') throw new Error('settings: expected an object response');
  return data as Record<string, unknown>;
}

export async function getProviderSettings(port: number): Promise<Record<string, ProviderConfig>> {
  const data = await request<unknown>('GET', `${apiBase(port)}/api/settings/providers`);
  return asRecord(data) as Record<string, ProviderConfig>;
}

export function updateProviderSettings(port: number, adapterId: string, patch: ProviderConfigUpdate): Promise<void> {
  return requestEmpty('PUT', `${apiBase(port)}/api/settings/providers/${adapterId}`, patch);
}

export async function getGeneralSettings(port: number): Promise<GeneralConfig> {
  return GeneralConfigSchema.parse(await request<unknown>('GET', `${apiBase(port)}/api/settings/general`));
}

export async function updateGeneralSettings(port: number, patch: GeneralSettingsPatch): Promise<void> {
  return requestEmpty('PUT', `${apiBase(port)}/api/settings/general`, GeneralConfigPatchSchema.parse(patch));
}

export async function getConfigConflicts(port: number, adapterId: string): Promise<string[]> {
  const data = asRecord(await request<unknown>('GET', `${apiBase(port)}/api/adapters/${adapterId}/config-conflicts`));
  if (!Array.isArray(data.conflicts)) throw new Error('settings: malformed conflicts');
  return data.conflicts as string[];
}
