import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { tunnelRoutes } from '../tunnel.js';
import type { RouteContext } from '../types.js';
import type { TunnelManager } from '../../../tunnel/tunnel-manager.js';

vi.mock('../../../config.js', () => ({
  saveConfig: vi.fn(),
  getConfig: vi.fn(() => ({})),
}));

import { saveConfig, getConfig } from '../../../config.js';

const mockSaveConfig = vi.mocked(saveConfig);
const mockGetConfig = vi.mocked(getConfig);

function makeMockTunnelManager(initialUrl: string | null = null, verifyResult = true) {
  let url: string | null = initialUrl;
  return {
    getUrl: vi.fn((_label: string) => url),
    start: vi.fn(async (_port: number, _label: string, _opts?: unknown): Promise<string> => {
      url = 'https://test-tunnel.trycloudflare.com';
      return url;
    }),
    stop: vi.fn((_label: string) => {
      url = null;
    }),
    verify: vi.fn(async (_label: string) => verifyResult),
  } as unknown as TunnelManager & {
    getUrl: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
}

function makeApp(ctx: Partial<RouteContext>) {
  const app = express();
  app.use(express.json());
  app.use(tunnelRoutes(ctx as RouteContext));
  return app;
}

describe('tunnel routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({} as any);
  });

  describe('GET /api/tunnel/status', () => {
    it('returns running=false, url=null, verified=false when no tunnel is active', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      const app = makeApp({ tunnelManager, port: 31415, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).get('/api/tunnel/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.running).toBe(false);
      expect(res.body.data.url).toBeNull();
      expect(res.body.data.verified).toBe(false);
      expect(tunnelManager.verify).not.toHaveBeenCalled();
    });

    it('returns running=true, verified=true when tunnel is active and reachable', async () => {
      const tunnelManager = makeMockTunnelManager('https://active-tunnel.trycloudflare.com', true);
      const app = makeApp({ tunnelManager, port: 31415, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).get('/api/tunnel/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.running).toBe(true);
      expect(res.body.data.url).toBe('https://active-tunnel.trycloudflare.com');
      expect(res.body.data.verified).toBe(true);
      expect(tunnelManager.verify).toHaveBeenCalledWith('daemon');
    });

    it('returns running=true, verified=false when tunnel is active but unreachable', async () => {
      const tunnelManager = makeMockTunnelManager('https://active-tunnel.trycloudflare.com', false);
      const app = makeApp({ tunnelManager, port: 31415, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).get('/api/tunnel/status');

      expect(res.status).toBe(200);
      expect(res.body.data.running).toBe(true);
      expect(res.body.data.verified).toBe(false);
    });

    it('returns running=false and verified=false when no tunnelManager is provided', async () => {
      const app = makeApp({ port: 31415, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).get('/api/tunnel/status');

      expect(res.status).toBe(200);
      expect(res.body.data.running).toBe(false);
      expect(res.body.data.url).toBeNull();
      expect(res.body.data.verified).toBe(false);
    });
  });

  describe('GET /api/tunnel/config', () => {
    it('returns hasToken=false and url=null when no config', async () => {
      mockGetConfig.mockReturnValue({ port: 31415, dataDir: '/tmp' });
      const app = makeApp({
        tunnelManager: makeMockTunnelManager(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).get('/api/tunnel/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasToken).toBe(false);
      expect(res.body.data.url).toBeNull();
    });

    it('returns hasToken=true and url when token is configured', async () => {
      mockGetConfig.mockReturnValue({
        port: 31415,
        dataDir: '/tmp',
        tunnelToken: 'eyJhIjoiZXhhbXBsZSJ9',
        tunnelUrl: 'https://mainframe.example.com',
      });
      const app = makeApp({
        tunnelManager: makeMockTunnelManager(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).get('/api/tunnel/config');

      expect(res.status).toBe(200);
      expect(res.body.data.hasToken).toBe(true);
      expect(res.body.data.url).toBe('https://mainframe.example.com');
    });
  });

  describe('POST /api/tunnel/start', () => {
    it('starts ephemeral tunnel and returns URL (no body)', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      const setTunnelUrl = vi.fn();
      const app = makeApp({
        tunnelManager,
        setTunnelUrl,
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).post('/api/tunnel/start');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBe('https://test-tunnel.trycloudflare.com');
      expect(tunnelManager.start).toHaveBeenCalledWith(31415, 'daemon', undefined);
      expect(mockSaveConfig).toHaveBeenCalledWith({ tunnel: true });
    });

    it('starts named tunnel with token and url', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      tunnelManager.start.mockResolvedValue('https://mainframe.example.com');
      const setTunnelUrl = vi.fn();
      const app = makeApp({
        tunnelManager,
        setTunnelUrl,
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app)
        .post('/api/tunnel/start')
        .send({ token: 'my-cf-token', url: 'https://mainframe.example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBe('https://mainframe.example.com');
      expect(tunnelManager.start).toHaveBeenCalledWith(31415, 'daemon', {
        token: 'my-cf-token',
        url: 'https://mainframe.example.com',
      });
      expect(mockSaveConfig).toHaveBeenCalledWith({
        tunnel: true,
        tunnelToken: 'my-cf-token',
        tunnelUrl: 'https://mainframe.example.com',
      });
    });

    it('calls setTunnelUrl with the new URL after starting', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      const setTunnelUrl = vi.fn();
      const app = makeApp({
        tunnelManager,
        setTunnelUrl,
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      await request(app).post('/api/tunnel/start');

      expect(setTunnelUrl).toHaveBeenCalledWith('https://test-tunnel.trycloudflare.com');
    });

    it('returns existing URL without restarting if tunnel is already running (no token)', async () => {
      const tunnelManager = makeMockTunnelManager('https://already-running.trycloudflare.com');
      const app = makeApp({
        tunnelManager,
        setTunnelUrl: vi.fn(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).post('/api/tunnel/start');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBe('https://already-running.trycloudflare.com');
      expect(tunnelManager.start).not.toHaveBeenCalled();
    });

    it('replaces existing tunnel when a token is provided', async () => {
      const tunnelManager = makeMockTunnelManager('https://already-running.trycloudflare.com');
      tunnelManager.start.mockResolvedValue('https://mainframe.example.com');
      const setTunnelUrl = vi.fn();
      const app = makeApp({
        tunnelManager,
        setTunnelUrl,
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app)
        .post('/api/tunnel/start')
        .send({ token: 'my-cf-token', url: 'https://mainframe.example.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.url).toBe('https://mainframe.example.com');
      expect(tunnelManager.start).toHaveBeenCalledWith(31415, 'daemon', {
        token: 'my-cf-token',
        url: 'https://mainframe.example.com',
      });
      expect(setTunnelUrl).toHaveBeenCalledWith('https://mainframe.example.com');
    });

    it('returns 500 when tunnel start throws an error', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      tunnelManager.start.mockRejectedValue(new Error('cloudflared not found'));
      const app = makeApp({
        tunnelManager,
        setTunnelUrl: vi.fn(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).post('/api/tunnel/start');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('cloudflared not found');
    });

    it('returns 500 with generic message when error is not an Error instance', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      tunnelManager.start.mockRejectedValue('unexpected string error');
      const app = makeApp({
        tunnelManager,
        setTunnelUrl: vi.fn(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).post('/api/tunnel/start');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to start tunnel');
    });

    it('returns 400 when tunnelManager is not available', async () => {
      const app = makeApp({ port: 31415, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).post('/api/tunnel/start');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Tunnel not available');
    });

    it('returns 400 when port is not set', async () => {
      const tunnelManager = makeMockTunnelManager(null);
      const app = makeApp({ tunnelManager, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).post('/api/tunnel/start');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Tunnel not available');
    });
  });

  describe('POST /api/tunnel/stop', () => {
    it('stops the tunnel and returns success', async () => {
      const tunnelManager = makeMockTunnelManager('https://active-tunnel.trycloudflare.com');
      const setTunnelUrl = vi.fn();
      const app = makeApp({
        tunnelManager,
        setTunnelUrl,
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).post('/api/tunnel/stop');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(tunnelManager.stop).toHaveBeenCalledWith('daemon');
    });

    it('calls setTunnelUrl with null after stopping', async () => {
      const tunnelManager = makeMockTunnelManager('https://active-tunnel.trycloudflare.com');
      const setTunnelUrl = vi.fn();
      const app = makeApp({
        tunnelManager,
        setTunnelUrl,
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      await request(app).post('/api/tunnel/stop');

      expect(setTunnelUrl).toHaveBeenCalledWith(null);
    });

    it('calls saveConfig with tunnel=false after stopping', async () => {
      const tunnelManager = makeMockTunnelManager('https://active-tunnel.trycloudflare.com');
      const app = makeApp({
        tunnelManager,
        setTunnelUrl: vi.fn(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      await request(app).post('/api/tunnel/stop');

      expect(mockSaveConfig).toHaveBeenCalledWith({ tunnel: false });
    });

    it('clears token and url config when clearConfig=true', async () => {
      const tunnelManager = makeMockTunnelManager('https://active-tunnel.trycloudflare.com');
      const app = makeApp({
        tunnelManager,
        setTunnelUrl: vi.fn(),
        port: 31415,
        db: {} as any,
        chats: {} as any,
        adapters: {} as any,
      });

      const res = await request(app).post('/api/tunnel/stop').send({ clearConfig: true });

      expect(res.status).toBe(200);
      expect(mockSaveConfig).toHaveBeenCalledWith({
        tunnel: false,
        tunnelToken: undefined,
        tunnelUrl: undefined,
      });
    });

    it('returns 400 when tunnelManager is not available', async () => {
      const app = makeApp({ port: 31415, db: {} as any, chats: {} as any, adapters: {} as any });

      const res = await request(app).post('/api/tunnel/stop');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Tunnel not available');
    });
  });
});
