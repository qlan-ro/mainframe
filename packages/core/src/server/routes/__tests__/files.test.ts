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
