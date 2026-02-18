import { describe, it, expect, vi, beforeEach } from 'vitest';
import { skillRoutes } from '../../server/routes/skills.js';
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

describe('skillRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/adapters/:adapterId/skills', () => {
    it('returns skills list', async () => {
      const skills = [{ id: 's1', name: 'commit' }];
      const adapter = { listSkills: vi.fn().mockResolvedValue(skills) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/skills');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: { projectPath: '/my/project' } }, res, vi.fn());
      await flushPromises();

      expect(adapter.listSkills).toHaveBeenCalledWith('/my/project');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: skills });
    });

    it('returns 404 when adapter not found', async () => {
      (ctx.adapters.get as any).mockReturnValue(undefined);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/skills');
      const res = mockRes();

      handler({ params: { adapterId: 'nope' }, query: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Adapter not found or does not support skills',
      });
    });

    it('returns 400 when projectPath is missing', async () => {
      const adapter = { listSkills: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/skills');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'projectPath is required',
      });
    });
  });

  describe('POST /api/adapters/:adapterId/skills', () => {
    it('creates a skill', async () => {
      const skill = { id: 's2', name: 'review' };
      const adapter = { createSkill: vi.fn().mockResolvedValue(skill) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/skills');
      const res = mockRes();

      handler(
        {
          params: { adapterId: 'claude' },
          query: {},
          body: { projectPath: '/p', name: 'review', content: 'do review' },
        },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(adapter.createSkill).toHaveBeenCalledWith('/p', {
        name: 'review',
        displayName: 'review',
        description: '',
        content: 'do review',
        scope: 'project',
      });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: skill });
    });

    it('returns 400 when projectPath or name missing', async () => {
      const adapter = { createSkill: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/skills');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when createSkill throws', async () => {
      const adapter = { createSkill: vi.fn().mockRejectedValue(new Error('fail')) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/adapters/:adapterId/skills');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { projectPath: '/p', name: 'x' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Operation failed' });
    });
  });

  describe('PUT /api/adapters/:adapterId/skills/:id', () => {
    it('updates a skill', async () => {
      const updated = { id: 's1', name: 'commit', content: 'updated' };
      const adapter = { updateSkill: vi.fn().mockResolvedValue(updated) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler(
        {
          params: { adapterId: 'claude', id: 's1' },
          query: {},
          body: { projectPath: '/p', content: 'updated' },
        },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(adapter.updateSkill).toHaveBeenCalledWith('s1', '/p', 'updated');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
    });

    it('returns 400 when projectPath or content missing', async () => {
      const adapter = { updateSkill: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 's1' }, query: {}, body: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('decodes URL-encoded skill id', async () => {
      const adapter = { updateSkill: vi.fn().mockResolvedValue({}) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler(
        {
          params: { adapterId: 'claude', id: 'my%2Fskill' },
          query: {},
          body: { projectPath: '/p', content: 'x' },
        },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(adapter.updateSkill).toHaveBeenCalledWith('my/skill', '/p', 'x');
    });
  });

  describe('DELETE /api/adapters/:adapterId/skills/:id', () => {
    it('deletes a skill via query param', async () => {
      const adapter = { deleteSkill: vi.fn().mockResolvedValue(undefined) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 's1' }, query: { projectPath: '/p' }, body: {} }, res, vi.fn());
      await flushPromises();

      expect(adapter.deleteSkill).toHaveBeenCalledWith('s1', '/p');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('deletes a skill via body param', async () => {
      const adapter = { deleteSkill: vi.fn().mockResolvedValue(undefined) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 's1' }, query: {}, body: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(adapter.deleteSkill).toHaveBeenCalledWith('s1', '/p');
    });

    it('returns 400 when projectPath missing', async () => {
      const adapter = { deleteSkill: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 's1' }, query: {}, body: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when deleteSkill throws', async () => {
      const adapter = { deleteSkill: vi.fn().mockRejectedValue(new Error('fail')) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const router = skillRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/adapters/:adapterId/skills/:id');
      const res = mockRes();

      handler({ params: { adapterId: 'claude', id: 's1' }, query: { projectPath: '/p' }, body: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
