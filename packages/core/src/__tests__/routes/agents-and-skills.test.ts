import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentRoutes } from '../../server/routes/agents.js';
import type { RouteContext } from '../../server/routes/types.js';
import { flushPromises, createMockContext, mockRes, extractHandler, RESOURCES } from './agents-and-skills.fixtures.js';

// Merged from the former routes/agents.test.ts + routes/skills.test.ts — the
// two route sets are structural clones (CRUD over adapter.list/create/update/
// deleteAgent|Skill), parameterized here over one `ResourceConfig` per
// resource so each behavior is written once and exercised for both.

describe.each(RESOURCES)('$label routes', (r) => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET list', () => {
    it('returns the list from the adapter', async () => {
      const adapter = { [r.listMethod]: vi.fn().mockResolvedValue(r.sampleList) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'get', `/api/adapters/:adapterId/${r.segment}`);
      const res = mockRes();
      handler({ params: { adapterId: 'claude' }, query: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect((adapter as any)[r.listMethod]).toHaveBeenCalledWith('/p');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: r.sampleList });
    });

    it('returns 404 when adapter not found', async () => {
      (ctx.adapters.get as any).mockReturnValue(undefined);

      const handler = extractHandler(r.routes(ctx), 'get', `/api/adapters/:adapterId/${r.segment}`);
      const res = mockRes();
      handler({ params: { adapterId: 'nope' }, query: { projectPath: '/p' } }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(404);
      if (r.notFoundBody) expect(res.json).toHaveBeenCalledWith(r.notFoundBody);
    });

    it('returns 400 when projectPath missing', async () => {
      const adapter = { [r.listMethod]: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'get', `/api/adapters/:adapterId/${r.segment}`);
      const res = mockRes();
      handler({ params: { adapterId: 'claude' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
      if (r.missingProjectPathBody) expect(res.json).toHaveBeenCalledWith(r.missingProjectPathBody);
    });
  });

  describe('POST create', () => {
    it('creates via the adapter with resource-specific defaults', async () => {
      const adapter = { [r.createMethod]: vi.fn().mockResolvedValue(r.createdItem) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'post', `/api/adapters/:adapterId/${r.segment}`);
      const res = mockRes();
      handler({ params: { adapterId: 'claude' }, query: {}, body: r.createBody }, res, vi.fn());
      await flushPromises();

      expect((adapter as any)[r.createMethod]).toHaveBeenCalledWith(...r.createExpectedArgs);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: r.createdItem });
    });

    it('returns 400 when required fields are missing', async () => {
      const adapter = { [r.createMethod]: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'post', `/api/adapters/:adapterId/${r.segment}`);
      const res = mockRes();
      handler({ params: { adapterId: 'claude' }, query: {}, body: r.createMissingBody }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when create throws', async () => {
      const adapter = { [r.createMethod]: vi.fn().mockRejectedValue(new Error('fail')) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'post', `/api/adapters/:adapterId/${r.segment}`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude' }, query: {}, body: { ...r.createMissingBody, name: 'x' } },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(500);
      if (r.createThrowBody) expect(res.json).toHaveBeenCalledWith(r.createThrowBody);
    });
  });

  describe('PUT update', () => {
    it('updates via the adapter', async () => {
      const adapter = { [r.updateMethod]: vi.fn().mockResolvedValue(r.updatedItem) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'put', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude', id: r.updateExpectedArgs[0] }, query: {}, body: r.updateBody },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect((adapter as any)[r.updateMethod]).toHaveBeenCalledWith(...r.updateExpectedArgs);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: r.updatedItem });
    });

    it('returns 400 when content is missing', async () => {
      const adapter = { [r.updateMethod]: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'put', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude', id: r.updateExpectedArgs[0] }, query: {}, body: r.updateMissingBody },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('decodes a URL-encoded id', async () => {
      const adapter = { [r.updateMethod]: vi.fn().mockResolvedValue({}) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'put', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude', id: r.encodedId }, query: {}, body: { projectPath: '/p', content: 'c' } },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect((adapter as any)[r.updateMethod]).toHaveBeenCalledWith(r.decodedId, '/p', 'c');
    });
  });

  describe('DELETE', () => {
    it('deletes via query projectPath', async () => {
      const adapter = { [r.deleteMethod]: vi.fn().mockResolvedValue(undefined) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'delete', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude', id: r.updateExpectedArgs[0] }, query: { projectPath: '/p' }, body: {} },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect((adapter as any)[r.deleteMethod]).toHaveBeenCalledWith(r.updateExpectedArgs[0], '/p');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('deletes via body projectPath', async () => {
      const adapter = { [r.deleteMethod]: vi.fn().mockResolvedValue(undefined) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'delete', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude', id: r.updateExpectedArgs[0] }, query: {}, body: { projectPath: '/p' } },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect((adapter as any)[r.deleteMethod]).toHaveBeenCalledWith(r.updateExpectedArgs[0], '/p');
    });

    it('returns 400 when projectPath missing from both query and body', async () => {
      const adapter = { [r.deleteMethod]: vi.fn() };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'delete', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler({ params: { adapterId: 'claude', id: r.updateExpectedArgs[0] }, query: {}, body: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when delete throws', async () => {
      const adapter = { [r.deleteMethod]: vi.fn().mockRejectedValue(new Error('fail')) };
      (ctx.adapters.get as any).mockReturnValue(adapter);

      const handler = extractHandler(r.routes(ctx), 'delete', `/api/adapters/:adapterId/${r.segment}/:id`);
      const res = mockRes();
      handler(
        { params: { adapterId: 'claude', id: r.updateExpectedArgs[0] }, query: { projectPath: '/p' }, body: {} },
        res,
        vi.fn(),
      );
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(500);
      if (r.createThrowBody) expect(res.json).toHaveBeenCalledWith(r.createThrowBody);
    });
  });
});

// Agent-only: POST /agents 404-adapter-not-found has no skill equivalent in
// the original suite (skillRoutes' POST path was never tested for this).
describe('agent routes — POST create (agent-only case)', () => {
  it('returns 404 when adapter not found', async () => {
    const ctx = createMockContext();
    (ctx.adapters.get as any).mockReturnValue(undefined);

    const handler = extractHandler(agentRoutes(ctx), 'post', '/api/adapters/:adapterId/agents');
    const res = mockRes();
    handler({ params: { adapterId: 'nope' }, query: {}, body: { projectPath: '/p', name: 'x' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
