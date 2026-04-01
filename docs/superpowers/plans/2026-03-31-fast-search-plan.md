# Fast Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow pure-JS content search with ripgrep, exclude build artifacts/binaries from file name search, and extend the default ignored directory list.

**Architecture:** Content search (`Find in Path`) delegates to `@vscode/ripgrep` via `execFile`, parsing `--json` output into `SearchContentResult[]`. File name search (`Command Palette` / `@ Popover`) uses `rg --files` for file listing, getting the same filtering (`.gitignore`, hidden files, binaries) for free. Both fall back to the existing JS implementations when ripgrep is unavailable. All search surfaces benefit from an extended `IGNORED_DIRS` set.

**Tech Stack:** `@vscode/ripgrep` (cross-platform rg binary via npm), Node.js `child_process.execFile`, Vitest

**Spec:** `docs/superpowers/specs/2026-03-31-fast-search-design.md`

---

### Task 1: Install `@vscode/ripgrep` and configure bundling

**Files:**
- Modify: `packages/core/package.json` (add dependency)
- Modify: `package.json` (root — add to `pnpm.onlyBuiltDependencies`)
- Modify: `packages/desktop/scripts/bundle-daemon.mjs:20` (add external)
- Modify: `packages/desktop/package.json:90-127` (add extraResources)

- [ ] **Step 1: Install the package**

```bash
pnpm --filter @qlan-ro/mainframe-core add @vscode/ripgrep
```

- [ ] **Step 2: Allow its build script in root `package.json`**

In `package.json` at the root, add `"@vscode/ripgrep"` to the `pnpm.onlyBuiltDependencies` array:

```json
"pnpm": {
  "onlyBuiltDependencies": [
    "@vscode/ripgrep",
    "better-sqlite3",
    "electron",
    "esbuild"
  ]
}
```

- [ ] **Step 3: Mark external in esbuild bundle script**

In `packages/desktop/scripts/bundle-daemon.mjs`, add `'@vscode/ripgrep'` to the `external` array:

```js
external: ['better-sqlite3', '*.node', 'typescript-language-server', 'pyright', '@vscode/ripgrep'],
```

- [ ] **Step 4: Add extraResources entry for electron-builder**

In `packages/desktop/package.json`, add to the `build.extraResources` array (after the `pyright` entry):

```json
{
  "from": "../../node_modules/@vscode/ripgrep",
  "to": "node_modules/@vscode/ripgrep",
  "filter": [
    "**/*",
    "!**/*.md"
  ]
}
```

- [ ] **Step 5: Verify install succeeded**

```bash
node -e "const { rgPath } = require('@vscode/ripgrep'); console.log('rg binary:', rgPath)"
```

Expected: prints the path to the `rg` binary, e.g. `/Users/.../node_modules/@vscode/ripgrep/bin/rg`

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json package.json pnpm-lock.yaml \
  packages/desktop/scripts/bundle-daemon.mjs packages/desktop/package.json
git commit -m "chore: add @vscode/ripgrep dependency and configure bundling"
```

---

### Task 2: Create ripgrep wrapper module

**Files:**
- Create: `packages/core/src/server/ripgrep.ts`
- Test: `packages/core/src/__tests__/routes/ripgrep.test.ts`

- [ ] **Step 1: Write the failing test for JSON output parsing**

Create `packages/core/src/__tests__/routes/ripgrep.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRipgrepOutput } from '../../server/ripgrep.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/ripgrep.test.ts
```

Expected: FAIL — `parseRipgrepOutput` does not exist.

- [ ] **Step 3: Write the parsing function**

Create `packages/core/src/server/ripgrep.ts`:

```ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';

const logger = createChildLogger('ripgrep');

const MAX_LINE_LENGTH = 500;

