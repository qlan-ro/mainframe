import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentRoutes } from '../../server/routes/agents.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: { getChat: vi.fn(), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

describe('agentRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/adapters/:adapterId/agents', () => {
    it('returns agents list', async () => {
      const agents = [{ id: 'a1', name: 'builder' }];
      const adapter = { listAgents: vi.fn().mockResolvedValue(agents) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(adapter.listAgents).toHaveBeenCalledWith('/p');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: agents });
    });

    it('returns 404 when adapter not found', async () => {
      (ctx.adapters.get as any).mockReturnValue(undefined);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler({ params: { adapterId: 'nope' }, query: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when projectPath missing', async () => {
      const adapter = { listAgents: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('POST /api/adapters/:adapterId/agents', () => {
    it('creates an agent', async () => {
      const agent = { id: 'a2', name: 'reviewer' };
      const adapter = { createAgent: vi.fn().mockResolvedValue(agent) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler(
        {
          params: { adapterId: 'claude' },
          query: {},
          body: { projectPath: '/p', name: 'reviewer', description: 'Reviews code', content: 'review' },
        },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(adapter.createAgent).toHaveBeenCalledWith('/p', {
        name: 'reviewer',
        description: 'Reviews code',
        content: 'review',
        scope: 'project',
      });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: agent });
    });

    it('returns 404 when adapter not found', async () => {
      (ctx.adapters.get as any).mockReturnValue(undefined);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler({ params: { adapterId: 'nope' }, query: {}, body: { projectPath: '/p', name: 'x' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when projectPath or name missing', async () => {
      const adapter = { createAgent: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when createAgent throws', async () => {
      const adapter = { createAgent: vi.fn().mockRejectedValue(new Error('fail')) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/agents');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { projectPath: '/p', name: 'x' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('PUT /api/adapters/:adapterId/agents/:id', () => {
    it('updates an agent', async () => {
      const updated = { id: 'a1', content: 'new' };
      const adapter = { updateAgent: vi.fn().mockResolvedValue(updated) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler(
        {
          params: { adapterId: 'claude', id: 'a1' },
          query: {},
          body: { projectPath: '/p', content: 'new' },
        },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(adapter.updateAgent).toHaveBeenCalledWith('a1', '/p', 'new');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
    });

    it('returns 400 when content is undefined', async () => {
      const adapter = { updateAgent: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 'a1' }, query: {}, body: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('decodes URL-encoded agent id', async () => {
      const adapter = { updateAgent: vi.fn().mockResolvedValue({}) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler(
        {
          params: { adapterId: 'claude', id: 'my%2Fagent' },
          query: {},
          body: { projectPath: '/p', content: 'c' },
        },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(adapter.updateAgent).toHaveBeenCalledWith('my/agent', '/p', 'c');
    });
  });

  describe('DELETE /api/adapters/:adapterId/agents/:id', () => {
    it('deletes an agent via query projectPath', async () => {
      const adapter = { deleteAgent: vi.fn().mockResolvedValue(undefined) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 'a1' }, query: { projectPath: '/p' }, body: {} }, res, vi.fn());
      await flushPromises();

      expect(adapter.deleteAgent).toHaveBeenCalledWith('a1', '/p');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('deletes an agent via body projectPath', async () => {
      const adapter = { deleteAgent: vi.fn().mockResolvedValue(undefined) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 'a1' }, query: {}, body: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(adapter.deleteAgent).toHaveBeenCalledWith('a1', '/p');
    });

    it('returns 400 when projectPath missing from both query and body', async () => {
      const adapter = { deleteAgent: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 'a1' }, query: {}, body: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when deleteAgent throws', async () => {
      const adapter = { deleteAgent: vi.fn().mockRejectedValue(new Error('fail')) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = agentRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/agents/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 'a1' }, query: { projectPath: '/p' }, body: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
