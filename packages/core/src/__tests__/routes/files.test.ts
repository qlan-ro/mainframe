import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
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

  it('classifies a symlink to a directory as a directory', async () => {
    await mkdir(join(projectDir, 'real-dir'));
    await symlink(join(projectDir, 'real-dir'), join(projectDir, 'link-to-dir'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    const entries = res.json.mock.calls[0][0] as Array<{ name: string; type: string }>;
    const link = entries.find((e) => e.name === 'link-to-dir');
    expect(link).toBeDefined();
    expect(link?.type).toBe('directory');
  });

  it('classifies a symlink to a file as a file', async () => {
    await writeFile(join(projectDir, 'real-file.txt'), 'hi');
    await symlink(join(projectDir, 'real-file.txt'), join(projectDir, 'link-to-file'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    const entries = res.json.mock.calls[0][0] as Array<{ name: string; type: string }>;
    const link = entries.find((e) => e.name === 'link-to-file');
    expect(link).toBeDefined();
    expect(link?.type).toBe('file');
  });

  it('omits broken symlinks from the listing', async () => {
    await writeFile(join(projectDir, 'visible.txt'), '');
    await symlink(join(projectDir, 'does-not-exist'), join(projectDir, 'broken-link'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    const entries = res.json.mock.calls[0][0] as Array<{ name: string; type: string }>;
    expect(entries.find((e) => e.name === 'broken-link')).toBeUndefined();
    expect(entries.find((e) => e.name === 'visible.txt')).toBeDefined();
  });

  it('lists symlinks pointing outside the project, classified by target', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'mf-files-outside-'));
    try {
      await symlink(outsideDir, join(projectDir, 'outside-dir-link'));

      const ctx = createCtx(projectDir);
      const router = fileRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
      const res = mockRes();

      handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
      await flushPromises();

      const entries = res.json.mock.calls[0][0] as Array<{ name: string; type: string }>;
      const link = entries.find((e) => e.name === 'outside-dir-link');
      expect(link).toBeDefined();
      expect(link?.type).toBe('directory');
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('includes dotfiles and dotfolders in listing', async () => {
    await mkdir(join(projectDir, '.claude'));
    await writeFile(join(projectDir, '.env'), 'SECRET=x');
    await mkdir(join(projectDir, 'src'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    const entries = res.json.mock.calls[0][0] as Array<{ name: string }>;
    expect(entries.find((e) => e.name === '.claude')).toBeDefined();
    expect(entries.find((e) => e.name === '.env')).toBeDefined();
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

  it('surfaces gitignored config files and excludes binary files from search results', async () => {
    // .env.local is gitignored but should appear — file search uses useBuiltinIgnoreOnly
    // so env/config files surface even when listed in .gitignore
    await writeFile(join(projectDir, '.gitignore'), '.env.local\n');
    await writeFile(join(projectDir, 'app.ts'), '');
    await writeFile(join(projectDir, '.env.local'), 'SECRET=hunter2\n');
    await writeFile(join(projectDir, 'logo.png'), '');
    await writeFile(join(projectDir, 'font.woff2'), '');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    // query 'app' matches app.ts; query 'env' matches .env.local
    handler({ params: { id: 'proj-1' }, query: { q: 'env' } }, res, vi.fn());
    await flushPromises();

    const results = res.json.mock.calls[0][0];
    const names = results.map((r: any) => r.name);
    // gitignored config file should now surface
    expect(names).toContain('.env.local');
    expect(names).not.toContain('logo.png');
    expect(names).not.toContain('font.woff2');
  });

  it('filters binary/non-editable files (png, pdf, jpg, zip) even when name matches query', async () => {
    await mkdir(join(projectDir, 'assets'), { recursive: true });
    await writeFile(join(projectDir, 'assets', 'icon_108.png'), '');
    await writeFile(join(projectDir, 'assets', 'icon_324.jpg'), '');
    await writeFile(join(projectDir, 'assets', 'icon.svg'), '<svg/>');
    await writeFile(join(projectDir, 'assets', 'doc.pdf'), '');
    await writeFile(join(projectDir, 'assets', 'archive.zip'), '');
    await writeFile(join(projectDir, 'IconButton.tsx'), 'export {}');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'icon' } }, res, vi.fn());
    await flushPromises();

    const results = res.json.mock.calls[0][0];
    const names = results.map((r: any) => r.name);

    // Editable source file should surface
    expect(names).toContain('IconButton.tsx');
    // Binary / non-editable formats should not
    expect(names).not.toContain('icon_108.png');
    expect(names).not.toContain('icon_324.jpg');
    expect(names).not.toContain('icon.svg');
    expect(names).not.toContain('doc.pdf');
    expect(names).not.toContain('archive.zip');
  });

  it('surfaces .log files (plain text — should be searchable)', async () => {
    await mkdir(join(projectDir, 'webapp', 'logs'), { recursive: true });
    await writeFile(join(projectDir, 'webapp', 'logs', 'legacy_lumen.log'), 'log data\n');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'legacy_lumen' } }, res, vi.fn());
    await flushPromises();

    const results = res.json.mock.calls[0][0];
    const names = results.map((r: any) => r.name);
    expect(names).toContain('legacy_lumen.log');
  });

  it('never returns directories — only files', async () => {
    await mkdir(join(projectDir, 'components', 'Button'), { recursive: true });
    await writeFile(join(projectDir, 'components', 'Button', 'Button.tsx'), '');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'button' } }, res, vi.fn());
    await flushPromises();

    const results = res.json.mock.calls[0][0] as Array<{ name: string; type: string }>;
    // Every result must be a file — no directories
    for (const r of results) {
      expect(r.type).toBe('file');
    }
  });
});

