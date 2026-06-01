import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { contentSearchRoutes } from '../search.js';
import type { RouteContext } from '../types.js';

/**
 * Minimal RouteContext stub. handleContentSearch only uses:
 *   ctx.db.projects.get(id)   — via getEffectivePath
 *   ctx.chats.getChat(chatId) — via getEffectivePath (chatId path, not exercised here)
 */
function makeApp(projectPath: string | null = null) {
  const app = express();
  app.use(express.json());
  const ctx = {
    db: {
      projects: {
        get: (_id: string) => (projectPath !== null ? { path: projectPath } : null),
      },
    },
    chats: {
      getChat: (_chatId: string) => null,
    },
  } as unknown as RouteContext;
  app.use(contentSearchRoutes(ctx));
  return app;
}

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-search-envelope-'));
  await writeFile(join(projectDir, 'sample.txt'), 'hello world\n');
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('content search routes', () => {
  it('returns 404 with canonical envelope when project is not found', async () => {
    const app = makeApp(null);
    const res = await request(app).get('/api/projects/missing/search/content?q=hello&path=.');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns 200 with canonical envelope for a valid search', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get(
      `/api/projects/p1/search/content?q=hello&path=${encodeURIComponent('sample.txt')}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { results: expect.any(Array) } });
  });

  it('returns 403 with canonical envelope when path is outside project', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get(`/api/projects/p1/search/content?q=hello&path=${encodeURIComponent('../etc')}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Path outside project' });
  });

  it('returns 400 with canonical envelope when query is too short', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/search/content?q=a&path=.');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: expect.any(String) });
  });
});
