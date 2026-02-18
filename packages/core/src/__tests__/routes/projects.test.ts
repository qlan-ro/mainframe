import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectRoutes } from '../../server/routes/projects.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: {
        list: vi.fn(),
        get: vi.fn(),
        getByPath: vi.fn(),
        create: vi.fn(),
        remove: vi.fn(),
        removeWithChats: vi.fn(),
        updateLastOpened: vi.fn(),
      },
      chats: { list: vi.fn(), getModifiedFilesList: vi.fn() },
      settings: { get: vi.fn(), getByCategory: vi.fn(), set: vi.fn(), delete: vi.fn() },
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

function extractHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

describe('projectRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/projects', () => {
    it('returns project list', () => {
      const projects = [{ id: '1', path: '/a', name: 'A' }];
      (ctx.db.projects.list as any).mockReturnValue(projects);

      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects');
      const res = mockRes();

      handler({ params: {}, query: {} }, res, vi.fn());

      expect(ctx.db.projects.list).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: projects });
    });
  });

  describe('GET /api/projects/:id', () => {
    it('returns project by id', () => {
      const project = { id: 'p1', path: '/a', name: 'A' };
      (ctx.db.projects.get as any).mockReturnValue(project);

      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:id');
      const res = mockRes();

      handler({ params: { id: 'p1' }, query: {} }, res, vi.fn());

      expect(ctx.db.projects.get).toHaveBeenCalledWith('p1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
    });

    it('returns 404 for unknown project', () => {
      (ctx.db.projects.get as any).mockReturnValue(undefined);

      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:id');
      const res = mockRes();

      handler({ params: { id: 'unknown' }, query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Project not found' });
    });
  });

  describe('POST /api/projects', () => {
    it('creates a new project', () => {
      const created = { id: 'new-1', path: '/new', name: 'New' };
      (ctx.db.projects.getByPath as any).mockReturnValue(undefined);
      (ctx.db.projects.create as any).mockReturnValue(created);

      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/projects');
      const res = mockRes();

      handler({ params: {}, query: {}, body: { path: '/new', name: 'New' } }, res, vi.fn());

      expect(ctx.db.projects.create).toHaveBeenCalledWith('/new', 'New');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: created });
    });

    it('rejects missing path', () => {
      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/projects');
      const res = mockRes();

      handler({ params: {}, query: {}, body: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns existing project and updates lastOpened when path already exists', () => {
      const existing = { id: 'existing-1', path: '/exists', name: 'Exists' };
      (ctx.db.projects.getByPath as any).mockReturnValue(existing);

      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/projects');
      const res = mockRes();

      handler({ params: {}, query: {}, body: { path: '/exists' } }, res, vi.fn());

      expect(ctx.db.projects.updateLastOpened).toHaveBeenCalledWith('existing-1');
      expect(ctx.db.projects.create).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: existing });
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('removes project and associated chats', () => {
      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/projects/:id');
      const res = mockRes();

      handler({ params: { id: 'p1' }, query: {} }, res, vi.fn());

      expect(ctx.db.projects.removeWithChats).toHaveBeenCalledWith('p1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
