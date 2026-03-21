# Find in Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IntelliJ-style "Find in Path" content search from the file tree context menu, plus fix existing file search to respect `.gitignore` via `git ls-files`.

**Architecture:** New `fs-utils.ts` utility provides git-aware file listing used by both the existing file name search and the new content search endpoint. Frontend adds a modal triggered from the file tree context menu, with results that open files at the matching line.

**Tech Stack:** TypeScript, Node.js, Express, React, Monaco Editor, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-find-in-path-design.md`

---

### Task 1: SearchContentResult type

**Files:**
- Create: `packages/types/src/search.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create the type file**

```ts
// packages/types/src/search.ts
export interface SearchContentResult {
  file: string;
  line: number;
  column: number;
  text: string;
}
```

- [ ] **Step 2: Export from index**

In `packages/types/src/index.ts`, add:

```ts
export * from './search.js';
```

- [ ] **Step 3: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: success, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/search.ts packages/types/src/index.ts
git commit -m "feat: add SearchContentResult type"
```

---

### Task 2: fs-utils — IGNORED_DIRS, BINARY_EXTENSIONS, listProjectFiles

**Files:**
- Create: `packages/core/src/server/fs-utils.ts`
- Modify: `packages/core/src/server/routes/files.ts` (remove local `IGNORED_DIRS`, import from `../fs-utils.js`)

- [ ] **Step 1: Create `fs-utils.ts` with constants and `listProjectFiles`**

Create `packages/core/src/server/fs-utils.ts`:

```ts
import { readdir, stat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execGit } from './routes/exec-git.js';
import { createChildLogger } from '../logger.js';

const logger = createChildLogger('fs-utils');

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
]);

export const BINARY_EXTENSIONS = new Set([
  '.class', '.jar', '.war', '.o', '.so', '.dylib', '.dll', '.exe',
  '.pyc', '.pyo', '.wasm', '.min.js', '.min.css', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.zip', '.tar', '.gz', '.pdf',
]);

export function hasBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  // Handle double extensions like .min.js
  if (BINARY_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.min.js') || base.endsWith('.min.css')) return true;
  return false;
}

interface ListOptions {
  includeIgnored?: boolean;
}

/**
 * List project files using git ls-files when available,
 * falling back to recursive walk with IGNORED_DIRS.
 */
export async function listProjectFiles(
  projectPath: string,
  options?: ListOptions,
): Promise<string[]> {
  const includeIgnored = options?.includeIgnored ?? false;

  if (!includeIgnored) {
    try {
      const output = await execGit(
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        projectPath,
      );
      return output.split('\n').filter((line) => line.length > 0);
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 128) {
        // Not a git repo — fall through to walk
      } else {
        logger.warn({ err }, 'git ls-files failed, falling back to walk');
      }
    }
  }

  // Fallback: recursive walk
  const files: string[] = [];
  const walkLimit = 10_000;

  const walk = async (dir: string): Promise<void> => {
    if (files.length >= walkLimit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= walkLimit) return;
      // When includeIgnored, only skip .git itself
      if (includeIgnored ? entry.name === '.git' : IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      // Symlink safety: resolve and verify within project root
      try {
        const resolved = await realpath(fullPath);
        const resolvedBase = await realpath(projectPath);
        if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) continue;
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(path.relative(projectPath, fullPath));
      }
    }
  };

  await walk(projectPath);
  return files;
}
```

- [ ] **Step 2: Migrate `files.ts` — remove local IGNORED_DIRS, import from fs-utils**

In `packages/core/src/server/routes/files.ts`:

Replace the local `IGNORED_DIRS` definition (lines 15-28) with an import:

```ts
import { IGNORED_DIRS } from '../fs-utils.js';
```

Remove the old `const IGNORED_DIRS = new Set([...]);` block.

- [ ] **Step 3: Build core to verify**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: success

- [ ] **Step 4: Run existing file route tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/files.test.ts`
Expected: all pass (IGNORED_DIRS behavior unchanged)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/fs-utils.ts packages/core/src/server/routes/files.ts
git commit -m "feat: extract IGNORED_DIRS to fs-utils, add git-aware listProjectFiles"
```

---

### Task 3: Content search endpoint

**Files:**
- Create: `packages/core/src/server/routes/search.ts`
- Modify: `packages/core/src/server/routes/index.ts`
- Modify: `packages/core/src/server/http.ts`

- [ ] **Step 1: Create the search route**

Create `packages/core/src/server/routes/search.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { getEffectivePath, param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { validate } from './schemas.js';
import { listProjectFiles, BINARY_EXTENSIONS, hasBinaryExtension } from '../fs-utils.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:search');

