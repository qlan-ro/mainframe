/**
 * Per-port quick tunnels for the localhost chips (#279).
 *
 * Separate from `remote-access.ts`, which owns the single `daemon`-labelled
 * tunnel and its persisted config; these are ephemeral and per-chat.
 */
import type { PortTunnelInfo, PortTunnelStartRequest, PortTunnelsList } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

function obj(data: unknown): Record<string, unknown> {
  if (data == null || typeof data !== 'object') throw new Error('tunnel-ports: expected an object response');
  return data as Record<string, unknown>;
}

function parseInfo(entry: unknown): PortTunnelInfo | null {
  if (entry == null || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (typeof e['port'] !== 'number') return null;
  const state = e['state'] === 'ready' ? 'ready' : 'starting';
  const url = typeof e['url'] === 'string' ? e['url'] : undefined;
  return url !== undefined ? { port: e['port'], state, url } : { port: e['port'], state };
}

export async function startPortTunnel(port: number, body: PortTunnelStartRequest): Promise<{ url: string }> {
  const d = obj(await request<unknown>('POST', `${apiBase(port)}/api/tunnel/ports/start`, body));
  if (typeof d['url'] !== 'string') throw new Error('tunnel-ports: bad start result');
  return { url: d['url'] };
}

export function stopPortTunnel(port: number, portNum: number): Promise<void> {
  return requestEmpty('POST', `${apiBase(port)}/api/tunnel/ports/stop`, { port: portNum });
}

export async function listPortTunnels(port: number): Promise<PortTunnelsList> {
  const d = obj(await request<unknown>('GET', `${apiBase(port)}/api/tunnel/ports`));
  if (typeof d['daemonPort'] !== 'number') throw new Error('tunnel-ports: bad tunnel list');
  const raw = Array.isArray(d['tunnels']) ? d['tunnels'] : [];
  const tunnels = raw.map(parseInfo).filter((t): t is PortTunnelInfo => t !== null);
  return { tunnels, daemonPort: d['daemonPort'] };
}
