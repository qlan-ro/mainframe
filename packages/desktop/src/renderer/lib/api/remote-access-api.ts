import { fetchJson, postJson, deleteRequest, API_BASE } from './http';

interface TunnelStatus {
  running: boolean;
  url: string | null;
  verified: boolean;
}

interface TunnelStartResult {
  url: string;
}

interface TunnelConfig {
  hasToken: boolean;
  url: string | null;
}

interface PairingResult {
  pairingCode: string;
}

interface Device {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastSeen: string | null;
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const json = await fetchJson<{ success: boolean; data: TunnelStatus }>(`${API_BASE}/api/tunnel/status`);
  return json.data;
}

export async function startTunnel(config?: { token?: string; url?: string }): Promise<TunnelStartResult> {
  const json = await postJson<{ success: boolean; data: TunnelStartResult }>(`${API_BASE}/api/tunnel/start`, config);
  return json.data;
}

export async function stopTunnel(opts?: { clearConfig?: boolean }): Promise<void> {
  await postJson(`${API_BASE}/api/tunnel/stop`, opts);
}

export async function getTunnelConfig(): Promise<TunnelConfig> {
  const json = await fetchJson<{ success: boolean; data: TunnelConfig }>(`${API_BASE}/api/tunnel/config`);
  return json.data;
}

export async function generatePairingCode(): Promise<PairingResult> {
  const json = await postJson<{ success: boolean; data: PairingResult }>(`${API_BASE}/api/auth/pair`);
  return json.data;
}

export async function getDevices(): Promise<Device[]> {
  const json = await fetchJson<{ success: boolean; data: Device[] }>(`${API_BASE}/api/auth/devices`);
  return json.data;
}

export async function removeDevice(deviceId: string): Promise<void> {
  await deleteRequest(`${API_BASE}/api/auth/devices/${deviceId}`);
}