const MAX_RESULTS = 200;
const MAX_FILES_SCANNED = 5000;
const MAX_FILE_SIZE = 1_024 * 1_024; // 1 MB
const MAX_LINE_LENGTH = 500;

const SearchContentQuery = z.object({
  q: z.string().min(2),
  path: z.string().min(1),
  chatId: z.string().optional(),
  includeIgnored: z.string().optional(),
});

async function isWithinBase(basePath: string, targetPath: string): Promise<string | null> {
  try {
    const realBase = await realpath(basePath);
    const realTarget = await realpath(path.resolve(basePath, targetPath));
    if (realTarget.startsWith(realBase + path.sep) || realTarget === realBase) {
      return realTarget;
    }
    return null;
  } catch {
    return null;
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 512);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

async function searchFile(
  basePath: string,
  filePath: string,
  query: string,
  results: SearchContentResult[],
): Promise<void> {
  const fullPath = path.resolve(basePath, filePath);

  try {
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_SIZE) return;
  } catch {
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(fullPath);
  } catch {
    return;
  }

  if (isBinaryBuffer(buffer)) return;

  const content = buffer.toString('utf-8');
  const lines = content.split('\n');
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (results.length >= MAX_RESULTS) return;
    const line = lines[i]!;
    const col = line.toLowerCase().indexOf(lowerQuery);
    if (col === -1) continue;
    results.push({
      file: filePath,
      line: i + 1,
      column: col + 1,
      text: line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line,
    });
  }
}

