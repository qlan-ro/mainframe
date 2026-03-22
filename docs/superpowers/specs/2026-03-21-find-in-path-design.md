# Find in Path — Design Spec

## Overview

Add an IntelliJ-style "Find in Path" feature to the file tree, plus fix the existing file search to respect `.gitignore`. Right-click a folder or file in the file tree to search file contents for text. Results display in a modal with clickable results that open the file at the matching line.

## Part 1: Git-aware file listing utility

### Problem

`IGNORED_DIRS` is a hardcoded Set that can't cover every ecosystem (missing `target/`, `.gradle/`, etc.). The existing file search returns compiled binaries and build artifacts from directories not in the list.

### Solution

New utility `listProjectFiles(projectPath, options?)` in `packages/core/src/server/fs-utils.ts` (outside `routes/` — this is pure logic, not a route handler).

- **Default (includeIgnored=false):** Runs `git ls-files --cached --others --exclude-standard` via `execGit`. Returns tracked + untracked-but-not-ignored files. This respects `.gitignore` natively.
- **Non-git detection:** Catch errors where `code === 128` from `execGit` → fall back to recursive walk with `IGNORED_DIRS`. All other errors propagate.
- **includeIgnored=true:** Always uses recursive directory walk, skipping only `.git` itself.
- Returns `string[]` of relative paths from the project root.
- **Symlink safety (walk mode):** Resolve each directory entry with async `realpath` (`fs/promises`) and verify it stays within project root before descending.

### Constants in `fs-utils.ts`

`IGNORED_DIRS` — extracted from `files.ts`, re-exported for existing consumers.

`BINARY_EXTENSIONS` — used only by content search (Part 2), not by `listProjectFiles` itself. This avoids breaking `handleFilesList` callers that need binary file paths.

```
.class .jar .war .o .so .dylib .dll .exe .pyc .pyo .wasm
.min.js .min.css .map
.png .jpg .jpeg .gif .ico .svg .woff .woff2 .ttf .eot
.mp3 .mp4 .zip .tar .gz .pdf
```

### Migration of existing handlers

- `handleSearchFiles`: Replace manual walk with `listProjectFiles()`, then filter/score the returned paths. This removes the sync `resolveAndValidatePath` call from the walk loop entirely.
- `handleFilesList`: Replace manual walk with `listProjectFiles()`. Same removal of sync call.
- Both handlers import `IGNORED_DIRS` from `../fs-utils.js` instead of defining it locally.

**Note:** `resolveAndValidatePath` in `path-utils.ts` still uses sync `realpathSync`. The single-call usages in `handleTree`, `handleFileContent`, `handleWriteFile` are tolerable for now (one call per request). A full async migration of `path-utils.ts` is a follow-up, not part of this spec.

## Part 2: Content search endpoint

### `GET /api/projects/:id/search/content`

**Query params (Zod-validated):**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string (min 2) | yes | Search text |
| `path` | string | yes | Relative path — file or directory |
| `chatId` | string | no | For worktree resolution |
| `includeIgnored` | string (`"true"`) | no | Include gitignored files (default false) |

**Response:** `{ results: SearchContentResult[] }`

**Error responses:** `{ error: string }` with status 400 (invalid params), 403 (path outside project), 404 (project/path not found).

```ts
// In packages/types/src/search.ts, exported from index.ts
interface SearchContentResult {
  file: string;   // relative path from project root
  line: number;   // 1-based
  column: number; // 1-based (matches Monaco convention)
  text: string;   // the matching line content (leading whitespace preserved), max 500 chars
}
```

**Implementation** in `packages/core/src/server/routes/search.ts`:

1. Resolve effective path via `getEffectivePath()`.
2. Validate scoped `path` with async realpath + prefix check: `await realpath(resolve(basePath, path))` then check `startsWith(basePath)`.
3. If `path` is a file: read and search that single file (size + binary guards still apply). `includeIgnored` is ignored (no-op) for single-file mode.
4. If `path` is a directory: get file list from `listProjectFiles(basePath, { includeIgnored })`, filter to paths under the scoped directory, filter out `BINARY_EXTENSIONS`, then search each file.
5. For each file: skip if > 1 MB, skip if binary (null byte in first 512 bytes), read as UTF-8, scan line-by-line for case-insensitive substring match.

**Limits:**
- Max 200 results returned.
- Max 5000 files scanned (return partial results, not an error).
- Per-file size cap: 1 MB.

### Route registration