describe('GET /api/filesystem/browse', () => {
  afterEach(() => {
    // Restore to a sensible default so tests outside this describe still get a valid
    // home directory. process.env.HOME is always set in Node.js test environments.
    vi.mocked(homedir)
      .mockReset()
      .mockReturnValue(process.env['HOME'] ?? '/tmp');
  });

  it('returns subdirectories of the given path', async () => {
    await mkdir(join(projectDir, 'alpha'));
    await mkdir(join(projectDir, 'beta'));
    await writeFile(join(projectDir, 'file.txt'), 'hello');

    // realpath expands macOS /var -> /private/var symlink so assertions match.
    const realProjectDir = await realpath(projectDir);

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: projectDir } } as any, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith({
      path: realProjectDir,
      entries: [
        { name: 'alpha', path: expect.stringContaining('alpha'), type: 'directory' },
        { name: 'beta', path: expect.stringContaining('beta'), type: 'directory' },
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

  it('allows paths outside home directory when passed explicitly', async () => {
    // Use a fresh tmpdir — on macOS /tmp is a symlink to /private/tmp so we use the
    // real tmpdir() value which is always outside a mocked home.
    const outsideDir = await mkdtemp(join(tmpdir(), 'mf-outside-browse-'));
    try {
      await mkdir(join(outsideDir, 'subdir'));
      // Mock home to something different so outsideDir is definitely outside
      vi.mocked(homedir).mockReturnValue(join(outsideDir, 'fake-home'));

      const ctx = createCtx(projectDir);
      const router = fileRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/filesystem/browse');
      const res = mockRes();

      handler({ query: { path: outsideDir } } as any, res, vi.fn());
      await flushPromises();

      expect(res.status).not.toHaveBeenCalledWith(403);
      const result = res.json.mock.calls[0][0];
      expect(result.entries.some((e: { name: string }) => e.name === 'subdir')).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('expands ~ in path parameter', async () => {
    await mkdir(join(projectDir, 'sub'));
    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: '~/sub' } } as any, res, vi.fn());
    await flushPromises();

    expect(res.status).not.toHaveBeenCalledWith(404);
    const result = res.json.mock.calls[0][0];
    expect(result.path).toContain('sub');
  });

  it('returns files when includeFiles=true', async () => {
    await mkdir(join(projectDir, 'mydir'));
    await writeFile(join(projectDir, 'myfile.txt'), 'hello');

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');

    // Default: only dirs
    const resDirs = mockRes();
    handler({ query: { path: projectDir } } as any, resDirs, vi.fn());
    await flushPromises();
    const defaultResult = resDirs.json.mock.calls[0][0];
    expect(defaultResult.entries.some((e: { name: string }) => e.name === 'myfile.txt')).toBe(false);
    expect(defaultResult.entries.some((e: { name: string }) => e.name === 'mydir')).toBe(true);

    // With includeFiles=true: both appear
    const resBoth = mockRes();
    handler({ query: { path: projectDir, includeFiles: 'true' } } as any, resBoth, vi.fn());
    await flushPromises();
    const filesResult = resBoth.json.mock.calls[0][0];
    expect(filesResult.entries.some((e: { name: string }) => e.name === 'myfile.txt')).toBe(true);
    expect(filesResult.entries.some((e: { name: string }) => e.name === 'mydir')).toBe(true);
  });

  it('returns hidden entries when includeHidden=true', async () => {
    await writeFile(join(projectDir, '.hidden'), 'secret');
    await writeFile(join(projectDir, 'visible.txt'), 'public');

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');

    // Default (no includeFiles, no includeHidden): no files at all
    const resDefault = mockRes();
    handler({ query: { path: projectDir } } as any, resDefault, vi.fn());
    await flushPromises();
    const defaultResult = resDefault.json.mock.calls[0][0];
    expect(defaultResult.entries.some((e: { name: string }) => e.name === '.hidden')).toBe(false);
    expect(defaultResult.entries.some((e: { name: string }) => e.name === 'visible.txt')).toBe(false);

    // includeFiles only: visible.txt appears, .hidden does not
    const resFiles = mockRes();
    handler({ query: { path: projectDir, includeFiles: 'true' } } as any, resFiles, vi.fn());
    await flushPromises();
    const filesResult = resFiles.json.mock.calls[0][0];
    expect(filesResult.entries.some((e: { name: string }) => e.name === 'visible.txt')).toBe(true);
    expect(filesResult.entries.some((e: { name: string }) => e.name === '.hidden')).toBe(false);

    // Both flags: both appear
    const resBoth = mockRes();
    handler({ query: { path: projectDir, includeFiles: 'true', includeHidden: 'true' } } as any, resBoth, vi.fn());
    await flushPromises();
    const bothResult = resBoth.json.mock.calls[0][0];
    expect(bothResult.entries.some((e: { name: string }) => e.name === 'visible.txt')).toBe(true);
    expect(bothResult.entries.some((e: { name: string }) => e.name === '.hidden')).toBe(true);
  });

  it('still filters IGNORED_DIRS even with includeHidden=true', async () => {
    await mkdir(join(projectDir, 'node_modules'));
    await mkdir(join(projectDir, 'src'));

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: projectDir, includeHidden: 'true' } } as any, res, vi.fn());
    await flushPromises();

    const result = res.json.mock.calls[0][0];
    expect(result.entries.some((e: { name: string }) => e.name === 'node_modules')).toBe(false);
    expect(result.entries.some((e: { name: string }) => e.name === 'src')).toBe(true);
  });

  it('returns type field on entries', async () => {
    await mkdir(join(projectDir, 'adir'));
    await writeFile(join(projectDir, 'afile.ts'), '');

    vi.mocked(homedir).mockReturnValue(projectDir);

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    handler({ query: { path: projectDir, includeFiles: 'true' } } as any, res, vi.fn());
    await flushPromises();

    const result = res.json.mock.calls[0][0];
    const dirEntry = result.entries.find((e: { name: string }) => e.name === 'adir');
    const fileEntry = result.entries.find((e: { name: string }) => e.name === 'afile.ts');
    expect(dirEntry?.type).toBe('directory');
    expect(fileEntry?.type).toBe('file');
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
