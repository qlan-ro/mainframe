import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentSearchRoutes } from '../../server/routes/search.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 50));

let projectDir: string;

function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

function createCtx(p: string): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: p }),
      },
      chats: {
        list: vi.fn().mockReturnValue([]),
      },
      settings: { get: vi.fn().mockReturnValue(null) },
    } as any,
    chats: { getChat: vi.fn().mockReturnValue(null), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-search-test-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('GET /api/projects/:id/search/content', () => {
  it('finds text in a single file', async () => {
    await writeFile(join(projectDir, 'notes.txt'), 'line one\nfind me here\nline three\n');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'find me', path: 'notes.txt' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({
            file: 'notes.txt',
            line: 2,
            column: 1,
            text: 'find me here',
          }),
        ]),
      }),
    );
    const { results } = res.json.mock.calls[0][0];
    expect(results).toHaveLength(1);
  });

  it('searches directory recursively', async () => {
    await mkdir(join(projectDir, 'src'));
    await writeFile(join(projectDir, 'src', 'alpha.ts'), 'const foo = 1;\n');
    await writeFile(join(projectDir, 'src', 'beta.ts'), 'export function foo() {}\n');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'foo', path: 'src' } }, res, vi.fn());
    await flushPromises();

    const { results } = res.json.mock.calls[0][0];
    const files = results.map((r: any) => r.file);
    expect(files).toContain('src/alpha.ts');
    expect(files).toContain('src/beta.ts');
  });

  it('rejects path traversal', async () => {
    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'test', path: '../../etc' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('returns 400 for too-short query', async () => {
    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'a', path: '.' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('skips binary files by extension', async () => {
    await writeFile(join(projectDir, 'app.class'), 'findme');
    await writeFile(join(projectDir, 'app.ts'), 'findme');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'findme', path: '.', includeIgnored: 'true' } }, res, vi.fn());
    await flushPromises();

    const { results } = res.json.mock.calls[0][0];
    const files = results.map((r: any) => r.file);
    expect(files).toContain('app.ts');
    expect(files).not.toContain('app.class');
  });

  it('case-insensitive matching', async () => {
    await writeFile(join(projectDir, 'readme.txt'), 'Hello World\n');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'hello', path: 'readme.txt' } }, res, vi.fn());
    await flushPromises();

    const { results } = res.json.mock.calls[0][0];
    expect(results).toHaveLength(1);
    expect(results[0].column).toBe(1);
    expect(results[0].text).toBe('Hello World');
  });
});
