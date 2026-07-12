import { describe, it, expect } from 'vitest';
import {
  isNotGitRepo,
  parseDiffNameStatus,
  parseStatusLines,
  parseStatusBuckets,
  parseBranchList,
  parseRemotes,
  parseCommitHash,
  parseDiffStatSummary,
  countAutoMerges,
  parseStatusZ,
} from './git-parse.js';

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

// Fixtures below are real captures from git 2.x (`git branch --no-color [-a]`,
// `git status --porcelain -z`, `git commit`, `git merge`, `git remote`).

describe('parseBranchList', () => {
  it('reads the current branch from the "* " marker', () => {
    const output = '  feature\n* main\n';
    expect(parseBranchList(output)).toEqual({ current: 'main', all: ['feature', 'main'] });
  });

  it('resolves a detached-HEAD line to the ref it points at', () => {
    const output = '* (HEAD detached at 4be41bd)\n  feature\n  main\n';
    expect(parseBranchList(output)).toEqual({ current: '4be41bd', all: ['4be41bd', 'feature', 'main'] });
  });

  it('resolves "detached from" phrasing too', () => {
    const output = '* (HEAD detached from origin/main)\n  main\n';
    const result = parseBranchList(output);
    expect(result.current).toBe('origin/main');
    expect(result.all).toContain('origin/main');
  });

  it('keeps the remotes/origin/HEAD pseudo-ref name for callers to filter (-a output)', () => {
    const output = '  feature\n* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n';
    expect(parseBranchList(output)).toEqual({
      current: 'main',
      all: ['feature', 'main', 'remotes/origin/HEAD', 'remotes/origin/main'],
    });
  });

  it('returns empty current when no branch is checked out', () => {
    expect(parseBranchList('  feature\n  main\n')).toEqual({ current: '', all: ['feature', 'main'] });
  });

  it('returns empty for empty output', () => {
    expect(parseBranchList('')).toEqual({ current: '', all: [] });
  });
});

describe('parseRemotes', () => {
  it('parses a single remote', () => {
    expect(parseRemotes('origin\n')).toEqual(['origin']);
  });

  it('parses multiple remotes and trims whitespace', () => {
    expect(parseRemotes('origin\nupstream\n')).toEqual(['origin', 'upstream']);
  });

  it('returns empty for empty output', () => {
    expect(parseRemotes('')).toEqual([]);
  });
});

describe('parseCommitHash', () => {
  it('extracts the full 40-char sha from a normal commit line', () => {
    const output = '[main 4eb25962344372bd1543bcb51fb6f8eb28503c03] second';
    expect(parseCommitHash(output)).toBe('4eb25962344372bd1543bcb51fb6f8eb28503c03');
  });

  it('extracts the sha from a root-commit line (parenthetical between branch and hash)', () => {
    const output = '[main (root-commit) 56a25fa0b22e6620abbc9cd6ba8aab04f94039fc] initial';
    expect(parseCommitHash(output)).toBe('56a25fa0b22e6620abbc9cd6ba8aab04f94039fc');
  });

  it('reads the hash from the first line when git prints stat lines after it', () => {
    const output = '[main 4eb25962344372bd1543bcb51fb6f8eb28503c03] second\n 1 file changed, 1 insertion(+)';
    expect(parseCommitHash(output)).toBe('4eb25962344372bd1543bcb51fb6f8eb28503c03');
  });

  it('returns empty string when there is no commit line (nothing to commit)', () => {
    expect(parseCommitHash('nothing to commit, working tree clean')).toBe('');
    expect(parseCommitHash('')).toBe('');
  });
});

describe('parseDiffStatSummary', () => {
  it('parses a single-file, insertions-only summary', () => {
    expect(parseDiffStatSummary('1 file changed, 1 insertion(+)')).toEqual({
      changes: 1,
      insertions: 1,
      deletions: 0,
    });
  });

  it('parses a full insertions + deletions summary', () => {
    expect(parseDiffStatSummary('3 files changed, 10 insertions(+), 2 deletions(-)')).toEqual({
      changes: 3,
      insertions: 10,
      deletions: 2,
    });
  });

  it('parses a deletions-only summary (insertions clause absent)', () => {
    expect(parseDiffStatSummary('2 files changed, 5 deletions(-)')).toEqual({
      changes: 2,
      insertions: 0,
      deletions: 5,
    });
  });

  it('finds the summary line inside multi-line merge output', () => {
    const output = "Merge made by the 'ort' strategy.\n f.txt | 1 +\n 1 file changed, 1 insertion(+)\n";
    expect(parseDiffStatSummary(output)).toEqual({ changes: 1, insertions: 1, deletions: 0 });
  });

  it('returns zeros for an up-to-date pull (no summary line)', () => {
    expect(parseDiffStatSummary('Already up to date.')).toEqual({ changes: 0, insertions: 0, deletions: 0 });
  });

  it('returns zeros for empty output', () => {
    expect(parseDiffStatSummary('')).toEqual({ changes: 0, insertions: 0, deletions: 0 });
  });
});

describe('countAutoMerges', () => {
  it('counts each "Auto-merging <file>" line', () => {
    const output = "Auto-merging src/a.ts\nAuto-merging src/b.ts\nMerge made by the 'ort' strategy.";
    expect(countAutoMerges(output)).toBe(2);
  });

  it('returns 0 for a clean merge with no auto-merged files', () => {
    expect(countAutoMerges("Merge made by the 'ort' strategy.\n f.txt | 1 +")).toBe(0);
  });

  it('returns 0 for empty output', () => {
    expect(countAutoMerges('')).toBe(0);
  });
});

describe('parseStatusZ', () => {
  it('returns empty for empty output', () => {
    expect(parseStatusZ('')).toEqual({ conflicted: [], files: [] });
  });

  it('parses a plain modified file (XY = " M")', () => {
    expect(parseStatusZ(' M src/foo.ts\0')).toEqual({
      conflicted: [],
      files: [{ path: 'src/foo.ts', index: ' ', working_dir: 'M' }],
    });
  });

  it('consumes the source-path token for a rename entry and keeps the new path', () => {
    // `git mv a.txt renamed.txt` → "R  renamed.txt\0a.txt\0"
    const output = 'R  renamed.txt\0a.txt\0';
    expect(parseStatusZ(output)).toEqual({
      conflicted: [],
      files: [{ path: 'renamed.txt', index: 'R', working_dir: ' ' }],
    });
  });

  it('flags an unmerged both-modified entry (UU) as conflicted', () => {
    expect(parseStatusZ('UU f.txt\0')).toEqual({
      conflicted: ['f.txt'],
      files: [{ path: 'f.txt', index: 'U', working_dir: 'U' }],
    });
  });

  it('handles a rename and a conflict together without mis-pairing the tokens', () => {
    const output = 'R  renamed.txt\0a.txt\0UU f.txt\0';
    expect(parseStatusZ(output)).toEqual({
      conflicted: ['f.txt'],
      files: [
        { path: 'renamed.txt', index: 'R', working_dir: ' ' },
        { path: 'f.txt', index: 'U', working_dir: 'U' },
      ],
    });
  });

  it('skips ignored (!!) entries', () => {
    expect(parseStatusZ('!! build/\0 M kept.ts\0')).toEqual({
      conflicted: [],
      files: [{ path: 'kept.ts', index: ' ', working_dir: 'M' }],
    });
  });
});
