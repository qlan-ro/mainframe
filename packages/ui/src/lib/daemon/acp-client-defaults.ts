import { getActiveDaemon } from './active-daemon';
import type { AcpSocketLike } from './acp-rpc-connection';

export function defaultUrl(profile: string): string {
  const target = getActiveDaemon();
  const base = `${target.baseUrl.replace(/^http/, 'ws')}/acp/${encodeURIComponent(profile)}`;
  return target.token ? `${base}?token=${encodeURIComponent(target.token)}` : base;
}

export function defaultSocketFactory(url: string): AcpSocketLike {
  return new WebSocket(url) as unknown as AcpSocketLike;
}
