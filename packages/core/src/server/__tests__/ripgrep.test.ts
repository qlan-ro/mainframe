import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listFilesWithRipgrep } from '../ripgrep.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await os.tmpdir();
  tmpDir = path.join(tmpDir, `mf-rg-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  // .gitignore that excludes .env (mirrors real-world repo setup)
  await writeFile(path.join(tmpDir, '.gitignore'), '.env\n.env.*\n');

  // Gitignored config file — should appear with useBuiltinIgnoreOnly
  await writeFile(path.join(tmpDir, '.env'), 'SECRET=hunter2\n');

  // Normal tracked file — should always appear
  await writeFile(path.join(tmpDir, 'index.ts'), 'export {};\n');

  // Build artifact — should NOT appear with useBuiltinIgnoreOnly
  await mkdir(path.join(tmpDir, 'node_modules', 'foo'), { recursive: true });
  await writeFile(path.join(tmpDir, 'node_modules', 'foo', 'index.js'), 'module.exports = {};\n');

  // Another excluded build dir
  await mkdir(path.join(tmpDir, 'dist'), { recursive: true });
  await writeFile(path.join(tmpDir, 'dist', 'bundle.js'), 'var x=1;\n');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('listFilesWithRipgrep', () => {
  it('default mode respects .gitignore — excludes .env', async () => {
    const files = await listFilesWithRipgrep(tmpDir);
    if (files === null) return; // ripgrep unavailable in CI — skip gracefully

    const names = files.map((f) => path.basename(f));
    expect(names).not.toContain('.env');
    expect(names).toContain('index.ts');
  });

  it('useBuiltinIgnoreOnly surfaces .env but excludes node_modules and dist', async () => {
    const files = await listFilesWithRipgrep(tmpDir, { useBuiltinIgnoreOnly: true });
    if (files === null) return; // ripgrep unavailable in CI — skip gracefully

    const names = files.map((f) => path.basename(f));

    // Gitignored config file should now appear
    expect(names).toContain('.env');

    // Normal file still present
    expect(names).toContain('index.ts');

    // Build artifacts still excluded
    const hasNodeModules = files.some((f) => f.includes('node_modules'));
    expect(hasNodeModules).toBe(false);

    const hasDist = files.some((f) => f.startsWith('dist/') || f === 'dist');
    expect(hasDist).toBe(false);
  });
});
