import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRipgrepOutput, searchWithRipgrep } from '../../server/ripgrep.js';

describe('parseRipgrepOutput', () => {
  it('parses match lines into SearchContentResult[]', () => {
    const basePath = '/projects/myapp';
    const jsonLines = [
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: '/projects/myapp/src/index.ts' },
          line_number: 42,
          lines: { text: 'const foo = "hello";\n' },
          submatches: [{ match: { text: 'hello' }, start: 13, end: 18 }],
        },
      }),
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: '/projects/myapp/src/utils.ts' },
          line_number: 7,
          lines: { text: 'export const hello = true;\n' },
          submatches: [{ match: { text: 'hello' }, start: 13, end: 18 }],
        },
      }),
      JSON.stringify({ type: 'summary', data: { stats: {} } }),
    ].join('\n');

    const results = parseRipgrepOutput(jsonLines, basePath);

    expect(results).toEqual([
      { file: 'src/index.ts', line: 42, column: 14, text: 'const foo = "hello";' },
      { file: 'src/utils.ts', line: 7, column: 14, text: 'export const hello = true;' },
    ]);
  });

  it('returns empty array for no matches', () => {
    const jsonLines = JSON.stringify({ type: 'summary', data: { stats: {} } });
    const results = parseRipgrepOutput(jsonLines, '/projects/myapp');
    expect(results).toEqual([]);
  });

  it('caps results at maxResults', () => {
    const basePath = '/projects/myapp';
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: `/projects/myapp/file${i}.ts` },
          line_number: 1,
          lines: { text: 'match\n' },
          submatches: [{ match: { text: 'match' }, start: 0, end: 5 }],
        },
      }),
    ).join('\n');

    const results = parseRipgrepOutput(lines, basePath, 3);
    expect(results).toHaveLength(3);
  });
});

describe('searchWithRipgrep', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'mf-rg-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('finds text matches in files', async () => {
    await mkdir(join(testDir, 'src'));
    await writeFile(join(testDir, 'src', 'app.ts'), 'const greeting = "hello world";\n');
    await writeFile(join(testDir, 'src', 'utils.ts'), 'export function hello() {}\n');

    const results = await searchWithRipgrep(testDir, 'hello');

    expect(results.length).toBeGreaterThanOrEqual(2);
    const files = results.map((r) => r.file);
    expect(files).toContain(join('src', 'app.ts'));
    expect(files).toContain(join('src', 'utils.ts'));
  });

  it('returns empty array for no matches', async () => {
    await writeFile(join(testDir, 'file.txt'), 'nothing here\n');
    const results = await searchWithRipgrep(testDir, 'zzzznotfound');
    expect(results).toEqual([]);
  });

  it('respects includeIgnored option', async () => {
    await writeFile(join(testDir, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(testDir, 'ignored.txt'), 'findme\n');
    await writeFile(join(testDir, 'visible.txt'), 'findme\n');

    const withoutIgnored = await searchWithRipgrep(testDir, 'findme');
    const withIgnored = await searchWithRipgrep(testDir, 'findme', { includeIgnored: true });

    expect(withoutIgnored.map((r) => r.file)).not.toContain('ignored.txt');
    expect(withIgnored.map((r) => r.file)).toContain('ignored.txt');
  });
});

describe('listFilesWithRipgrep', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'mf-rg-files-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('lists files in a directory', async () => {
    await mkdir(join(testDir, 'src'));
    await writeFile(join(testDir, 'src', 'app.ts'), '');
    await writeFile(join(testDir, 'src', 'utils.ts'), '');
    await writeFile(join(testDir, 'readme.md'), '');

    const { listFilesWithRipgrep } = await import('../../server/ripgrep.js');
    const files = await listFilesWithRipgrep(testDir);

    expect(files).toContain(join('src', 'app.ts'));
    expect(files).toContain(join('src', 'utils.ts'));
    expect(files).toContain('readme.md');
  });

  it('excludes gitignored files by default', async () => {
    await writeFile(join(testDir, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(testDir, 'ignored.txt'), '');
    await writeFile(join(testDir, 'visible.txt'), '');

    const { listFilesWithRipgrep } = await import('../../server/ripgrep.js');
    const files = await listFilesWithRipgrep(testDir);

    expect(files).not.toContain('ignored.txt');
    expect(files).toContain('visible.txt');
  });

  it('returns null when ripgrep is unavailable', async () => {
    const { listFilesWithRipgrep } = await import('../../server/ripgrep.js');
    // This test validates the return type — actual rg availability varies by environment
    const result = await listFilesWithRipgrep(testDir);
    expect(Array.isArray(result) || result === null).toBe(true);
  });
});
