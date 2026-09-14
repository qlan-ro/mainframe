/**
 * Shared `AcpFacadeClient` registry — one connection per (daemon, adapter
 * profile) pair, multiplexing every chat of that adapter on that daemon.
 * Controllers resolve their client by the chat's `adapterId` (known once
 * the config seeds) and never own the connection lifecycle: the client
 * reconnects itself and fires its gap listeners, on which each attached
 * session re-resumes. Keyed on `getActiveDaemon().id`, read at resolve
 * time, so a daemon switch (A → B) is never satisfied by A's cached
 * socket (R1.1) — `disposeDaemonSession()` also hard-clears the registry,
 * since a prompt sent mid-switch must go to the new daemon.
 */
import { AcpFacadeClient } from './acp-client';
import { getActiveDaemon } from './active-daemon';

const clients = new Map<string, AcpFacadeClient>();

function clientKey(profile: string): string {
  return `${getActiveDaemon().id}:${profile}`;
}

export function getAcpFacadeClient(profile: string): AcpFacadeClient {
  const key = clientKey(profile);
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new AcpFacadeClient(profile);
  clients.set(key, client);
  return client;
}

/** Drops every cached client (disconnecting each) — called on every daemon switch, and by tests. */
export function resetAcpFacadeClients(): void {
  for (const client of clients.values()) client.disconnect();
  clients.clear();
}
