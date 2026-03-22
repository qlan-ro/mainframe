import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { lspRoutes } from '../../server/routes/lsp-routes.js';
import { LspRegistry } from '../../lsp/lsp-registry.js';
import { LspManager } from '../../lsp/lsp-manager.js';

describe('GET /api/lsp/languages', () => {
  let app: express.Express;
  let manager: LspManager;

  beforeEach(() => {
    const registry = new LspRegistry();
    vi.spyOn(registry, 'resolveCommand').mockImplementation(async (id) => {
      if (id === 'typescript') return { command: 'node', args: ['--stdio'] };
      if (id === 'python') return { command: 'node', args: ['--stdio'] };
      return null; // java not installed
    });
    manager = new LspManager(registry);

    app = express();
    app.use(lspRoutes(manager));
  });

  it('returns language status with valid projectId', async () => {
    const res = await request(app)
      .get('/api/lsp/languages')
      .query({ projectId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(res.status).toBe(200);
    expect(res.body.languages).toHaveLength(3);

    const ts = res.body.languages.find((l: any) => l.id === 'typescript');
    expect(ts).toEqual({ id: 'typescript', installed: true, active: false });

    const java = res.body.languages.find((l: any) => l.id === 'java');
    expect(java).toEqual({ id: 'java', installed: false, active: false });
  });

  it('rejects missing projectId', async () => {
    const res = await request(app).get('/api/lsp/languages');
    expect(res.status).toBe(400);
  });

  it('rejects empty projectId', async () => {
    const res = await request(app).get('/api/lsp/languages').query({ projectId: '' });
    expect(res.status).toBe(400);
  });
});
