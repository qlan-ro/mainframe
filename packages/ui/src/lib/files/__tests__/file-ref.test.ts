/**
 * Unit tests for lib/files/file-ref.ts — toFileRef path normalizer.
 *
 * These tests drive the canonical path-flavor normalizer. Run them FIRST;
 * the implementation must make them green.
 */
import { describe, expect, it } from 'vitest';
import { toFileRef } from '../file-ref';

const WORKTREE = '/Users/dev/projects/myapp/.worktrees/feat-wt';
const PROJECT = '/Users/dev/projects/myapp';

const bases = { worktreePath: WORKTREE, projectPath: PROJECT };

// ── absolute-under-worktree ──────────────────────────────────────────────────

describe('absolute path under worktree base', () => {
  it('strips worktree prefix to relative', () => {
    const ref = toFileRef(`${WORKTREE}/src/app.ts`, bases);
    expect(ref.relative).toBe('src/app.ts');
    expect(ref.absolute).toBe(`${WORKTREE}/src/app.ts`);
    expect(ref.isExternal).toBe(false);
  });

  it('handles path equal to worktree root', () => {
    const ref = toFileRef(WORKTREE, bases);
    expect(ref.relative).toBe('');
    expect(ref.isExternal).toBe(false);
  });

  it('worktree wins over project when both match (worktree is deeper)', () => {
    // A path under the worktree is ALSO under the project root directory hierarchy —
    // we want the more specific (worktree) base to win.
    const path = `${WORKTREE}/lib/util.ts`;
    const ref = toFileRef(path, { worktreePath: WORKTREE, projectPath: PROJECT });
    expect(ref.relative).toBe('lib/util.ts');
    expect(ref.isExternal).toBe(false);
  });
});

// ── absolute-under-project-only ──────────────────────────────────────────────

describe('absolute path under project base (no worktree match)', () => {
  it('strips project prefix when no worktreePath in bases', () => {
    const ref = toFileRef(`${PROJECT}/src/index.ts`, { projectPath: PROJECT });
    expect(ref.relative).toBe('src/index.ts');
    expect(ref.absolute).toBe(`${PROJECT}/src/index.ts`);
    expect(ref.isExternal).toBe(false);
  });

  it('strips project prefix when worktreePath present but path is under project only', () => {
    const ref = toFileRef(`${PROJECT}/README.md`, bases);
    expect(ref.relative).toBe('README.md');
    expect(ref.isExternal).toBe(false);
  });
});

// ── file:// URI ───────────────────────────────────────────────────────────────

describe('file:// URI inputs', () => {
  it('decodes file:// URI and relativizes against worktree', () => {
    const uri = `file://${WORKTREE}/src/parser.ts`;
    const ref = toFileRef(uri, bases);
    expect(ref.relative).toBe('src/parser.ts');
    expect(ref.absolute).toBe(`${WORKTREE}/src/parser.ts`);
    expect(ref.isExternal).toBe(false);
  });

  it('decodes file:// URI and relativizes against project', () => {
    const uri = `file://${PROJECT}/lib/helper.ts`;
    const ref = toFileRef(uri, { projectPath: PROJECT });
    expect(ref.relative).toBe('lib/helper.ts');
    expect(ref.isExternal).toBe(false);
  });

  it('decodes file:// URI with percent-encoded spaces', () => {
    const base = '/Users/dev/my%20project';
    const decoded = '/Users/dev/my project';
    const uri = `file://${base}/src/a.ts`;
    const ref = toFileRef(uri, { projectPath: decoded });
    expect(ref.relative).toBe('src/a.ts');
    expect(ref.isExternal).toBe(false);
  });
});

// ── already-relative ─────────────────────────────────────────────────────────

describe('already-relative path', () => {
  it('passes through unchanged when bases are present', () => {
    const ref = toFileRef('src/a.ts', bases);
    expect(ref.relative).toBe('src/a.ts');
    expect(ref.isExternal).toBe(false);
  });

  it('passes through with no bases', () => {
    const ref = toFileRef('src/a.ts', {});
    expect(ref.relative).toBe('src/a.ts');
    expect(ref.isExternal).toBe(false);
  });

  it('preserves leading ./ (normalized to no-prefix? No — keep as-is)', () => {
    // A bare ./src/foo.ts is treated as already-relative — strip the ./ prefix.
    const ref = toFileRef('./src/foo.ts', bases);
    expect(ref.relative).toBe('src/foo.ts');
    expect(ref.isExternal).toBe(false);
  });
});

// ── external path ─────────────────────────────────────────────────────────────

describe('external path (not under any base)', () => {
  it('marks external when path is outside all bases', () => {
    const ref = toFileRef('/usr/local/lib/node.ts', bases);
    expect(ref.isExternal).toBe(true);
    expect(ref.relative).toBe('/usr/local/lib/node.ts');
    expect(ref.absolute).toBe('/usr/local/lib/node.ts');
  });

  it('marks external with no bases', () => {
    const ref = toFileRef('/absolute/no/base.ts', {});
    expect(ref.isExternal).toBe(true);
    expect(ref.relative).toBe('/absolute/no/base.ts');
  });

  it('file:// URI outside all bases is external', () => {
    const ref = toFileRef('file:///usr/local/share/foo.ts', bases);
    expect(ref.isExternal).toBe(true);
    expect(ref.relative).toBe('/usr/local/share/foo.ts');
  });
});

// ── separator normalization ───────────────────────────────────────────────────

describe('separator normalization', () => {
  it('normalizes backslash separators to forward-slash', () => {
    const path = `${WORKTREE}\\src\\windows.ts`;
    const ref = toFileRef(path, bases);
    // On posix the path won't match; but the relative result must not contain backslashes.
    expect(ref.relative).not.toContain('\\');
  });
});

// ── duplicate-tab regression (the F1 fix) ───────────────────────────────────

describe('F1 regression: absolute tool-card path == relative tree path', () => {
  it('absolute path and its relative form resolve to the SAME relative key', () => {
    const absPath = `${WORKTREE}/src/a.ts`;
    const relPath = 'src/a.ts';

    const fromAbs = toFileRef(absPath, bases);
    const fromRel = toFileRef(relPath, bases);

    expect(fromAbs.relative).toBe(fromRel.relative);
    expect(fromAbs.isExternal).toBe(false);
    expect(fromRel.isExternal).toBe(false);
  });

  it('file:// URI and relative form resolve to the SAME relative key', () => {
    const uri = `file://${WORKTREE}/src/b.ts`;
    const relPath = 'src/b.ts';

    const fromUri = toFileRef(uri, bases);
    const fromRel = toFileRef(relPath, bases);

    expect(fromUri.relative).toBe(fromRel.relative);
  });
});
