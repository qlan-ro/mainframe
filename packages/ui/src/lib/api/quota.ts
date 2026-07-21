/**
 * Provider quota REST wrapper. The merged blob is account-wide (no chat scope);
 * an `okEmpty` reply (no known quota yet) surfaces here as `null`.
 */
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

/** GET the persisted quota blob for a provider; `null` when none is known (okEmpty). */
export const getQuota = (id: string, port?: number): Promise<ProviderQuota | null> =>
  request<ProviderQuota | undefined>('GET', `${apiBase(port)}/api/providers/${id}/quota`).then((q) => q ?? null);

/** Force a fresh pull; `null` when the provider still has nothing to report. */
export const refreshQuota = (id: string, port?: number): Promise<ProviderQuota | null> =>
  request<ProviderQuota | undefined>('POST', `${apiBase(port)}/api/providers/${id}/quota/refresh`).then((q) => q ?? null);
