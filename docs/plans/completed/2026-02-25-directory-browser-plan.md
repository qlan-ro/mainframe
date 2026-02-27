# Directory Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Electron-dependent file picker with a daemon-side directory browser so the renderer works identically in Electron and browser mode.

**Architecture:** Add a `GET /api/filesystem/browse` endpoint to the existing `files.ts` route file. The renderer gets a new `DirectoryPickerModal` component that lazy-loads directory contents from this endpoint. The Electron IPC file picker (`openDirectoryDialog`) is removed entirely.

**Tech Stack:** Express route handler, Zod validation, React modal component, existing `fetchJson` HTTP client.

---

### Task 1: Daemon — Zod schema for browse query

**Files:**
- Modify: `packages/core/src/server/routes/schemas.ts:46` (after `UpdateGeneralSettingsBody`)

**Step 1: Add the schema**

Add after line 45 in `schemas.ts`:

```typescript
// Filesystem browsing
export const BrowseFilesystemQuery = z.object({
  path: z.string().optional(),
});
```

**Step 2: Verify types build**

Run: `pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/src/server/routes/schemas.ts
git commit -m "feat(core): add BrowseFilesystemQuery zod schema"
```

---

### Task 2: Daemon — browse endpoint handler + tests

**Files:**
- Modify: `packages/core/src/server/routes/files.ts:211-234` (add handler + register route)
- Modify: `packages/core/src/__tests__/routes/files.test.ts` (add test cases)

**Step 1: Write the failing tests**

Add to `packages/core/src/__tests__/routes/files.test.ts`:

```typescript
describe('GET /api/filesystem/browse', () => {
  it('returns subdirectories of the given path', async () => {
    // Create test dirs inside a temp dir under homedir simulation
    await mkdir(join(projectDir, 'alpha'));
    await mkdir(join(projectDir, 'beta'));
    await writeFile(join(projectDir, 'file.txt'), 'hello');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    await handler({ query: { path: projectDir } } as any, res);

    expect(res.json).toHaveBeenCalledWith({
      path: projectDir,
      entries: [
        { name: 'alpha', path: expect.stringContaining('alpha') },
        { name: 'beta', path: expect.stringContaining('beta') },
      ],
    });
  });

  it('hides dotfiles and ignored dirs', async () => {
    await mkdir(join(projectDir, '.hidden'));
    await mkdir(join(projectDir, 'node_modules'));
    await mkdir(join(projectDir, 'visible'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    await handler({ query: { path: projectDir } } as any, res);

    const result = res.json.mock.calls[0][0];
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('visible');
  });

  it('rejects paths outside home directory', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    await handler({ query: { path: '/etc' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 404 for non-existent directory', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/filesystem/browse');
    const res = mockRes();

    await handler({ query: { path: join(projectDir, 'nonexistent') } } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mainframe/core test -- --reporter=verbose packages/core/src/__tests__/routes/files.test.ts`
Expected: FAIL — `No handler for GET /api/filesystem/browse`

**Step 3: Write the handler and register route**

Add to `packages/core/src/server/routes/files.ts` — import `homedir` from `node:os` at top, then add handler before `fileRoutes()`:

```typescript
import { homedir } from 'node:os';
```

Add handler function before `export function fileRoutes`:

```typescript
/** GET /api/filesystem/browse?path=~ */
async function handleBrowseFilesystem(_ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const homeDir = homedir();
  const requestedPath = (req.query.path as string) || homeDir;

  const resolved = resolveAndValidatePath(homeDir, requestedPath);
  if (!resolved) {
    res.status(403).json({ error: 'Path outside home directory' });
    return;
  }

  try {
    const dirents = await readdir(resolved, { withFileTypes: true });
    const entries = dirents
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ path: resolved, entries });
  } catch (err) {
    logger.warn({ err, path: requestedPath }, 'Failed to browse directory');
    res.status(404).json({ error: 'Directory not found' });
  }
}
```

Register the route in `fileRoutes()`:

```typescript
router.get(
  '/api/filesystem/browse',
  asyncHandler((req, res) => handleBrowseFilesystem(ctx, req, res)),
);
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mainframe/core test -- --reporter=verbose packages/core/src/__tests__/routes/files.test.ts`
Expected: PASS (note: the home-dir validation test may need adjustment since the temp dir may be under `/tmp` not `~/` — mock `homedir` or use a temp dir under `~/`)

**Step 5: Commit**

```bash
git add packages/core/src/server/routes/files.ts packages/core/src/__tests__/routes/files.test.ts
git commit -m "feat(core): add GET /api/filesystem/browse endpoint"
```

---

### Task 3: Renderer — API client function

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/files-api.ts` (add function)
- Modify: `packages/desktop/src/renderer/lib/api/index.ts` (re-export)

**Step 1: Add `browseFilesystem` to `files-api.ts`**

Add at end of file:

```typescript
export interface BrowseEntry {
  name: string;
  path: string;
}