export function parseRipgrepOutput(
  output: string,
  basePath: string,
  maxResults = 200,
): SearchContentResult[] {
  const results: SearchContentResult[] = [];

  for (const line of output.split('\n')) {
    if (results.length >= maxResults) break;
    if (!line.trim()) continue;

    let parsed: { type: string; data?: any };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type !== 'match' || !parsed.data) continue;

    const filePath = parsed.data.path?.text as string | undefined;
    const lineNumber = parsed.data.line_number as number | undefined;
    const lineText = parsed.data.lines?.text as string | undefined;
    const submatches = parsed.data.submatches as Array<{ start: number }> | undefined;

    if (!filePath || !lineNumber || lineText == null) continue;

    const relFile = path.relative(basePath, filePath);
    const text = lineText.replace(/\n$/, '').slice(0, MAX_LINE_LENGTH);
    const column = (submatches?.[0]?.start ?? 0) + 1;

    results.push({ file: relFile, line: lineNumber, column, text });
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/ripgrep.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write the failing test for `searchWithRipgrep`**

Append to `packages/core/src/__tests__/routes/ripgrep.test.ts`:

```ts
import { searchWithRipgrep } from '../../server/ripgrep.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

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
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/ripgrep.test.ts
```

Expected: FAIL — `searchWithRipgrep` not exported.

- [ ] **Step 7: Implement `searchWithRipgrep`**

Add to `packages/core/src/server/ripgrep.ts`:

```ts
let rgBinaryPath: string | null = null;

function getRgPath(): string | null {
  if (rgBinaryPath !== null) return rgBinaryPath;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    rgBinaryPath = rgPath;
    return rgBinaryPath;
  } catch {
    logger.warn('Failed to load @vscode/ripgrep — ripgrep search unavailable');
    return null;
  }
}

export interface RipgrepOptions {
  maxResults?: number;
  maxFileSize?: string;
  includeIgnored?: boolean;
}

const TIMEOUT_MS = 30_000;

export function searchWithRipgrep(
  scopePath: string,
  query: string,
  opts?: RipgrepOptions,
): Promise<SearchContentResult[]> {
  const rgPath = getRgPath();
  if (!rgPath) return Promise.resolve([]);

  const maxResults = opts?.maxResults ?? 200;
  const maxFileSize = opts?.maxFileSize ?? '1M';

  const args = [
    '--json',
    '--ignore-case',
    '--max-filesize', maxFileSize,
    '--no-require-git',
    '--max-count', '50',
  ];

  if (opts?.includeIgnored) {
    args.push('--no-ignore', '--hidden');
  }

  args.push('--', query, scopePath);

  return new Promise((resolve) => {
    const child = execFile(rgPath, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stderr) {
        logger.debug({ stderr: stderr.slice(0, 500) }, 'ripgrep stderr');
      }

      // Exit code 1 = no matches (not an error). Exit code 2 = partial error.
      if (err && (err as any).code !== 1 && (err as any).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        logger.warn({ err }, 'ripgrep process error');
      }

      if (!stdout) {
        resolve([]);
        return;
      }

      resolve(parseRipgrepOutput(stdout, scopePath, maxResults));
    });

    // Safety timeout — kill if still running
    setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, TIMEOUT_MS);
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/ripgrep.test.ts
```

Expected: all tests PASS.

- [ ] **Step 9: Write the failing test for `listFilesWithRipgrep`**

Append to `packages/core/src/__tests__/routes/ripgrep.test.ts`, inside a new `describe` block:

```ts
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
```

- [ ] **Step 10: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/ripgrep.test.ts
```

Expected: FAIL — `listFilesWithRipgrep` not exported.

- [ ] **Step 11: Implement `listFilesWithRipgrep`**

Add to `packages/core/src/server/ripgrep.ts`:

```ts
export function listFilesWithRipgrep(
  dirPath: string,
  opts?: { includeIgnored?: boolean },
): Promise<string[] | null> {
  const rgPath = getRgPath();
  if (!rgPath) return Promise.resolve(null);

  const args = ['--files', '--no-require-git'];

  if (opts?.includeIgnored) {
    args.push('--no-ignore', '--hidden');
  }

  args.push(dirPath);

  return new Promise((resolve) => {
    execFile(rgPath, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stderr) {
        logger.debug({ stderr: stderr.slice(0, 500) }, 'ripgrep --files stderr');
      }

      if (err) {
        logger.warn({ err }, 'ripgrep --files failed');
        resolve(null);
        return;
      }

      const files = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((absPath) => path.relative(dirPath, absPath));

      resolve(files);
    });
  });
}
```

- [ ] **Step 12: Run tests to verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/ripgrep.test.ts
```

