import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { fileRoutes } from '../files.js';
import type { RouteContext } from '../types.js';

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
  app.use(fileRoutes(ctx));
  return app;
}

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-files-envelope-'));
  await writeFile(join(projectDir, 'hello.txt'), 'hello world\n');
  await mkdir(join(projectDir, 'subdir'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('handleTree', () => {
  it('returns 404 envelope when project is not found', async () => {
    const app = makeApp(null);
    const res = await request(app).get('/api/projects/missing/tree?path=.');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns array wrapped in envelope on success', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/tree?path=.');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: expect.any(Array) });
    const names = (res.body.data as { name: string }[]).map((e) => e.name);
    expect(names).toContain('hello.txt');
    expect(names).toContain('subdir');
  });

  it('returns 403 envelope when path is outside project', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/tree?path=../../etc');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Path outside project' });
  });
});

describe('handleFileContent', () => {
  it('returns file content wrapped in envelope on success', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/files?path=hello.txt');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { path: 'hello.txt', content: 'hello world\n' },
    });
  });

  it('returns 403 envelope when file path is outside project', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/files?path=../../etc/passwd');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Path outside project' });
  });

  it('returns 404 envelope when project is not found', async () => {
    const app = makeApp(null);
    const res = await request(app).get('/api/projects/missing/files?path=hello.txt');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });
});

describe('handleExternalFileContent', () => {
  it('returns utf-8 content for an existing external file', async () => {
    const app = makeApp(null);
    const res = await request(app).get(`/api/files/external?path=${encodeURIComponent(join(projectDir, 'hello.txt'))}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { content: 'hello world\n' } });
  });

  it('returns base64 content when encoding=base64', async () => {
    const app = makeApp(null);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const binPath = join(projectDir, 'img.png');
    await writeFile(binPath, bytes);
    const res = await request(app).get(`/api/files/external?path=${encodeURIComponent(binPath)}&encoding=base64`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { content: bytes.toString('base64'), encoding: 'base64' },
    });
  });

  it('rejects invalid encoding values', async () => {
    const app = makeApp(null);
    const res = await request(app).get(
      `/api/files/external?path=${encodeURIComponent(join(projectDir, 'hello.txt'))}&encoding=hex`,
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when path is a directory', async () => {
    const app = makeApp(null);
    const res = await request(app).get(`/api/files/external?path=${encodeURIComponent(projectDir)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Path is not a file' });
  });

  it('returns 404 for a missing file', async () => {
    const app = makeApp(null);
    const res = await request(app).get(`/api/files/external?path=${encodeURIComponent(join(projectDir, 'nope.txt'))}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'File not found' });
  });

  it.each([
    '/etc/shadow',
    '/etc/sudoers/extra',
    '/home/user/.ssh/id_ed25519',
    '/home/user/.aws/credentials',
    '/home/user/.netrc',
    '/home/user/.gnupg/private-keys-v1.d/key.key',
  ])('blocks sensitive path %s', async (blocked) => {
    const app = makeApp(null);
    const res = await request(app).get(`/api/files/external?path=${encodeURIComponent(blocked)}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Access to this path is not allowed' });
  });

  it('blocks a symlink that resolves to a sensitive path', async () => {
    const { symlink } = await import('node:fs/promises');
    const app = makeApp(null);
    const sshDir = join(projectDir, '.ssh');
    await mkdir(sshDir);
    await writeFile(join(sshDir, 'id_rsa'), 'PRIVATE');
    const link = join(projectDir, 'innocent.txt');
    await symlink(join(sshDir, 'id_rsa'), link);
    const res = await request(app).get(`/api/files/external?path=${encodeURIComponent(link)}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Access to this path is not allowed' });
  });
});

describe('handleSearchFiles', () => {
  it('returns empty array in envelope for empty query', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/search/files?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns matching files in envelope', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/search/files?q=hello');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: expect.any(Array) });
  });
});
