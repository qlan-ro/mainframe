import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchRoutes } from '../../server/routes/launch.js';
import type { RouteContext } from '../../server/routes/types.js';

// Mock fs/promises — the start handler reads launch.json from disk
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
const mockReadFile = vi.mocked(readFile);

const VALID_LAUNCH_JSON = JSON.stringify({
  version: '0.1.0',
  configurations: [
    { name: 'server', runtimeExecutable: 'node', runtimeArgs: ['index.js'], port: 3000, url: null },
    { name: 'worker', runtimeExecutable: 'node', runtimeArgs: ['worker.js'], port: null, url: null },
  ],
});

function createMockContext(): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', path: '/tmp/proj' }),
      },
    } as any,
    chats: {} as any,
    adapters: {} as any,
    launchRegistry: {
      getOrCreate: vi.fn().mockReturnValue({
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        getStatus: vi.fn().mockReturnValue('stopped'),
        getAllStatuses: vi.fn().mockReturnValue({}),
      }),
    } as any,
  };
}

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return res;
}

/** asyncHandler doesn't return a promise — flush all pending microtasks before asserting. */
const tick = () => new Promise((r) => setTimeout(r, 0));

function extractHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

describe('launchRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
    mockReadFile.mockReset();
  });

  it('GET /api/projects/:id/launch/status returns all statuses', async () => {
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({
      getAllStatuses: vi.fn().mockReturnValue({ server: 'running' }),
    });
    const handler = extractHandler(launchRoutes(ctx), 'get', '/api/projects/:id/launch/status');
    const req: any = { params: { id: 'proj-1' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { server: 'running' } });
  });

  it('POST start returns 404 when project not found', async () => {
    (ctx.db.projects.get as any).mockReturnValue(undefined);
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'missing', name: 'server' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST start reads launch.json from disk and calls manager.start', async () => {
    mockReadFile.mockResolvedValue(VALID_LAUNCH_JSON);
    const mockStart = vi.fn().mockResolvedValue(undefined);
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({ start: mockStart });
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'server' } };
    const res = mockRes();
    handler(req, res, vi.fn());
    await tick();
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/proj/.mainframe/launch.json', 'utf-8');
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'server', runtimeExecutable: 'node' }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST start returns 404 when launch.json does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'server' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('POST start returns 404 when config name not found in launch.json', async () => {
    mockReadFile.mockResolvedValue(VALID_LAUNCH_JSON);
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'nonexistent' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('POST start returns 400 when launch.json is invalid', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '0.1.0', configurations: [] }));
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'server' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST stop calls manager.stop', async () => {
    const mockStop = vi.fn();
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({ stop: mockStop });
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/stop');
    const req: any = { params: { id: 'proj-1', name: 'server' } };
    const res = mockRes();
    await handler(req, res);
    expect(mockStop).toHaveBeenCalledWith('server');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