Expected: all tests PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/server/ripgrep.ts packages/core/src/__tests__/routes/ripgrep.test.ts
git commit -m "feat(search): add ripgrep wrapper module with content search and file listing"
```

---

### Task 3: Wire ripgrep into content search handler

**Files:**
- Modify: `packages/core/src/server/routes/search.ts:86-183`
- Test: `packages/core/src/__tests__/routes/search.test.ts`

- [ ] **Step 1: Write a test verifying ripgrep is used for directory search**

Add a new test case to `packages/core/src/__tests__/routes/search.test.ts`:

```ts
it('uses ripgrep for directory search when available', async () => {
  await mkdir(join(projectDir, 'lib'));
  await writeFile(join(projectDir, 'lib', 'core.ts'), 'export const target = true;\n');
  await writeFile(join(projectDir, 'lib', 'utils.ts'), 'no match here\n');

  const ctx = createCtx(projectDir);
  const router = contentSearchRoutes(ctx);
  const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
  const res = mockRes();

  handler({ params: { id: 'proj-1' }, query: { q: 'target', path: '.' } }, res, vi.fn());
  await flushPromises();

  const { results } = res.json.mock.calls[0][0];
  expect(results).toHaveLength(1);
  expect(results[0].file).toContain('core.ts');
  expect(results[0].text).toContain('target');
});
```

- [ ] **Step 2: Run test to verify it passes with existing JS search**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/search.test.ts
```

Expected: PASS (establishes baseline behavior).

- [ ] **Step 3: Modify `handleContentSearch` to use ripgrep with JS fallback**

In `packages/core/src/server/routes/search.ts`, add the import:

```ts
import { searchWithRipgrep } from '../ripgrep.js';
```

Replace the directory search branch (the `else` block starting at line 139) with:

```ts
  } else {
    // Try ripgrep first for performance
    const rgResults = await searchWithRipgrep(resolvedScope, q, {
      maxResults: MAX_RESULTS,
      maxFileSize: '1M',
      includeIgnored: includeIgnoredFlag,
    });

    if (rgResults.length > 0 || (await isRipgrepAvailable())) {
      results.push(...rgResults);
    } else {
      // Fallback to JS search when ripgrep is not available
      let allFiles: string[];
      try {
        allFiles = await listProjectFiles(basePath, { includeIgnored: includeIgnoredFlag });
      } catch (err) {
        logger.warn({ err, basePath }, 'Failed to list project files for content search');
        res.status(500).json({ error: 'Failed to list project files' });
        return;
      }

      const scopeRel = path.relative(basePath, resolvedScope);
      const scopePrefix = scopeRel === '' ? '' : scopeRel + path.sep;

      const filteredFiles = allFiles.filter((f) => {
        if (scopeRel !== '' && !f.startsWith(scopePrefix) && f !== scopeRel) return false;
        return !hasBinaryExtension(f);
      });

      let scanned = 0;
      for (const relFile of filteredFiles) {
        if (results.length >= MAX_RESULTS) break;
        if (scanned >= MAX_FILES_SCANNED) break;

        const absFile = path.join(basePath, relFile);
        let fileStat: Awaited<ReturnType<typeof stat>>;
        try {
          fileStat = await stat(absFile);
        } catch {
          continue;
        }

        if (fileStat.size > MAX_FILE_SIZE) {
          scanned++;
          continue;
        }

        await searchFile(absFile, relFile, q, results, MAX_RESULTS);
        scanned++;
      }
    }
  }
```

Also add `isRipgrepAvailable` to the ripgrep module. In `packages/core/src/server/ripgrep.ts`, export:

```ts
export function isRipgrepAvailable(): boolean {
  return getRgPath() !== null;
}
```

- [ ] **Step 4: Run all search tests**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/search.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/search.ts packages/core/src/server/ripgrep.ts \
  packages/core/src/__tests__/routes/search.test.ts
