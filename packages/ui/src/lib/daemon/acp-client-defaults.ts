import { getActiveDaemon } from './active-daemon';
import type { AcpSocketLike } from './acp-rpc-connection';

/** Connection defaults. The heartbeat interval is the production fallback; the daemon's advertised `heartbeatIntervalMs` overrides it per connection. */
export const ACP_CLIENT_DEFAULTS = {
  heartbeatIntervalMs: 15_000,
  clientInfo: { name: 'mainframe-ui', version: '0.0.0' },
  reconnectBaseDelayMs: 1_000,
  reconnectMaxDelayMs: 15_000,
};

export function defaultUrl(profile: string): string {
  const target = getActiveDaemon();
  const base = `${target.baseUrl.replace(/^http/, 'ws')}/acp/${encodeURIComponent(profile)}`;
  return target.token ? `${base}?token=${encodeURIComponent(target.token)}` : base;
}

export function defaultSocketFactory(url: string): AcpSocketLike {
  return new WebSocket(url) as unknown as AcpSocketLike;
}