Factory `contentSearchRoutes(ctx: RouteContext): Router` in `search.ts`. Mounted in `http.ts` and exported from `routes/index.ts`.

### Tests

New file `packages/core/src/__tests__/routes/search.test.ts` covering: git-based file listing, non-git fallback, single-file mode, binary skip, size cap, result limit, path traversal rejection.

## Part 3: Frontend — FindInPathModal

### Context menu additions

In `FilesTab.tsx`, add to the context menu:
- **Directories:** "Find in Path..." → opens modal scoped to that directory
- **Files:** "Find in File..." → opens modal scoped to that file

### Modal component

New file: `packages/desktop/src/renderer/components/FindInPathModal.tsx` (alongside existing modals like `DirectoryPickerModal.tsx`, `SettingsModal.tsx`).

**Props:** `{ scopePath: string; scopeType: 'file' | 'directory'; onClose: () => void }`

**Layout:**
- Title: "Find in File" or "Find in Path" based on scope type
- Scoped path displayed as subtitle (muted text)
- Text input (autofocused)
- Checkbox: "Include ignored files" (unchecked by default, only shown for directory scope)
- Results grouped by file, each hit shows `lineNumber: text snippet`
- Result count in footer
- Empty state when no results

**Behavior:**
- 300ms debounce, min 2 chars.
- `AbortController` cancels in-flight requests on new query.
- Arrow keys navigate results, Enter opens selected.
- Escape / backdrop click closes.
- Clicking a result → `openEditorTab(filePath, { line })` → closes modal.

### API function

In `files-api.ts`, use `fetch` directly (not `fetchJson`) to support `AbortSignal`:

```ts
function searchContent(
  projectId: string,
  query: string,
  path: string,
  includeIgnored?: boolean,
  chatId?: string,
  signal?: AbortSignal
): Promise<{ results: SearchContentResult[] }>
```

## Part 4: Scroll-to-line support

### FileView type

Add optional `line` to the editor variant:

```ts
| { type: 'editor'; filePath: string; label: string; content?: string; line?: number }
```

**Persistence:** Strip `line` from the `FileView` before writing to `projectTabs` (same treatment as inline diff content). `line` is a transient scroll position, not meaningful after session restore.

### openEditorTab

Change signature to accept optional options:

```ts
openEditorTab: (filePath: string, options?: { content?: string; line?: number }) => void
```

Update all existing call sites (FilesTab, SearchPalette) — they currently pass `content` as second arg, change to `{ content }`.

### MonacoEditor

Add `initialLine?: number` prop. Capture as ref to avoid `handleMount` dependency issues:

```ts
const initialLineRef = useRef(initialLine);
// In handleMount:
if (initialLineRef.current) {
  editor.revealLineInCenter(initialLineRef.current);
  editor.setPosition({ lineNumber: initialLineRef.current, column: 1 });
}
```

Do NOT add `initialLine` to the `handleMount` dependency array — it's consumed once on mount only.

### EditorTab

Pass `line` from `fileView` through to `<MonacoEditor initialLine={line} />`.

## File changes summary

| File | Change |
|------|--------|
| `packages/types/src/search.ts` | New — `SearchContentResult` type |
| `packages/types/src/index.ts` | Re-export search types |
| `packages/core/src/server/fs-utils.ts` | New — `IGNORED_DIRS`, `BINARY_EXTENSIONS`, `listProjectFiles()` |
| `packages/core/src/server/routes/search.ts` | New — content search endpoint |
| `packages/core/src/server/routes/files.ts` | Import from `fs-utils`, migrate search/list to `listProjectFiles()` |
| `packages/core/src/server/routes/index.ts` | Export search routes |
| `packages/core/src/server/http.ts` | Mount search routes |
| `packages/core/src/__tests__/routes/search.test.ts` | New — content search tests |
| `packages/desktop/.../components/FindInPathModal.tsx` | New — search modal |
| `packages/desktop/.../panels/FilesTab.tsx` | Context menu items, wire modal |
| `packages/desktop/.../lib/api/files-api.ts` | `searchContent()` with AbortSignal |
| `packages/desktop/.../store/tabs.ts` | `FileView` editor variant gains `line`, `openEditorTab` signature update, strip `line` from persistence |
| `packages/desktop/.../editor/MonacoEditor.tsx` | `initialLine` prop via ref → `revealLineInCenter` |
| `packages/desktop/.../center/EditorTab.tsx` | Pass `line` to MonacoEditor |
| `packages/desktop/.../SearchPalette.tsx` | Update `openEditorTab` call site |
