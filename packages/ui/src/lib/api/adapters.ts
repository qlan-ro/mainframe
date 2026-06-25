/**
 * Adapter registry REST wrapper — the model capability catalog the composer
 * config toolbar reads (each adapter's models + supportedEfforts + supports*).
 */
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getAdapters = (port: number): Promise<AdapterInfo[]> =>
  request<AdapterInfo[]>('GET', `${apiBase(port)}/api/adapters`);
