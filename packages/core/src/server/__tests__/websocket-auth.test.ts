import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { DevicesRepository } from '../../db/devices.js';
import { generateToken } from '../../auth/token.js';
import { WebSocketManager, isWsAuthRequired } from '../websocket.js';
import type { ChatManager } from '../../chat/index.js';

describe('isWsAuthRequired', () => {
  it('requires auth for non-localhost when secret is set', () => {
    expect(isWsAuthRequired('192.168.1.100', 'test-secret')).toBe(true);
  });

  it('does not require auth for localhost', () => {
    expect(isWsAuthRequired('127.0.0.1', 'test-secret')).toBe(false);
    expect(isWsAuthRequired('::1', 'test-secret')).toBe(false);
    expect(isWsAuthRequired('::ffff:127.0.0.1', 'test-secret')).toBe(false);
  });

  it('does not require auth when no secret is configured', () => {
    expect(isWsAuthRequired('192.168.1.100', null)).toBe(false);
  });
});

describe('WebSocket upgrade auth', () => {
  const SECRET = 'test-secret';
  let server: Server;
  let manager: WebSocketManager;
  let port: number;
  let db: Database.Database;
  let devices: DevicesRepository;

  beforeEach(async () => {
    process.env.AUTH_TOKEN_SECRET = SECRET;
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE devices (
        device_id TEXT PRIMARY KEY, device_name TEXT NOT NULL, created_at TEXT NOT NULL,
        last_seen TEXT, auth_epoch INTEGER NOT NULL DEFAULT 0
      )
    `);
    devices = new DevicesRepository(db);
    server = createServer();
    manager = new WebSocketManager(server, {} as ChatManager, undefined, undefined, devices);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    manager.close();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    delete process.env.AUTH_TOKEN_SECRET;
  });

  it('rejects upgrade for unknown device (non-localhost)', async () => {
    const token = generateToken(SECRET, 'mobile-ghost', 1);
    await expect(connectWs(port, token, '2.2.2.2')).rejects.toThrow(/401/);
  });

  it('rejects upgrade for stale epoch (non-localhost)', async () => {
    devices.add('mobile-1', 'iPhone');
    const oldEpoch = devices.incrementAuthEpoch('mobile-1');
    devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', oldEpoch);
    await expect(connectWs(port, token, '2.2.2.2')).rejects.toThrow(/401/);
  });

  it('accepts upgrade for valid token (non-localhost)', async () => {
    devices.add('mobile-1', 'iPhone');
    const epoch = devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', epoch);
    const ws = await connectWs(port, token, '2.2.2.2');
    ws.close();
  });
});

function connectWs(port: number, token: string, xff?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (xff) headers['x-forwarded-for'] = xff;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`${res.statusCode}`)));
    ws.once('error', reject);
  });
}
