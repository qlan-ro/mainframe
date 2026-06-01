import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

// Force the JS fallback path (ripgrep unavailable) so we exercise the
// listProjectFiles() enumeration that reads files by path.
vi.mock('../../ripgrep.js', () => ({
  isRipgrepAvailable: () => false,
  searchWithRipgrep: async () => [],
}));

import { contentSearchRoutes } from '../search.js';
import type { RouteContext } from '../types.js';

function makeApp(projectPath: string) {
  const app = express();
  app.use(express.json());
  const ctx = {
    db: { projects: { get: (_id: string) => ({ path: projectPath }) } },
    chats: { getChat: (_chatId: string) => null },
  } as unknown as RouteContext;
  app.use(contentSearchRoutes(ctx));
  return app;
}

let projectDir: string;
let outsideDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-search-symlink-proj-'));
  outsideDir = await mkdtemp(join(tmpdir(), 'mf-search-symlink-out-'));
  await writeFile(join(outsideDir, 'secret.txt'), 'TOPSECRETVALUE\n');
  await writeFile(join(projectDir, 'normal.txt'), 'ordinary content\n');
  // A symlink committed inside the repo that escapes the project boundary.
  await symlink(join(outsideDir, 'secret.txt'), join(projectDir, 'leak.txt'));
  // Make it a real git repo so listProjectFiles() uses `git ls-files` — the
  // enumeration path that returns the symlink without a containment check.
  execFileSync('git', ['init', '-q'], { cwd: projectDir });
  execFileSync('git', ['add', '-A'], { cwd: projectDir });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

describe('content search — JS fallback symlink containment', () => {
  it('does not read a file via an in-repo symlink that escapes the project', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/search/content?q=TOPSECRETVALUE&path=.');
    expect(res.status).toBe(200);
    // The secret lives OUTSIDE the project, reachable only through leak.txt.
    // The fallback must not follow the symlink and surface its contents.
    expect(res.body.data.results).toHaveLength(0);
  });

  it('still searches legitimate in-project files in the fallback', async () => {
    const app = makeApp(projectDir);
    const res = await request(app).get('/api/projects/p1/search/content?q=ordinary&path=.');
    expect(res.status).toBe(200);
    expect(res.body.data.results.length).toBeGreaterThan(0);
  });
});
