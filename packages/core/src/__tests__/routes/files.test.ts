import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileRoutes } from '../../server/routes/files.js';
import type { RouteContext } from '../../server/routes/types.js';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => actual.homedir()) };
});

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 50));

let projectDir: string;

function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  return res;
}

function createCtx(path: string): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path }),
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
  projectDir = await mkdtemp(join(tmpdir(), 'mf-files-test-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('GET /api/projects/:id/tree', () => {
  it('returns file and directory entries', async () => {
    await mkdir(join(projectDir, 'src'));
    await writeFile(join(projectDir, 'README.md'), '# Hello');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'src', type: 'directory' }),
        expect.objectContaining({ name: 'README.md', type: 'file' }),
      ]),
    );
  });

  it('rejects path traversal with 403', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '../../etc' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('filters out node_modules from listing', async () => {
    await mkdir(join(projectDir, 'node_modules'));
    await mkdir(join(projectDir, 'src'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    const entries = res.json.mock.calls[0][0] as Array<{ name: string }>;
    expect(entries.find((e) => e.name === 'node_modules')).toBeUndefined();
    expect(entries.find((e) => e.name === 'src')).toBeDefined();
  });
});

describe('GET /api/projects/:id/search/files', () => {
  it('returns empty array for empty query', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: '' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('finds files by name', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'main.ts'), '');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'main' } }, res, vi.fn());
    await flushPromises();

    const results = res.json.mock.calls[0][0] as Array<{ name: string }>;
    expect(results.some((r) => r.name === 'main.ts')).toBe(true);
  });
});

describe('GET /api/filesystem/browse', () => {
  afterEach(() => {
    vi.mocked(homedir).mockReset();
  });

  it('returns subdirectories of the given path', async () => {
    await mkdir(join(projectDir, 'alpha'));
    await mkdir(join(projectDir, 'beta'));
    await writeFile(join(projectDir, 'file.txt'), 'hello');

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: projectDir } } as any, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith({
      path: projectDir,
      entries: [
        { name: 'alpha', path: expect.stringContaining('alpha') },
        { name: 'beta', path: expect.stringContaining('beta') },
      ],
    });
  });

  it('hides dotfiles and ignored dirs', async () => {
    await mkdir(join(projectDir, '.hidden'));
    await mkdir(join(projectDir, 'node_modules'));
    await mkdir(join(projectDir, 'visible'));

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: projectDir } } as any, res, vi.fn());
    await flushPromises();

    const result = res.json.mock.calls[0][0];
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('visible');
  });

  it('returns 404 for non-existent directory', async () => {
    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: join(projectDir, 'nonexistent') } } as any, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects paths outside home directory', async () => {
    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: '/etc' } } as any, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('GET /api/projects/:id/files', () => {
  it('returns file content', async () => {
    await writeFile(join(projectDir, 'hello.txt'), 'world');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: 'hello.txt' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: 'world' }));
  });

  it('rejects path traversal with 403', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '../../etc/passwd' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
