/**
 * Adapter registry REST wrapper — the model capability catalog the composer
 * config toolbar reads (each adapter's models + supportedEfforts + supports*).
 */
import type { ApiResponse, AdapterInfo } from '@qlan-ro/mainframe-types';
import { apiBase, fetchJson } from './http';

export async function getAdapters(port: number): Promise<AdapterInfo[]> {
  const json = await fetchJson<ApiResponse<AdapterInfo[]>>(`${apiBase(port)}/api/adapters`);
  if (!json.success) throw new Error(json.error);
  return json.data;
}
