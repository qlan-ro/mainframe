import { describe, it, expect, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listFilesWithRipgrep } from '../ripgrep.js';

const tmpDir = path.join(os.tmpdir(), `mf-rg-test-${Date.now()}`);

async function file(relPath: string, content = ''): Promise<void> {
  const abs = path.join(tmpDir, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

// .gitignore that excludes .env (mirrors real-world repo setup)
await file('.gitignore', '.env\n.env.*\n');
// Gitignored config file — should appear with useBuiltinIgnoreOnly
await file('.env', 'SECRET=hunter2\n');
// Normal tracked file — should always appear
await file('index.ts', 'export {};\n');
// Build artifacts — should NOT appear with useBuiltinIgnoreOnly
await file('node_modules/foo/index.js', 'module.exports = {};\n');
await file('dist/bundle.js', 'var x=1;\n');
// iOS / Swift build artifacts — CocoaPods, Xcode DerivedData, SwiftPM, Carthage
await file('ios/Pods/Target Support Files/ExpoClipboard/ExpoClipboard.modulemap', 'module ExpoClipboard {}\n');
await file('ios/DerivedData/Build/x.o');
await file('.build/debug/bin.o');
await file('Carthage/Build/Foo.framework');
// Worktree directories — agents check out copies of the repo here; results
// would otherwise surface duplicate copies of every source file.
await file('.claude/worktrees/agent-abc123/src/Service.scala');
await file('.worktree/feature-x/copy.ts');
// IDE / editor config directories
await file('.idea/workspace.xml', '<xml/>');
await file('.vscode/settings.json', '{}');
await file('.vs/slnx.sqlite');
await file('.fleet/run.json', '{}');
await file('.zed/settings.json', '{}');

// Both modes listed once up front; null means ripgrep is unavailable, and the
// whole suite is then skipped loudly instead of every test silently passing.
const defaultFiles = await listFilesWithRipgrep(tmpDir);
const builtinFiles = defaultFiles === null ? null : await listFilesWithRipgrep(tmpDir, { useBuiltinIgnoreOnly: true });

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe.skipIf(defaultFiles === null)('listFilesWithRipgrep', () => {
  it('default mode respects .gitignore — excludes .env', () => {
    const names = defaultFiles!.map((f) => path.basename(f));
    expect(names).not.toContain('.env');
    expect(names).toContain('index.ts');
  });

  it('useBuiltinIgnoreOnly surfaces .env but excludes node_modules and dist', () => {
    const names = builtinFiles!.map((f) => path.basename(f));

    // Gitignored config file should now appear; normal file still present
    expect(names).toContain('.env');
    expect(names).toContain('index.ts');

    // Build artifacts still excluded
    expect(builtinFiles!.some((f) => f.includes('node_modules'))).toBe(false);
    expect(builtinFiles!.some((f) => f.startsWith('dist/') || f === 'dist')).toBe(false);
  });

  it.each([
    ['iOS/Swift build dirs (Pods, DerivedData, .build, Carthage)', ['Pods', 'DerivedData', '.build', 'Carthage']],
    ['worktree directories (.claude/worktrees, .worktree)', ['worktrees', '.worktree']],
    ['IDE config directories (.idea, .vscode, .vs, .fleet, .zed)', ['.idea', '.vscode', '.vs', '.fleet', '.zed']],
  ])('useBuiltinIgnoreOnly excludes %s', (_label, dirs) => {
    for (const dir of dirs) {
      expect(builtinFiles!.some((f) => f.includes(`/${dir}/`) || f.startsWith(`${dir}/`))).toBe(false);
    }
  });
});
