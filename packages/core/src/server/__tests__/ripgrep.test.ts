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

  // iOS / Swift build artifacts — CocoaPods, Xcode DerivedData, SwiftPM, Carthage
  await mkdir(path.join(tmpDir, 'ios', 'Pods', 'Target Support Files', 'ExpoClipboard'), {
    recursive: true,
  });
  await writeFile(
    path.join(tmpDir, 'ios', 'Pods', 'Target Support Files', 'ExpoClipboard', 'ExpoClipboard.modulemap'),
    'module ExpoClipboard {}\n',
  );

  await mkdir(path.join(tmpDir, 'ios', 'DerivedData', 'Build'), { recursive: true });
  await writeFile(path.join(tmpDir, 'ios', 'DerivedData', 'Build', 'x.o'), '');

  await mkdir(path.join(tmpDir, '.build', 'debug'), { recursive: true });
  await writeFile(path.join(tmpDir, '.build', 'debug', 'bin.o'), '');

  await mkdir(path.join(tmpDir, 'Carthage', 'Build'), { recursive: true });
  await writeFile(path.join(tmpDir, 'Carthage', 'Build', 'Foo.framework'), '');

  // Worktree directories — agents check out copies of the repo here; results
  // would otherwise surface duplicate copies of every source file.
  await mkdir(path.join(tmpDir, '.claude', 'worktrees', 'agent-abc123', 'src'), {
    recursive: true,
  });
  await writeFile(path.join(tmpDir, '.claude', 'worktrees', 'agent-abc123', 'src', 'Service.scala'), '');

  await mkdir(path.join(tmpDir, '.worktree', 'feature-x'), { recursive: true });
  await writeFile(path.join(tmpDir, '.worktree', 'feature-x', 'copy.ts'), '');

  // IDE / editor config directories
  await mkdir(path.join(tmpDir, '.idea'), { recursive: true });
  await writeFile(path.join(tmpDir, '.idea', 'workspace.xml'), '<xml/>');

  await mkdir(path.join(tmpDir, '.vscode'), { recursive: true });
  await writeFile(path.join(tmpDir, '.vscode', 'settings.json'), '{}');

  await mkdir(path.join(tmpDir, '.vs'), { recursive: true });
  await writeFile(path.join(tmpDir, '.vs', 'slnx.sqlite'), '');

  await mkdir(path.join(tmpDir, '.fleet'), { recursive: true });
  await writeFile(path.join(tmpDir, '.fleet', 'run.json'), '{}');

  await mkdir(path.join(tmpDir, '.zed'), { recursive: true });
  await writeFile(path.join(tmpDir, '.zed', 'settings.json'), '{}');
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

  it('useBuiltinIgnoreOnly excludes iOS/Swift build dirs (Pods, DerivedData, .build, Carthage)', async () => {
    const files = await listFilesWithRipgrep(tmpDir, { useBuiltinIgnoreOnly: true });
    if (files === null) return; // ripgrep unavailable in CI — skip gracefully

    expect(files.some((f) => f.includes('/Pods/') || f.startsWith('Pods/'))).toBe(false);
    expect(files.some((f) => f.includes('/DerivedData/') || f.startsWith('DerivedData/'))).toBe(false);
    expect(files.some((f) => f.includes('/.build/') || f.startsWith('.build/'))).toBe(false);
    expect(files.some((f) => f.includes('/Carthage/') || f.startsWith('Carthage/'))).toBe(false);
  });

  it('useBuiltinIgnoreOnly excludes worktree directories (.claude/worktrees, .worktree)', async () => {
    const files = await listFilesWithRipgrep(tmpDir, { useBuiltinIgnoreOnly: true });
    if (files === null) return; // ripgrep unavailable in CI — skip gracefully

    expect(files.some((f) => f.includes('/worktrees/') || f.startsWith('worktrees/'))).toBe(false);
    expect(files.some((f) => f.includes('/.worktree/') || f.startsWith('.worktree/'))).toBe(false);
  });

  it('useBuiltinIgnoreOnly excludes IDE config directories (.idea, .vscode, .vs, .fleet, .zed)', async () => {
    const files = await listFilesWithRipgrep(tmpDir, { useBuiltinIgnoreOnly: true });
    if (files === null) return; // ripgrep unavailable in CI — skip gracefully

    for (const dir of ['.idea', '.vscode', '.vs', '.fleet', '.zed']) {
      expect(files.some((f) => f.includes(`/${dir}/`) || f.startsWith(`${dir}/`))).toBe(false);
    }
  });
});
