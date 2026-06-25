import type { ProviderConfig, ProviderConfigUpdate, GeneralConfig, NotificationConfig } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

/** Deep-partial general patch: `notifications` merges at sub-group level so independent toggles stay commutative. */
export type GeneralSettingsPatch = Partial<Omit<GeneralConfig, 'notifications'>> & {
  notifications?: {
    chat?: Partial<NotificationConfig['chat']>;
    permission?: Partial<NotificationConfig['permission']>;
    other?: Partial<NotificationConfig['other']>;
  };
};

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
  const data = asRecord(await request<unknown>('GET', `${apiBase(port)}/api/settings/general`));
  // `typeof null === 'object'` slips through, so guard `notifications` with an explicit null check.
  if (typeof data.worktreeDir !== 'string' || data.notifications == null || typeof data.notifications !== 'object') {
    throw new Error('settings: malformed general config');
  }
  return data as unknown as GeneralConfig;
}

export function updateGeneralSettings(port: number, patch: GeneralSettingsPatch): Promise<void> {
  return requestEmpty('PUT', `${apiBase(port)}/api/settings/general`, patch);
}

export async function getConfigConflicts(port: number, adapterId: string): Promise<string[]> {
  const data = asRecord(await request<unknown>('GET', `${apiBase(port)}/api/adapters/${adapterId}/config-conflicts`));
  if (!Array.isArray(data.conflicts)) throw new Error('settings: malformed conflicts');
  return data.conflicts as string[];
}
