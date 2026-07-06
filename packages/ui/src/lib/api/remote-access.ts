import type { Device } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export interface TunnelStatus {
  running: boolean;
  url: string | null;
  verified: boolean;
}
export interface TunnelStartResult {
  url: string;
}
export interface TunnelConfig {
  hasToken: boolean;
  url: string | null;
}
export interface PairingResult {
  pairingCode: string;
}

function obj(data: unknown): Record<string, unknown> {
  if (data == null || typeof data !== 'object') throw new Error('remote-access: expected an object response');
  return data as Record<string, unknown>;
}

export async function getTunnelStatus(port: number): Promise<TunnelStatus> {
  const d = obj(await request<unknown>('GET', `${apiBase(port)}/api/tunnel/status`));
  if (typeof d.running !== 'boolean' || typeof d.verified !== 'boolean')
    throw new Error('remote-access: bad tunnel status');
  return { running: d.running, url: (d.url ?? null) as string | null, verified: d.verified };
}

export async function startTunnel(port: number, config?: { token?: string; url?: string }): Promise<TunnelStartResult> {
  const d = obj(await request<unknown>('POST', `${apiBase(port)}/api/tunnel/start`, config ?? {}));
  if (typeof d.url !== 'string') throw new Error('remote-access: bad start result');
  return { url: d.url };
}

export function stopTunnel(port: number, opts?: { clearConfig?: boolean }): Promise<void> {
  return requestEmpty('POST', `${apiBase(port)}/api/tunnel/stop`, opts ?? {});
}

export async function getTunnelConfig(port: number): Promise<TunnelConfig> {
  const d = obj(await request<unknown>('GET', `${apiBase(port)}/api/tunnel/config`));
  if (typeof d.hasToken !== 'boolean') throw new Error('remote-access: bad tunnel config');
  return { hasToken: d.hasToken, url: (d.url ?? null) as string | null };
}

export async function generatePairingCode(port: number): Promise<PairingResult> {
  const d = obj(await request<unknown>('POST', `${apiBase(port)}/api/auth/pair`, {}));
  if (typeof d.pairingCode !== 'string') throw new Error('remote-access: bad pairing code');
  return { pairingCode: d.pairingCode };
}

export async function getDevices(port: number): Promise<Device[]> {
  const data = await request<unknown>('GET', `${apiBase(port)}/api/auth/devices`);
  if (!Array.isArray(data)) throw new Error('remote-access: bad devices list');
  return data as Device[];
}

export function removeDevice(port: number, deviceId: string): Promise<void> {
  return requestEmpty('DELETE', `${apiBase(port)}/api/auth/devices/${deviceId}`);
}