async function handleSearchContent(
  ctx: RouteContext,
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = validate(SearchContentQuery, req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { q, path: scopePath, chatId, includeIgnored: includeIgnoredStr } = parsed.data;
  const includeIgnored = includeIgnoredStr === 'true';

  const basePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const resolvedScope = await isWithinBase(basePath, scopePath);
  if (!resolvedScope) {
    res.status(403).json({ error: 'Path outside project' });
    return;
  }

  const results: SearchContentResult[] = [];

  // Check if scoped path is a file or directory
  let scopeStat;
  try {
    scopeStat = await stat(resolvedScope);
  } catch {
    res.status(404).json({ error: 'Path not found' });
    return;
  }

  if (scopeStat.isFile()) {
    const relPath = path.relative(basePath, resolvedScope);
    await searchFile(basePath, relPath, q, results);
  } else {
    const allFiles = await listProjectFiles(basePath, { includeIgnored });
    const scopeRel = path.relative(basePath, resolvedScope);
    const scopePrefix = scopeRel === '.' || scopeRel === '' ? '' : scopeRel + path.sep;

    let scanned = 0;
    for (const file of allFiles) {
      if (results.length >= MAX_RESULTS || scanned >= MAX_FILES_SCANNED) break;
      if (scopePrefix && !file.startsWith(scopePrefix)) continue;
      if (hasBinaryExtension(file)) continue;
      scanned++;
      await searchFile(basePath, file, q, results);
    }
  }

  res.json({ results });
}

export function contentSearchRoutes(ctx: RouteContext): Router {
  const router = Router();
  router.get(
    '/api/projects/:id/search/content',
    asyncHandler((req, res) => handleSearchContent(ctx, req, res)),
  );
  return router;
}
```

- [ ] **Step 2: Export from routes index**

Add to `packages/core/src/server/routes/index.ts`:

```ts
export { contentSearchRoutes } from './search.js';
```

- [ ] **Step 3: Mount in http.ts**

In `packages/core/src/server/http.ts`, add `contentSearchRoutes` to the import:

```ts
import {
  // ... existing imports ...
  contentSearchRoutes,
} from './routes/index.js';
```

And add after the `fileRoutes` mount:

```ts
app.use(contentSearchRoutes(ctx));
```

- [ ] **Step 4: Build core**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/search.ts packages/core/src/server/routes/index.ts packages/core/src/server/http.ts
git commit -m "feat: add content search endpoint GET /api/projects/:id/search/content"
```

---

### Task 4: Content search tests

**Files:**
- Create: `packages/core/src/__tests__/routes/search.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/__tests__/routes/search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentSearchRoutes } from '../../server/routes/search.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 50));

let projectDir: string;

function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

function createCtx(dirPath: string): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: dirPath }),
      },
      chats: { list: vi.fn().mockReturnValue([]) },
      settings: { get: vi.fn().mockReturnValue(null) },
    } as any,
    chats: { getChat: vi.fn().mockReturnValue(null), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find(
    (l: any) => l.route?.path === routePath && l.route?.methods[method],
  );
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-search-test-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('GET /api/projects/:id/search/content', () => {
  it('finds text in a single file', async () => {
    await writeFile(join(projectDir, 'hello.txt'), 'line one\nfind me here\nline three');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler(
      { params: { id: 'proj-1' }, query: { q: 'find me', path: 'hello.txt' } },
      res,
      vi.fn(),
    );
    await flushPromises();

    const body = res.json.mock.calls[0][0];
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      file: 'hello.txt',
      line: 2,
      column: 1,
      text: 'find me here',
    });
  });

  it('searches directory recursively', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'a.ts'), 'const foo = 1;\n');
    await writeFile(join(projectDir, 'src', 'b.ts'), 'const bar = 2;\nconst foo = 3;\n');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler(
      { params: { id: 'proj-1' }, query: { q: 'foo', path: 'src' } },
      res,
      vi.fn(),
    );
    await flushPromises();

    const body = res.json.mock.calls[0][0];
    expect(body.results.length).toBeGreaterThanOrEqual(2);
    expect(body.results.every((r: any) => r.file.startsWith('src/'))).toBe(true);
  });

  it('rejects path traversal', async () => {
    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler(
      { params: { id: 'proj-1' }, query: { q: 'test', path: '../../etc' } },
      res,
      vi.fn(),
    );
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 for too-short query', async () => {
    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler(
      { params: { id: 'proj-1' }, query: { q: 'a', path: '.' } },
      res,
      vi.fn(),
    );
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('skips binary files by extension', async () => {
    await writeFile(join(projectDir, 'app.class'), 'findme binary content');
    await writeFile(join(projectDir, 'app.ts'), 'findme source content');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler(
      { params: { id: 'proj-1' }, query: { q: 'findme', path: '.' } },
      res,
      vi.fn(),
    );
    await flushPromises();

    const body = res.json.mock.calls[0][0];
    expect(body.results).toHaveLength(1);
    expect(body.results[0].file).toBe('app.ts');
  });

  it('case-insensitive matching', async () => {
    await writeFile(join(projectDir, 'test.txt'), 'Hello World');

    const ctx = createCtx(projectDir);
    const router = contentSearchRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/content');
    const res = mockRes();

    handler(
      { params: { id: 'proj-1' }, query: { q: 'hello', path: 'test.txt' } },
      res,
      vi.fn(),
    );
    await flushPromises();

    const body = res.json.mock.calls[0][0];
    expect(body.results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/search.test.ts`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/routes/search.test.ts
git commit -m "test: add content search endpoint tests"
```

---

### Task 5: Frontend API function — searchContent

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/files-api.ts`
- Modify: `packages/desktop/src/renderer/lib/api/index.ts`

- [ ] **Step 1: Add searchContent to files-api.ts**

Add to the end of `packages/desktop/src/renderer/lib/api/files-api.ts`:

```ts
import type { SearchContentResult } from '@qlan-ro/mainframe-types';

export async function searchContent(
  projectId: string,
  query: string,
  scopePath: string,
  includeIgnored?: boolean,
  chatId?: string,
  signal?: AbortSignal,
): Promise<SearchContentResult[]> {
  const params = new URLSearchParams({ q: query, path: scopePath });
  if (includeIgnored) params.set('includeIgnored', 'true');
  if (chatId) params.set('chatId', chatId);
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/search/content?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.results;
}
```

Note: `API_BASE` is already imported at the top of the file.

- [ ] **Step 2: Export from index**

Add `searchContent` to the exports in `packages/desktop/src/renderer/lib/api/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/files-api.ts packages/desktop/src/renderer/lib/api/index.ts
git commit -m "feat: add searchContent API function with AbortSignal support"
```

---

### Task 6: openEditorTab signature + scroll-to-line

**Files:**
- Modify: `packages/desktop/src/renderer/store/tabs.ts`
- Modify: `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx`
- Modify: `packages/desktop/src/renderer/components/center/EditorTab.tsx`
- Modify: `packages/desktop/src/renderer/components/panels/FileViewContent.tsx`
- Modify: `packages/desktop/src/renderer/components/panels/FilesTab.tsx` (call site)
- Modify: `packages/desktop/src/renderer/components/SearchPalette.tsx` (call site)

- [ ] **Step 1: Update FileView type and openEditorTab in tabs.ts**

In `packages/desktop/src/renderer/store/tabs.ts`:

Update the `FileView` editor variant (line 8) to add `line`:

```ts
| { type: 'editor'; filePath: string; label: string; content?: string; line?: number }
```

Update `openEditorTab` signature on the interface (line 47):

```ts
openEditorTab: (filePath: string, options?: { content?: string; line?: number }) => void;
```

Update the implementation (line 150-154):

```ts
openEditorTab: (filePath, options) => {
  const label = filePath.split('/').pop() || filePath;
  expandRightPanel();
  set({ fileView: { type: 'editor', filePath, label, content: options?.content, line: options?.line }, fileViewCollapsed: false });
},
```

Update both persistence blocks (in `switchProject` ~line 189-194 and in the subscribe callback ~line 221-226) to strip `line` from persisted fileView. In the condition that checks for editor content, also strip line:

```ts
const persistedFileView =
  state.fileView?.type === 'diff' && state.fileView.source === 'inline'
    ? null
    : state.fileView?.type === 'editor' && state.fileView.content
      ? null
      : state.fileView?.type === 'editor'
        ? { ...state.fileView, line: undefined }
        : state.fileView;
```

- [ ] **Step 2: Update MonacoEditor to accept initialLine**

In `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx`:

Add `initialLine` to props interface:

```ts
interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  filePath?: string;
  initialLine?: number;
  onChange?: (value: string | undefined) => void;
  onLineComment?: (line: number, lineContent: string, comment: string) => void;
}
```

Add to destructuring and capture as ref:

```ts
export function MonacoEditor({
  value,
  language,
  readOnly = true,
  filePath,
  initialLine,
  onChange,
  onLineComment,
}: MonacoEditorProps): React.ReactElement {
  const initialLineRef = useRef(initialLine);
```

In `handleMount` callback, after `editorRef.current = editor;` (line 46), add:

```ts
if (initialLineRef.current) {
  editor.revealLineInCenter(initialLineRef.current);
  editor.setPosition({ lineNumber: initialLineRef.current, column: 1 });
}
```

Do NOT add `initialLine` or `initialLineRef` to the `handleMount` dependency array.

- [ ] **Step 3: Update EditorTab to pass line**

In `packages/desktop/src/renderer/components/center/EditorTab.tsx`, update props:

```ts
export function EditorTab({
  filePath,
  content: providedContent,
  line,
}: {
  filePath: string;
  content?: string;
  line?: number;
}): React.ReactElement {
```

Pass to MonacoEditor:

```ts
<MonacoEditor
  value={currentContent}
  language={inferLanguage(filePath)}
  filePath={filePath}
  readOnly={false}
  initialLine={line}
  onChange={handleChange}
  onLineComment={handleLineComment}
/>
```

- [ ] **Step 4: Update FileViewContent to pass line**

In `packages/desktop/src/renderer/components/panels/FileViewContent.tsx`, update the `renderEditorView` function signature and the call in the render:

```ts
function renderEditorView(filePath: string, content?: string, line?: number): React.ReactElement {
```

And the `monaco` case:

```ts
case 'monaco':
  return <EditorTab filePath={filePath} content={content} line={line} />;
```

And in the JSX:

```ts
{fileView.type === 'editor' && renderEditorView(fileView.filePath, fileView.content, fileView.line)}
```

- [ ] **Step 5: Update call sites**

In `packages/desktop/src/renderer/components/panels/FilesTab.tsx` line 85:

```ts
// Before:
openEditorTab(entry.path);
// After (no change needed — second arg is optional):
openEditorTab(entry.path);
```

In `packages/desktop/src/renderer/components/SearchPalette.tsx` line 108:

```ts
// Before:
useTabsStore.getState().openEditorTab(item.id);
// After (no change needed — second arg is optional):
useTabsStore.getState().openEditorTab(item.id);
```

These call sites don't pass content, so no migration needed. Verify no other call sites pass a positional `content` arg:

Run: `grep -rn 'openEditorTab(' packages/desktop/src/`

If any call sites pass a second string arg (content), change to `openEditorTab(path, { content })`.

- [ ] **Step 6: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: success (typecheck passes)

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/store/tabs.ts \
  packages/desktop/src/renderer/components/editor/MonacoEditor.tsx \
  packages/desktop/src/renderer/components/center/EditorTab.tsx \
  packages/desktop/src/renderer/components/panels/FileViewContent.tsx \
  packages/desktop/src/renderer/components/SearchPalette.tsx \
  packages/desktop/src/renderer/components/panels/FilesTab.tsx
git commit -m "feat: add scroll-to-line support for editor tabs"
```

---

### Task 7: FindInPathModal component

**Files:**
- Create: `packages/desktop/src/renderer/components/FindInPathModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `packages/desktop/src/renderer/components/FindInPathModal.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, FileText, X } from 'lucide-react';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { useProjectsStore } from '../store';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { searchContent } from '../lib/api';

interface Props {
  scopePath: string;
  scopeType: 'file' | 'directory';
  onClose: () => void;
}

export function FindInPathModal({ scopePath, scopeType, onClose }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchContentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeChatId = useChatsStore((s) => s.activeChatId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.length < 2 || !activeProjectId) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      searchContent(
        activeProjectId,
        query,
        scopePath,
        includeIgnored,
        activeChatId ?? undefined,
        controller.signal,
      )
        .then((res) => {
          if (!controller.signal.aborted) {
            setResults(res);
            setSelectedIndex(0);
          }
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.warn('[FindInPath] search failed', err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timeout);
      abortRef.current?.abort();
    };
  }, [query, activeProjectId, activeChatId, scopePath, includeIgnored]);

  const handleSelect = useCallback(
    (result: SearchContentResult) => {
      useTabsStore.getState().openEditorTab(result.file, { line: result.line });
      onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
      }
    },
    [results, selectedIndex, handleSelect, onClose],
  );

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Group results by file
  const grouped = new Map<string, SearchContentResult[]>();
  for (const r of results) {
    const arr = grouped.get(r.file);
    if (arr) arr.push(r);
    else grouped.set(r.file, [r]);
  }

  const title = scopeType === 'file' ? 'Find in File' : 'Find in Path';
  const shortScope = scopePath === '.' ? '(project root)' : scopePath;

  return (
    <div className="fixed inset-0 z-50 flex justify-center" style={{ paddingTop: '15%' }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[560px] max-w-[90%] h-fit max-h-[60vh] bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-mf-border/50">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-mf-body font-medium text-mf-text-primary">{title}</span>
            <span className="text-mf-status text-mf-text-secondary truncate" title={scopePath}>
              {shortScope}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-mf-border/50">
          <Search size={14} className="text-mf-text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search text..."
            className="flex-1 bg-transparent text-mf-body text-mf-text-primary placeholder:text-mf-text-secondary/50 outline-none"
          />
        </div>

        {/* Include ignored checkbox (directory only) */}
        {scopeType === 'directory' && (
          <label className="flex items-center gap-2 px-3 py-1.5 text-mf-status text-mf-text-secondary cursor-pointer border-b border-mf-border/50">
            <input
              type="checkbox"
              checked={includeIgnored}
              onChange={(e) => setIncludeIgnored(e.target.checked)}
              className="rounded"
            />
            Include ignored files
          </label>
        )}

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto py-1 flex-1 min-h-0">
          {loading && results.length === 0 && (
            <div className="px-3 py-4 text-center text-mf-text-secondary text-mf-label">Searching...</div>
          )}

          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-3 py-4 text-center text-mf-text-secondary text-mf-label">No results found</div>
          )}

          {(() => {
            let flatIdx = 0;
            const items: React.ReactNode[] = [];

            for (const [file, hits] of grouped) {
              items.push(
                <div
                  key={`h-${file}`}
                  className="px-3 py-1 text-mf-status text-mf-text-secondary font-medium flex items-center gap-1 mt-1"
                >
                  <FileText size={12} className="shrink-0 opacity-60" />
                  <span className="truncate" title={file}>{file}</span>
                  <span className="opacity-50">({hits.length})</span>
                </div>,
              );

              for (const hit of hits) {
                const idx = flatIdx++;
                items.push(
                  <button
                    type="button"
                    key={`r-${hit.file}-${hit.line}`}
                    className={`w-[calc(100%-0.5rem)] text-left bg-transparent border-0 flex items-center gap-2 px-3 py-1 cursor-pointer rounded-mf-input mx-1 font-mono text-mf-status ${
                      idx === selectedIndex
                        ? 'bg-mf-hover text-mf-text-primary'
                        : 'text-mf-text-secondary hover:bg-mf-hover/50'
                    }`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => handleSelect(hit)}
                  >
                    <span className="text-mf-accent shrink-0 w-8 text-right opacity-60">{hit.line}</span>
                    <span className="truncate">{hit.text}</span>
                  </button>,
                );
              }
            }

            return items;
          })()}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-3 py-1.5 border-t border-mf-border/50 text-mf-status text-mf-text-secondary">
            {results.length} result{results.length !== 1 ? 's' : ''}
            {results.length >= 200 && ' (limit reached)'}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/FindInPathModal.tsx
git commit -m "feat: add FindInPathModal component"
```

---

### Task 8: Wire context menu + modal in FilesTab

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FilesTab.tsx`

- [ ] **Step 1: Add state and imports for FindInPathModal**

In `packages/desktop/src/renderer/components/panels/FilesTab.tsx`:

Add import at top:

```ts
import { FindInPathModal } from '../FindInPathModal';
```

In `FilesTab` component, add state after `contextMenu` state:

```ts
const [findInPath, setFindInPath] = useState<{ scopePath: string; scopeType: 'file' | 'directory' } | null>(null);
```

- [ ] **Step 2: Add context menu items**

In `handleContextMenu`, update the `items` array to add the find action before existing items. The `entryPath` is already the relative path. Determine type from context — if `entryPath === '.'` it's the root directory. Otherwise check if it matches a known directory or use the path itself:

```ts
const isDirectory = entryPath === '.' || rootEntries.find((e) => e.path === entryPath)?.type === 'directory';
```

Actually, a simpler approach — pass the entry type through. Update the `onContextMenu` callback signature to include type. In `handleContextMenu`, add the find item:

```ts
setContextMenu({
  x: e.clientX,
  y: e.clientY,
  items: [
    {
      label: isDirectory ? 'Find in Path...' : 'Find in File...',
      onClick: () => {
        setFindInPath({
          scopePath: entryPath,
          scopeType: isDirectory ? 'directory' : 'file',
        });
      },
    },
    {
      label: 'Reveal in Finder',
      onClick: () => {
        window.mainframe?.showItemInFolder(fullPath);
      },
    },
    {
      label: 'Copy Path',
      onClick: () => {
        navigator.clipboard.writeText(fullPath);
      },
    },
  ],
});
```

The tricky part is knowing whether the entry is a file or directory. The `handleContextMenu` is called with just the path string. Two approaches:

**Option A:** Change the callback to pass the entry type. Update `onContextMenu` signature in `FileTreeNode` to `(e: React.MouseEvent, entryPath: string, entryType: 'file' | 'directory') => void`. Each call site passes `entry.type`. The root folder passes `'directory'`.

**Option B:** Infer from the path — if it's `.` or ends with `/`, it's a directory. This is fragile.

Go with Option A:

In `FileTreeNode`, update the `onContextMenu` prop type:

```ts
onContextMenu: (e: React.MouseEvent, entryPath: string, entryType: 'file' | 'directory') => void;
```

Update the button's `onContextMenu` call:

```ts
onContextMenu={(e) => onContextMenu(e, entry.path, entry.type)}
```

In `FilesTab`, update `handleContextMenu` signature:

```ts
const handleContextMenu = useCallback(
  (e: React.MouseEvent, entryPath: string, entryType: 'file' | 'directory' = 'directory') => {
```

Update the root folder's `onContextMenu`:

```ts
onContextMenu={(e) => handleContextMenu(e, '.', 'directory')}
```

Then use `entryType` in the items array as shown above.

- [ ] **Step 3: Render FindInPathModal**

After the `ContextMenu` in the JSX return, add:

```tsx
{findInPath && (
  <FindInPathModal
    scopePath={findInPath.scopePath}
    scopeType={findInPath.scopeType}
    onClose={() => setFindInPath(null)}
  />
)}
```

- [ ] **Step 4: Build and verify**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FilesTab.tsx
git commit -m "feat: wire Find in Path context menu action in file tree"
```

---

### Task 9: Final typecheck + verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: all packages build successfully

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: all pass

- [ ] **Step 3: Verify no sync I/O in new code**

Run: `grep -rn 'realpathSync\|readFileSync\|statSync' packages/core/src/server/fs-utils.ts packages/core/src/server/routes/search.ts`
Expected: no matches

- [ ] **Step 4: Commit any remaining fixes, if needed**
