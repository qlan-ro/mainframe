import { spawn } from 'node:child_process';
import { JsonRpcClient } from './jsonrpc.js';
import type { InitializeResult } from './types.js';

/**
 * Spawn a stateless `codex app-server` subprocess and complete the
 * `initialize`/`initialized` handshake. Used for one-off RPCs (model listing,
 * quota pulls) that don't need a live chat session. Caller owns the returned
 * client and must `close()` it when done.
 */
export async function spawnTempAppServer(executable: string): Promise<JsonRpcClient> {
  const child = spawn(executable, ['app-server'], {
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });

  const client = new JsonRpcClient(child, {
    onNotification: () => {},
    onRequest: () => {},
    onError: () => {},
    onExit: () => {},
  });

  await client.request<InitializeResult>('initialize', {
    clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
  });
  client.notify('initialized');

  return client;
}
