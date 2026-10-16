/**
 * Provider CLI version/update REST wrapper (todo #405). `getProviderCliStatuses` lists
 * only the providers the daemon knows how to update (may be empty — an adapter absent
 * from the list shows no version section). `checkProviderCliUpdate` forces a fresh
 * latest-version probe. `updateProviderCli` starts an in-app update; progress then
 * arrives via the `provider.cli.updated` WS event, not this call's return value alone.
 */
import type { ProviderCliStatus } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getProviderCliStatuses = (port: number): Promise<ProviderCliStatus[]> =>
  request<ProviderCliStatus[]>('GET', `${apiBase(port)}/api/providers/cli-status`);

export const checkProviderCliUpdate = (adapterId: string, port: number): Promise<ProviderCliStatus> =>
  request<ProviderCliStatus>('POST', `${apiBase(port)}/api/providers/${encodeURIComponent(adapterId)}/cli/check`);

export const updateProviderCli = (adapterId: string, port: number): Promise<ProviderCliStatus> =>
  request<ProviderCliStatus>('POST', `${apiBase(port)}/api/providers/${encodeURIComponent(adapterId)}/cli/update`);
