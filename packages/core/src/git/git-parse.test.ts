import { describe, it, expect } from 'vitest';
import { isNotGitRepo, parseDiffNameStatus, parseStatusLines, parseStatusBuckets } from './git-parse.js';

describe('isNotGitRepo', () => {
  it('returns true for "not a git repository" error', () => {
    const err = new Error('fatal: not a git repository (or any of the parent directories): .git');
    expect(isNotGitRepo(err)).toBe(true);
  });

  it('returns false for other errors', () => {
    const err = new Error('Permission denied');
    expect(isNotGitRepo(err)).toBe(false);
  });

  it('returns false for string values (message property undefined)', () => {
    // Strings coerced via 'as' cast: .message is undefined, typeof check returns false
    expect(isNotGitRepo('not a git repository')).toBe(false);
    expect(isNotGitRepo(42)).toBe(false);
  });
});

describe('parseDiffNameStatus', () => {
  it('parses a simple modified file', () => {
    const output = 'M\tsrc/foo.ts';
    expect(parseDiffNameStatus(output)).toEqual([{ status: 'M', path: 'src/foo.ts' }]);
  });

  it('parses added and deleted files', () => {
    const output = 'A\tsrc/new.ts\nD\tsrc/gone.ts';
    expect(parseDiffNameStatus(output)).toEqual([
      { status: 'A', path: 'src/new.ts' },
      { status: 'D', path: 'src/gone.ts' },
    ]);
  });

  it('parses renamed files (R status) with oldPath', () => {
    const output = 'R100\tsrc/old.ts\tsrc/new.ts';
    expect(parseDiffNameStatus(output)).toEqual([{ status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts' }]);
  });

  it('parses copied files (C status) with oldPath', () => {
    const output = 'C100\tsrc/original.ts\tsrc/copy.ts';
    expect(parseDiffNameStatus(output)).toEqual([{ status: 'C', path: 'src/copy.ts', oldPath: 'src/original.ts' }]);
  });

  it('filters out empty-path entries', () => {
    const output = 'M\tsrc/foo.ts\nM\t';
    const result = parseDiffNameStatus(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/foo.ts');
  });

  it('returns empty array for empty output', () => {
    expect(parseDiffNameStatus('')).toEqual([]);
  });

  it('handles multiple files', () => {
    const output = 'M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\tsrc/baz.ts';
    const result = parseDiffNameStatus(output);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: 'M', path: 'src/foo.ts' });
    expect(result[1]).toEqual({ status: 'A', path: 'src/bar.ts' });
    expect(result[2]).toEqual({ status: 'D', path: 'src/baz.ts' });
  });
});

describe('parseStatusLines', () => {
  it('parses a modified file', () => {
    // "M " = staged modify; code = "M " trimmed = "M"
    const output = 'M  src/foo.ts';
    expect(parseStatusLines(output)).toEqual([{ status: 'M', path: 'src/foo.ts' }]);
  });

  it('parses multiple files with various statuses', () => {
    const output = 'M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts';
    const result = parseStatusLines(output);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: 'M', path: 'src/staged.ts' });
    expect(result[1]).toEqual({ status: 'M', path: 'src/unstaged.ts' });
    expect(result[2]).toEqual({ status: '??', path: 'src/new.ts' });
  });

  it('parses renamed files with " -> " arrow notation', () => {
    const output = 'R  src/old.ts -> src/new.ts';
    const result = parseStatusLines(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts' });
  });

  it('parses copied files with " -> " arrow notation', () => {
    const output = 'C  src/original.ts -> src/copy.ts';
    const result = parseStatusLines(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ status: 'C', path: 'src/copy.ts', oldPath: 'src/original.ts' });
  });

  it('filters out directory entries (trailing slash)', () => {
    const output = 'M  src/foo.ts\nA  src/dir/';
    const result = parseStatusLines(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/foo.ts');
  });

  it('returns empty array for empty output', () => {
    expect(parseStatusLines('')).toEqual([]);
  });
});

describe('parseStatusBuckets', () => {
  it('returns empty buckets for empty output', () => {
    expect(parseStatusBuckets('')).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('puts ?? files in untracked', () => {
    const output = '?? src/new.ts';
    expect(parseStatusBuckets(output)).toEqual({
      staged: [],
      unstaged: [],
      untracked: ['src/new.ts'],
    });
  });

  it('puts staged-only files in staged, not unstaged', () => {
    // "M " = index=M, working=' ' => staged, not unstaged
    const output = 'M  src/staged.ts';
    const result = parseStatusBuckets(output);
    expect(result.staged).toContain('src/staged.ts');
    expect(result.unstaged).not.toContain('src/staged.ts');
    expect(result.untracked).not.toContain('src/staged.ts');
  });

  it('puts working-tree-only files in unstaged, not staged', () => {
    // " M" = index=' ', working='M' => unstaged, not staged
    const output = ' M src/unstaged.ts';
    const result = parseStatusBuckets(output);
    expect(result.staged).not.toContain('src/unstaged.ts');
    expect(result.unstaged).toContain('src/unstaged.ts');
    expect(result.untracked).not.toContain('src/unstaged.ts');
  });

  it('puts MM files in both staged and unstaged', () => {
    // "MM" = index=M, working=M => both staged and unstaged
    const output = 'MM src/both.ts';
    const result = parseStatusBuckets(output);
    expect(result.staged).toContain('src/both.ts');
    expect(result.unstaged).toContain('src/both.ts');
    expect(result.untracked).not.toContain('src/both.ts');
  });

  it('parses full porcelain output correctly', () => {
    const output = 'M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts\n';
    expect(parseStatusBuckets(output)).toEqual({
      staged: ['src/staged.ts'],
      unstaged: ['src/unstaged.ts'],
      untracked: ['src/new.ts'],
    });
  });
});
