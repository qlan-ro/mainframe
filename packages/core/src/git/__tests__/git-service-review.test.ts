/**
 * Unit tests for GitService.commitAll and GitService.workingStat.
 * These tests run against a real temporary git repo to verify behavior
 * without mocking the git internals.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitService } from '../git-service.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, 'init');
  await git(dir, 'config', 'user.email', 'test@test.com');
  await git(dir, 'config', 'user.name', 'Test');
  // Create an initial commit so HEAD exists
  await writeFile(join(dir, 'README.md'), '# Test\n');
  await git(dir, 'add', 'README.md');
  await git(dir, 'commit', '-m', 'init');
}

describe('GitService.commitAll', () => {
  let dir: string;
  let svc: GitService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-service-test-'));
    await initRepo(dir);
    svc = GitService.forProject(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stages all changes and returns a commit sha', async () => {
    await writeFile(join(dir, 'new-file.ts'), 'export const x = 1;\n');
    await writeFile(join(dir, 'README.md'), '# Updated\n');

    const sha = await svc.commitAll('feat: add new file');

    expect(typeof sha).toBe('string');
    expect(sha.length).toBeGreaterThan(0);
    // `-c core.abbrev=40` widens the return to the full SHA (intentional vs
    // simple-git's short hash); pin it so the wire value can't silently narrow.
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('includes previously untracked files in the commit', async () => {
    await writeFile(join(dir, 'untracked.ts'), 'const y = 2;\n');

    await svc.commitAll('feat: commit untracked');

    // The untracked file should now be tracked
    const log = await git(dir, 'show', '--name-only', '--format=', 'HEAD');
    expect(log).toContain('untracked.ts');
  });

  it('includes deleted files (git add -A stages deletions)', async () => {
    // Write an extra file and commit it first
    await writeFile(join(dir, 'to-delete.ts'), 'const z = 3;\n');
    await git(dir, 'add', 'to-delete.ts');
    await git(dir, 'commit', '-m', 'add to-delete');

    // Remove the file from disk
    await rm(join(dir, 'to-delete.ts'));

    await svc.commitAll('chore: remove to-delete');

    const log = await git(dir, 'show', '--name-status', '--format=', 'HEAD');
    expect(log).toMatch(/D\s+to-delete\.ts/);
  });

  it('throws when there is nothing to commit', async () => {
    await expect(svc.commitAll('empty commit')).rejects.toThrow();
  });
});

describe('GitService.workingStat', () => {
  let dir: string;
  let svc: GitService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-service-stat-'));
    await initRepo(dir);
    svc = GitService.forProject(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty lists when working tree is clean', async () => {
    const result = await svc.workingStat();
    expect(result.files).toEqual([]);
    expect(result.totalAdditions).toBe(0);
    expect(result.totalDeletions).toBe(0);
  });

  it('counts additions for a modified tracked file', async () => {
    await writeFile(join(dir, 'README.md'), '# Updated\nline2\nline3\n');

    const result = await svc.workingStat();

    const entry = result.files.find((f) => f.path === 'README.md');
    expect(entry).toBeDefined();
    expect(entry!.additions).toBeGreaterThan(0);
    expect(result.totalAdditions).toBeGreaterThan(0);
  });

  it('counts additions for a new untracked file', async () => {
    await writeFile(join(dir, 'new-file.ts'), 'const a = 1;\nconst b = 2;\n');

    const result = await svc.workingStat();

    const entry = result.files.find((f) => f.path === 'new-file.ts');
    expect(entry).toBeDefined();
    expect(entry!.additions).toBe(2);
    expect(entry!.deletions).toBe(0);
    expect(result.totalAdditions).toBeGreaterThanOrEqual(2);
  });

  it('counts additions for untracked file in a subdirectory', async () => {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'index.ts'), 'export {};\n');

    const result = await svc.workingStat();

    const entry = result.files.find((f) => f.path === 'src/index.ts');
    expect(entry).toBeDefined();
    expect(entry!.additions).toBe(1);
  });

  it('counts deletions for lines removed from a tracked file', async () => {
    // Initial file has "# Test\n" (1 line); replace with empty
    await writeFile(join(dir, 'README.md'), '');

    const result = await svc.workingStat();

    const entry = result.files.find((f) => f.path === 'README.md');
    expect(entry).toBeDefined();
    expect(entry!.deletions).toBeGreaterThanOrEqual(1);
    expect(result.totalDeletions).toBeGreaterThanOrEqual(1);
  });

  it('reports 0 additions and 0 deletions for binary files', async () => {
    // A null byte makes git treat the file as binary
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await writeFile(join(dir, 'data.bin'), binaryContent);

    const result = await svc.workingStat();

    const entry = result.files.find((f) => f.path === 'data.bin');
    expect(entry).toBeDefined();
    expect(entry!.additions).toBe(0);
    expect(entry!.deletions).toBe(0);
  });

  it('computes correct totals across multiple files', async () => {
    await writeFile(join(dir, 'a.ts'), 'const a = 1;\nconst b = 2;\n');
    await writeFile(join(dir, 'b.ts'), 'const c = 3;\n');

    const result = await svc.workingStat();

    const aEntry = result.files.find((f) => f.path === 'a.ts');
    const bEntry = result.files.find((f) => f.path === 'b.ts');
    expect(aEntry!.additions).toBe(2);
    expect(bEntry!.additions).toBe(1);
    expect(result.totalAdditions).toBeGreaterThanOrEqual(3);
    expect(result.files.length).toBeGreaterThanOrEqual(2);
  });
});