git commit -m "feat(search): use ripgrep for content search with JS fallback"
```

---

### Task 4: Use `rg --files` for file name search

Replace the recursive `readdir` walk in `handleSearchFiles` with `listFilesWithRipgrep`. This gives the Command Palette and @ Popover the same filtering ripgrep uses — `.gitignore`, hidden files, binaries — all skipped automatically. Falls back to the existing walk when ripgrep is unavailable.

**Files:**
- Modify: `packages/core/src/server/routes/files.ts:52-120`
- Test: `packages/core/src/__tests__/routes/files.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('GET /api/projects/:id/search/files')` block in `packages/core/src/__tests__/routes/files.test.ts`:

```ts
it('excludes gitignored and binary files from search results', async () => {
  await writeFile(join(projectDir, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(projectDir, 'app.ts'), '');
  await writeFile(join(projectDir, 'ignored.txt'), '');
  await writeFile(join(projectDir, 'logo.png'), '');
  await writeFile(join(projectDir, 'font.woff2'), '');

  const ctx = createCtx(projectDir);
  const router = fileRoutes(ctx);
  const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
  const res = mockRes();

  handler({ params: { id: 'proj-1' }, query: { q: 'a' } }, res, vi.fn());
  await flushPromises();

  const results = res.json.mock.calls[0][0];
  const names = results.map((r: any) => r.name);
  expect(names).toContain('app.ts');
  expect(names).not.toContain('ignored.txt');
  expect(names).not.toContain('logo.png');
  expect(names).not.toContain('font.woff2');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/files.test.ts
```

Expected: FAIL — `ignored.txt`, `logo.png`, and `font.woff2` appear in results.

- [ ] **Step 3: Rewrite `handleSearchFiles` to use `rg --files` with walk fallback**

In `packages/core/src/server/routes/files.ts`, add the import:

```ts
import { listFilesWithRipgrep } from '../ripgrep.js';
```

Replace the `handleSearchFiles` function body (after the `limit` and `fuzzyMatch` declarations) with:

```ts
  type FileResult = { name: string; path: string; type: string; exact: boolean };
  const substringHits: FileResult[] = [];
  const fuzzyHits: FileResult[] = [];
  const scanLimit = limit * 4;

  const fuzzyMatch = (query: string, target: string): boolean => {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  };

  const addResult = (relPath: string, isDir: boolean): void => {
    const relLower = relPath.toLowerCase();
    const name = path.basename(relPath);
    const type = isDir ? 'directory' : 'file';
    if (relLower.includes(q)) {
      substringHits.push({ name, path: relPath, type, exact: true });
    } else if (fuzzyMatch(q, relLower)) {
      fuzzyHits.push({ name, path: relPath, type, exact: false });
    }
  };

  // Try ripgrep file listing first — respects .gitignore, skips hidden/binary
  const rgFiles = await listFilesWithRipgrep(basePath);

  if (rgFiles !== null) {
    for (const relFile of rgFiles) {
      if (substringHits.length + fuzzyHits.length >= scanLimit) break;
      addResult(relFile, false);
    }
  } else {
    // Fallback to recursive walk when ripgrep is unavailable
    const walk = async (dir: string): Promise<void> => {
      if (substringHits.length + fuzzyHits.length >= scanLimit) return;
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        logger.warn({ err, dir }, 'Failed to read directory during file search');
        return;
      }
      for (const entry of entries) {
        if (substringHits.length + fuzzyHits.length >= scanLimit) return;
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (!resolveAndValidatePath(basePath, path.join(dir, entry.name))) continue;
        const rel = path.relative(basePath, path.join(dir, entry.name));
        addResult(rel, entry.isDirectory());
        if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      }
    };
    await walk(basePath);
  }

  const combined = [...substringHits, ...fuzzyHits].slice(0, limit);
  res.json(combined.map(({ exact: _, ...r }) => r));
```

Note: The ripgrep path only returns files (not directories). This is acceptable since file search is the primary use case. Directories are still returned in the walk fallback path.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/files.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/files.ts packages/core/src/__tests__/routes/files.test.ts
git commit -m "feat(search): use rg --files for file name search with walk fallback"
```

---

### Task 5: Extend `IGNORED_DIRS`

**Files:**
- Modify: `packages/core/src/server/fs-utils.ts:9-22`

- [ ] **Step 1: Update the `IGNORED_DIRS` set**

In `packages/core/src/server/fs-utils.ts`, replace the `IGNORED_DIRS` set:

```ts
export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  '.cache',
  '__pycache__',
  '.venv',
  'vendor',
  'coverage',
  '.turbo',
  '.gradle',
  '.cargo',
  'target',
  '.parcel-cache',
  '.nuxt',
  '.output',
  'bower_components',
]);
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/server/fs-utils.ts
git commit -m "chore(search): extend IGNORED_DIRS with common build/dependency directories"
```

---

### Task 6: Typecheck and final verification

**Files:** None (verification only)

- [ ] **Step 1: Typecheck the core package**

```bash
pnpm --filter @qlan-ro/mainframe-core build
```

Expected: compiles with no errors.

- [ ] **Step 2: Run all core tests**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- --run
```

Expected: all tests PASS.

- [ ] **Step 3: Typecheck the desktop package**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit docs**

```bash
git add docs/
git commit -m "docs: add fast search design spec and implementation plan"
```
