import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchRoutes } from '../../server/routes/launch.js';
import type { RouteContext } from '../../server/routes/types.js';

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

function extractHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

describe('launchRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
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
    const req: any = { params: { id: 'missing', name: 'server' }, body: { configuration: {} } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST start calls manager.start with configuration', async () => {
    const mockStart = vi.fn().mockResolvedValue(undefined);
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({ start: mockStart });
    const config = { name: 'server', runtimeExecutable: 'node', runtimeArgs: [], port: 3000, url: null };
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'server' }, body: { configuration: config } };
    const res = mockRes();
    await handler(req, res);
    expect(mockStart).toHaveBeenCalledWith(config);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST start returns 400 when route name does not match configuration name', async () => {
    const config = { name: 'server', runtimeExecutable: 'node', runtimeArgs: [], port: 3000, url: null };
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'different-name' }, body: { configuration: config } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
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
