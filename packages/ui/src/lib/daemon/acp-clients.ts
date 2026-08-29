/**
 * Shared `AcpFacadeClient` registry — one connection per adapter profile,
 * multiplexing every chat of that adapter. Controllers resolve their client
 * by the chat's `adapterId` (known once the config seeds) and never own the
 * connection lifecycle: the client reconnects itself and fires its gap
 * listeners, on which each attached session re-resumes.
 */
import { AcpFacadeClient } from './acp-client';

const clients = new Map<string, AcpFacadeClient>();

export function getAcpFacadeClient(profile: string): AcpFacadeClient {
  const existing = clients.get(profile);
  if (existing) return existing;
  const client = new AcpFacadeClient(profile);
  clients.set(profile, client);
  return client;
}

/** Test hook: drop every cached client (disconnecting each). */
export function resetAcpFacadeClients(): void {
  for (const client of clients.values()) client.disconnect();
  clients.clear();
}