export async function browseFilesystem(dirPath?: string): Promise<{ path: string; entries: BrowseEntry[] }> {
  const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  return fetchJson(`${API_BASE}/api/filesystem/browse${params}`);
}
```

**Step 2: Re-export from `index.ts`**

Add `browseFilesystem` to the `files-api` export block in `packages/desktop/src/renderer/lib/api/index.ts`.

**Step 3: Verify types build**

Run: `pnpm --filter @mainframe/desktop build` (or just typecheck)
Expected: PASS

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/files-api.ts packages/desktop/src/renderer/lib/api/index.ts
git commit -m "feat(desktop): add browseFilesystem API client"
```

---

### Task 4: Renderer — DirectoryPickerModal component

**Files:**
- Create: `packages/desktop/src/renderer/components/DirectoryPickerModal.tsx`

**Step 1: Create the component**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, X } from 'lucide-react';
import { browseFilesystem, type BrowseEntry } from '../lib/api/files-api';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:dir-picker');

interface DirNode {
  name: string;
  path: string;
  children?: DirNode[];
  loading?: boolean;
  expanded?: boolean;
}

interface DirectoryPickerModalProps {
  open: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function DirectoryPickerModal({ open, onSelect, onCancel }: DirectoryPickerModalProps): React.ReactElement | null {
  const [roots, setRoots] = useState<DirNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string>('');

  // Load home directory on open
  useEffect(() => {
    if (!open) return;
    setSelectedPath(null);
    browseFilesystem()
      .then((result) => {
        setHomePath(result.path);
        setRoots(result.entries.map((e) => ({ name: e.name, path: e.path })));
      })
      .catch((err) => log.warn('failed to load home directory', { err: String(err) }));
  }, [open]);

  const toggleExpand = useCallback(async (node: DirNode, path: number[]) => {
    setRoots((prev) => {
      const next = structuredClone(prev);
      let target = next;
      for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i]!]!.children!;
      }
      const n = target[path[path.length - 1]!]!;

      if (n.expanded) {
        n.expanded = false;
        return next;
      }

      if (n.children) {
        n.expanded = true;
        return next;
      }

      n.loading = true;
      n.expanded = true;

      // Fetch children async, then update
      browseFilesystem(n.path)
        .then((result) => {
          setRoots((prev2) => {
            const next2 = structuredClone(prev2);
            let t = next2;
            for (let i = 0; i < path.length - 1; i++) {
              t = t[path[i]!]!.children!;
            }
            const node2 = t[path[path.length - 1]!]!;
            node2.children = result.entries.map((e) => ({ name: e.name, path: e.path }));
            node2.loading = false;
            return next2;
          });
        })
        .catch((err) => {
          log.warn('failed to load directory', { err: String(err), path: n.path });
          setRoots((prev2) => {
            const next2 = structuredClone(prev2);
            let t = next2;
            for (let i = 0; i < path.length - 1; i++) {
              t = t[path[i]!]!.children!;
            }
            const node2 = t[path[path.length - 1]!]!;
            node2.loading = false;
            node2.children = [];
            return next2;
          });
        });

      return next;
    });
  }, []);

  if (!open) return null;

  const renderNode = (node: DirNode, indexPath: number[]): React.ReactElement => {
    const depth = indexPath.length - 1;
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <button
          onClick={() => {
            setSelectedPath(node.path);
            void toggleExpand(node, indexPath);
          }}
          className={`w-full flex items-center gap-1 px-2 py-1 text-mf-body text-left hover:bg-mf-app-bg transition-colors ${isSelected ? 'bg-mf-accent bg-opacity-20 text-mf-text-primary' : 'text-mf-text-secondary'}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} />
          <span className="truncate">{node.name}</span>
        </button>
        {node.expanded && node.children && (
          <div>
            {node.children.map((child, i) => renderNode(child, [...indexPath, i]))}
            {node.children.length === 0 && !node.loading && (
              <div className="text-mf-small text-mf-text-secondary" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
                Empty
              </div>
            )}
          </div>
        )}
        {node.expanded && node.loading && (
          <div className="text-mf-small text-mf-text-secondary" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            Loading...
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-[480px] max-h-[600px] bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
          <h2 className="text-mf-body font-semibold text-mf-text-primary">Select Project Directory</h2>
          <button onClick={onCancel} className="text-mf-text-secondary hover:text-mf-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-2 min-h-[300px]">
          {roots.length === 0 ? (
            <div className="px-4 py-8 text-center text-mf-text-secondary text-mf-body">Loading...</div>
          ) : (
            roots.map((node, i) => renderNode(node, [i]))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-mf-border">
          <span className="text-mf-small text-mf-text-secondary truncate max-w-[280px]">
            {selectedPath || homePath}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-mf-body text-mf-text-secondary hover:text-mf-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => selectedPath && onSelect(selectedPath)}
              disabled={!selectedPath}
              className="px-3 py-1.5 text-mf-body bg-mf-accent text-white rounded-mf-card disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify types build**

Run: `pnpm --filter @mainframe/desktop build` (or typecheck)
Expected: PASS

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/DirectoryPickerModal.tsx
git commit -m "feat(desktop): add DirectoryPickerModal component"
```

---

### Task 5: Integrate modal into TitleBar

**Files:**
- Modify: `packages/desktop/src/renderer/components/TitleBar.tsx:57-69` (replace `handleAddProject`)

**Step 1: Replace the Electron IPC call with modal state**

Add state and import at top of `TitleBar`:

```typescript
import { DirectoryPickerModal } from './DirectoryPickerModal';
```

Add state inside the component:

```typescript
const [dirPickerOpen, setDirPickerOpen] = useState(false);
```

Replace `handleAddProject` (lines 57-69):

```typescript
const handleAddProject = useCallback(() => {
  setDropdownOpen(false);
  setDirPickerOpen(true);
}, []);

const handleDirSelected = useCallback(async (selectedPath: string) => {
  setDirPickerOpen(false);
  try {
    const project = await createProject(selectedPath);
    addProject(project);
    setActiveProject(project.id);
  } catch (error) {
    log.warn('failed to add project', { err: String(error) });
  }
}, [addProject, setActiveProject]);
```

Update the "Add project" button `onClick` (line 224):

```tsx
onClick={() => void handleAddProject()}
```

Add modal at the end of the returned JSX, before the closing `</div>`:

```tsx
<DirectoryPickerModal
  open={dirPickerOpen}
  onSelect={(p) => void handleDirSelected(p)}
  onCancel={() => setDirPickerOpen(false)}
/>
```

**Step 2: Verify types build and manual test**

Run: `pnpm --filter @mainframe/desktop build`
Expected: PASS

Manual test: Open `dev:web` in browser, click project dropdown → "Add project" → modal opens, browse directories, select one → project created.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/TitleBar.tsx
git commit -m "feat(desktop): wire DirectoryPickerModal into TitleBar"
```

---

### Task 6: Cleanup — remove Electron IPC file picker

**Files:**
- Modify: `packages/desktop/src/preload/index.ts:9,24` (remove `openDirectoryDialog`)
- Modify: `packages/desktop/src/renderer/types/global.d.ts:9` (remove from type)
- Modify: `packages/desktop/src/main/index.ts:88-101` (remove IPC handler)

**Step 1: Remove from preload**

In `packages/desktop/src/preload/index.ts`:
- Remove `openDirectoryDialog` from the `MainframeAPI` interface (line 9)
- Remove `openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),` from the `api` object (line 24)

**Step 2: Remove from global type**

In `packages/desktop/src/renderer/types/global.d.ts`:
- Remove `openDirectoryDialog: () => Promise<string | null>;` (line 9)

**Step 3: Remove IPC handler from main**

In `packages/desktop/src/main/index.ts`:
- Remove the `ipcMain.handle('dialog:openDirectory', ...)` block (lines 88-101)
- Remove `dialog` from the electron import if it's no longer used elsewhere

**Step 4: Verify no remaining references**

Run: `grep -r "openDirectoryDialog" packages/desktop/src/` — should return no results.

**Step 5: Verify types build**

Run: `pnpm --filter @mainframe/desktop build`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/desktop/src/preload/index.ts packages/desktop/src/renderer/types/global.d.ts packages/desktop/src/main/index.ts
git commit -m "refactor(desktop): remove Electron openDirectoryDialog IPC"
```

---

### Task 7: End-to-end verification

**Step 1: Run all tests**

Run: `pnpm --filter @mainframe/core test && pnpm --filter @mainframe/desktop test`
Expected: PASS

**Step 2: Manual test — browser mode**

1. Start daemon: `pnpm dev:core`
2. Start web: `pnpm --filter @mainframe/desktop run dev:web`
3. Open `http://localhost:5173` in browser
4. Click project dropdown → "Add project"
5. Modal opens with home directory contents
6. Navigate to a project directory, select it
7. Project appears in sidebar

**Step 3: Manual test — Electron mode**

1. Start daemon: `pnpm dev:core`
2. Start Electron: `pnpm --filter @mainframe/desktop run dev`
3. Same flow as above — modal works identically

**Step 4: Verify path traversal is blocked**

Using curl: `curl "http://127.0.0.1:31415/api/filesystem/browse?path=/etc"`
Expected: `403 { "error": "Path outside home directory" }`
