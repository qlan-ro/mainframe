import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { launchRoutes } from '../launch.js';
import type { RouteContext } from '../types.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-launch-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function makeManager() {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getAllStatuses: vi.fn((): Record<string, string> => ({})),
    getOutputBuffer: vi.fn((_name: string): unknown[] => []),
  };
}

function makeApp(opts: { projectPath?: string | null; manager?: ReturnType<typeof makeManager> } = {}) {
  const { projectPath = projectDir, manager = makeManager() } = opts;
  const launchRegistry = {
    getOrCreate: vi.fn(() => manager),
    tunnelManager: undefined,
  };
  const ctx = {
    db: { projects: { get: (_id: string) => (projectPath !== null ? { path: projectPath } : null) } },
    chats: { getChat: (_chatId: string) => null },
    launchRegistry,
  } as unknown as RouteContext;
  const app = express();
  app.use(express.json());
  app.use(launchRoutes(ctx));
  return { app, launchRegistry, manager };
}

async function writeLaunchJson(configurations: unknown[]): Promise<void> {
  await mkdir(join(projectDir, '.mainframe'), { recursive: true });
  await writeFile(join(projectDir, '.mainframe', 'launch.json'), JSON.stringify({ version: '1.0', configurations }));
}

describe('GET /api/projects/:id/launch/configs', () => {
  it('returns 404 envelope when project is not found', async () => {
    const { app } = makeApp({ projectPath: null });
    const res = await request(app).get('/api/projects/p1/launch/configs');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns [] when launch.json does not exist', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/projects/p1/launch/configs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns parsed configurations from launch.json', async () => {
    await writeLaunchJson([{ name: 'web', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 3000 }]);
    const { app } = makeApp();
    const res = await request(app).get('/api/projects/p1/launch/configs');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { name: 'web', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 3000, url: null },
    ]);
  });

  it('returns 400 when launch.json fails schema validation', async () => {
    await writeLaunchJson([{ name: 'web', runtimeExecutable: 'node; rm -rf /' }]);
    const { app } = makeApp();
    const res = await request(app).get('/api/projects/p1/launch/configs');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns [] when launch.json is not valid JSON', async () => {
    await mkdir(join(projectDir, '.mainframe'), { recursive: true });
    await writeFile(join(projectDir, '.mainframe', 'launch.json'), '{not json');
    const { app } = makeApp();
    const res = await request(app).get('/api/projects/p1/launch/configs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });
});

describe('POST /api/projects/:id/launch/:name/start', () => {
  it('returns 404 when project is not found', async () => {
    const { app } = makeApp({ projectPath: null });
    const res = await request(app).post('/api/projects/p1/launch/web/start');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns 404 when launch.json does not exist', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/projects/p1/launch/web/start');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'No launch.json found for project' });
  });

  it('returns 404 when the named configuration is not in launch.json', async () => {
    await writeLaunchJson([{ name: 'web', runtimeExecutable: 'node' }]);
    const { app } = makeApp();
    const res = await request(app).post('/api/projects/p1/launch/db/start');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Configuration "db" not found in launch.json' });
  });

  it('starts the resolved configuration via the launch manager', async () => {
    await writeLaunchJson([{ name: 'web', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 3000 }]);
    const manager = makeManager();
    const { app, launchRegistry } = makeApp({ manager });
    const res = await request(app).post('/api/projects/p1/launch/web/start');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(launchRegistry.getOrCreate).toHaveBeenCalledWith('p1', projectDir);
    expect(manager.start).toHaveBeenCalledWith({
      name: 'web',
      runtimeExecutable: 'node',
      runtimeArgs: ['server.js'],
      port: 3000,
      url: null,
    });
  });

  it('returns 500 when the manager fails to start the process', async () => {
    await writeLaunchJson([{ name: 'web', runtimeExecutable: 'node' }]);
    const manager = makeManager();
    manager.start.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { app } = makeApp({ manager });
    const res = await request(app).post('/api/projects/p1/launch/web/start');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to start process' });
  });
});

describe('POST /api/projects/:id/launch/:name/stop', () => {
  it('returns 404 when project is not found', async () => {
    const { app } = makeApp({ projectPath: null });
    const res = await request(app).post('/api/projects/p1/launch/web/stop');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('stops the named process via the launch manager', async () => {
    const manager = makeManager();
    const { app } = makeApp({ manager });
    const res = await request(app).post('/api/projects/p1/launch/web/stop');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(manager.stop).toHaveBeenCalledWith('web');
  });
});

describe('GET /api/projects/:id/launch/status', () => {
  it('returns 404 when project is not found', async () => {
    const { app } = makeApp({ projectPath: null });
    const res = await request(app).get('/api/projects/p1/launch/status');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns statuses, empty tunnelUrls, and output buffers keyed by config name', async () => {
    const manager = makeManager();
    manager.getAllStatuses.mockReturnValue({ web: 'running', db: 'starting' });
    manager.getOutputBuffer.mockImplementation((name: string) => [{ stream: 'stdout', data: `${name}-log\n` }]);
    const { app } = makeApp({ manager });

    const res = await request(app).get('/api/projects/p1/launch/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        statuses: { web: 'running', db: 'starting' },
        tunnelUrls: {},
        effectivePath: projectDir,
        outputBuffer: {
          web: [{ stream: 'stdout', data: 'web-log\n' }],
          db: [{ stream: 'stdout', data: 'db-log\n' }],
        },
      },
    });
  });

  it('includes tunnel URLs for running processes when a tunnelManager is present', async () => {
    const manager = makeManager();
    manager.getAllStatuses.mockReturnValue({ web: 'running' });
    const getUrl = vi.fn((label: string) => (label === 'preview:web' ? 'https://web.trycloudflare.com' : null));
    const launchRegistry = {
      getOrCreate: vi.fn(() => manager),
      tunnelManager: { getUrl },
    };
    const ctx = {
      db: { projects: { get: () => ({ path: projectDir }) } },
      chats: { getChat: () => null },
      launchRegistry,
    } as unknown as RouteContext;
    const app = express();
    app.use(express.json());
    app.use(launchRoutes(ctx));

    const res = await request(app).get('/api/projects/p1/launch/status');

    expect(res.status).toBe(200);
    expect(res.body.data.tunnelUrls).toEqual({ web: 'https://web.trycloudflare.com' });
    expect(getUrl).toHaveBeenCalledWith('preview:web');
  });
});
