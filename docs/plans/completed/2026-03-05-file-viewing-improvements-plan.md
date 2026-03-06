# File Viewing Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three improvements to file viewing in the desktop app: context files open in Monaco instead of inline preview, skills edit in Monaco instead of textarea, and non-text file renderers (images, SVG, PDF, CSV) in the file view panel.

**Architecture:** Extend the existing FileView/tab system to support pre-loaded content on editor tabs, replace the skill editor textarea with MonacoEditor, and add extension-based routing in FileViewContent to render specialized viewer components for non-text files. Binary file content is served via a new daemon endpoint.

**Tech Stack:** React, Monaco Editor (@monaco-editor/react), Zustand, Express, node:fs/promises

---

## Task 1: Context Files — Open in Monaco Instead of Inline Preview

### Context

`ContextFileItem.tsx` currently renders files as `<details>` + `<pre>` with inline content. Global and project context files already have `content` provided inline via `SessionContext`. Session files (mentions, modified, skills) are lazy-loaded via `getSessionFile()`.

The challenge: global files have `path: "CLAUDE.md"` (just filename, not absolute) and live in `~/.claude/`, not the project root. `openEditorTab("CLAUDE.md")` would try to load the project's CLAUDE.md. We solve this by adding an optional `content` field to the `'editor'` FileView type so `EditorTab` can skip the API fetch when content is pre-supplied.

### Files

- Modify: `packages/desktop/src/renderer/store/tabs.ts` — Add `content?: string` to editor FileView
- Modify: `packages/desktop/src/renderer/components/center/EditorTab.tsx` — Use provided content
- Modify: `packages/desktop/src/renderer/components/panels/ContextFileItem.tsx` — Replace with clickable row
- Modify: `packages/desktop/src/renderer/components/panels/ContextTab.tsx` — Pass source to ContextFileItem

### Step 1: Add optional `content` field to editor FileView

In `packages/desktop/src/renderer/store/tabs.ts`, add `content?: string` to the editor variant of `FileView`:

```typescript
export type FileView =
  | { type: 'editor'; filePath: string; label: string; content?: string }
  // ... rest unchanged
```

Update `openEditorTab` to accept optional content:

```typescript
openEditorTab: (filePath: string, content?: string) => {
  const label = filePath.split('/').pop() || filePath;
  expandRightPanel();
  set({ fileView: { type: 'editor', filePath, label, content }, fileViewCollapsed: false });
},
```

Don't persist inline content to localStorage (same pattern as inline diffs). Update the `subscribe` auto-save and `switchProject` to strip `content` from editor FileViews:

```typescript
// In the subscribe callback and switchProject, update the persistedFileView logic:
const persistedFileView =
  state.fileView?.type === 'diff' && state.fileView.source === 'inline'
    ? null
    : state.fileView?.type === 'editor' && state.fileView.content
      ? null
      : state.fileView;
```

### Step 2: Update EditorTab to use provided content

In `packages/desktop/src/renderer/components/center/EditorTab.tsx`, accept optional `content` prop and skip the API fetch when it's provided:

```typescript
export function EditorTab({ filePath, content: providedContent }: { filePath: string; content?: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [content, setContent] = useState<string | null>(providedContent ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providedContent !== undefined) {
      setContent(providedContent);
      return;
    }
    if (!activeProjectId) return;
    setContent(null);
    setError(null);
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => setContent(result.content))
      .catch(() => setError('Failed to load file'));
  }, [activeProjectId, filePath, activeChatId, providedContent]);

  // ... rest unchanged
```

Update `FileViewContent.tsx` to pass the content through:

```typescript
{fileView.type === 'editor' && <EditorTab filePath={fileView.filePath} content={fileView.content} />}
```

### Step 3: Replace ContextFileItem with clickable row

Rewrite `packages/desktop/src/renderer/components/panels/ContextFileItem.tsx`:

```typescript
import React from 'react';
import { FileText } from 'lucide-react';
import { useTabsStore } from '../../store/tabs';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  content?: string;
  badge?: string;
}

export function ContextFileItem({ path, displayName, content, badge }: ContextFileItemProps) {
  const fileName = displayName ?? path.split('/').pop() ?? path;
  const openEditorTab = useTabsStore((s) => s.openEditorTab);

  const handleClick = () => {
    openEditorTab(path, content);
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-2 py-1 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-small text-mf-text-primary w-full text-left"
    >
      <FileText size={14} className="text-mf-text-secondary shrink-0" />
      <span className="truncate" title={path}>
        {fileName}
      </span>
      {badge && (
        <span className="text-mf-status text-mf-text-secondary bg-mf-hover rounded-full px-1.5 shrink-0">
          {badge}
        </span>
      )}
    </button>
  );
}
```

Remove `chatId` prop — no longer needed (was only for lazy-loading inline content). Remove `useState`, `getSessionFile` import.

### Step 4: Update ContextTab.tsx

Remove the `chatId` prop from session file items since `ContextFileItem` no longer uses it. The `content` prop remains for global and project files (they already pass it).

For session files (mentions, modified, skills), the `content` prop is NOT passed — `EditorTab` will fetch it via the project files API. This works because session file paths are relative to the project root.

In `packages/desktop/src/renderer/components/panels/ContextTab.tsx`, remove `chatId` from:

```typescript
<ContextFileItem
  key={filePath}
  path={filePath}
  displayName={displayName}
  badge={badge}
/>
```

### Step 5: Typecheck

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`

### Step 6: Commit

```
feat(desktop): open context files in Monaco editor

Replace inline <details>/<pre> preview in ContextFileItem with a
clickable row that opens the file in the Monaco editor panel. Global
and project files pass pre-loaded content to skip the API fetch.
```

---

## Task 2: Skills Editing in Monaco

### Context

`SkillEditorTab.tsx` uses a plain `<textarea>` for editing. Replace it with `MonacoEditor` (language: `markdown`), keeping the existing save logic. Plugin-scoped skills remain read-only.

### Files

- Modify: `packages/desktop/src/renderer/components/center/SkillEditorTab.tsx`

### Step 1: Replace textarea with MonacoEditor

In `packages/desktop/src/renderer/components/center/SkillEditorTab.tsx`:

1. Import `MonacoEditor` from `'../editor/MonacoEditor'`
2. Replace the `<textarea>` with `<MonacoEditor>`
3. Wire `onChange` to update content state and set dirty flag
4. Remove the Save button header — use only Cmd+S (the MonacoEditor handles keyboard events via the document-level listener already in place)

Actually, keep the header for the save button and metadata display — just replace the textarea portion:

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { Save } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:skills');
import { useSkillsStore, useProjectsStore } from '../../store';
import { Button } from '../ui/button';
import { MonacoEditor } from '../editor/MonacoEditor';

export function SkillEditorTab({ skillId, adapterId }: { skillId: string; adapterId: string }): React.ReactElement {
  const { skills, updateSkill } = useSkillsStore();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const skill = skills.find((s) => s.id === skillId);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (skill) {
      setContent(skill.content);
      setDirty(false);
    }
  }, [skill?.id]);

  const handleSave = useCallback(async () => {
    if (!activeProject || !skill) return;
    setSaving(true);
    try {
      await updateSkill(adapterId, skillId, activeProject.path, content);
      setDirty(false);
    } catch (err) {
      log.error('save failed', { err: String(err) });
    } finally {
      setSaving(false);
    }
  }, [activeProject, skill, adapterId, skillId, content, updateSkill]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dirty, handleSave]);

  if (!skill) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Skill not found</div>
    );
  }

  const isReadOnly = skill.scope === 'plugin';

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-mf-divider shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-mf-body text-mf-text-primary font-medium">{skill.displayName || skill.name}</span>
          <span className="text-mf-label text-mf-text-secondary">{skill.scope} skill</span>
          {dirty && <span className="text-mf-label text-mf-warning">Modified</span>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || saving || isReadOnly}
          onClick={handleSave}
          className="h-7 px-2 text-mf-small"
        >
          <Save size={14} className="mr-1" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoEditor
          value={content}
          language="markdown"
          readOnly={isReadOnly}
          onChange={(val) => {
            if (val !== undefined) {
              setContent(val);
              setDirty(true);
            }
          }}
        />
      </div>
    </div>
  );
}
```

Key changes:
- Replace `<textarea>` with `<MonacoEditor>` wrapped in `<div className="flex-1 min-h-0">` (min-h-0 needed for flex child to shrink)
- Pass `readOnly={isReadOnly}` and `onChange` to MonacoEditor
- Remove `spellCheck`, `resize-none`, font classes (Monaco handles these)

### Step 2: Typecheck

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`

### Step 3: Commit

```
feat(desktop): use Monaco editor for skill editing

Replace plain textarea in SkillEditorTab with MonacoEditor component
using markdown language mode. Plugin-scoped skills remain read-only.
```

---

## Task 3: Binary File Content Endpoint

### Context

The current `GET /api/projects/:id/files` reads files as `utf-8` text. For images and PDFs, we need base64-encoded binary content. Add a query parameter `encoding=base64` to the existing endpoint.

### Files

- Modify: `packages/core/src/server/routes/files.ts` — Add base64 encoding support
- Modify: `packages/desktop/src/renderer/lib/api/files-api.ts` — Add `getFileBinary()` function

### Step 1: Add base64 encoding to the files endpoint

In `packages/core/src/server/routes/files.ts`, modify `handleFileContent`:

```typescript
async function handleFileContent(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'path query required' });
    return;
  }

  const encoding = req.query.encoding as string | undefined;

  try {
    const fullPath = resolveAndValidatePath(basePath, filePath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    const stats = await stat(fullPath);
    const maxSize = encoding === 'base64' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
    if (stats.size > maxSize) {
      res.status(413).json({ error: `File too large (max ${maxSize / 1024 / 1024}MB)` });
      return;
    }

    if (encoding === 'base64') {
      const buffer = await readFile(fullPath);
      res.json({ path: filePath, content: buffer.toString('base64'), encoding: 'base64' });
    } else {
      const content = await readFile(fullPath, 'utf-8');
      res.json({ path: filePath, content });
    }
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to read file content');
    res.status(404).json({ error: 'File not found' });
  }
}
```

### Step 2: Add getFileBinary to the desktop API

In `packages/desktop/src/renderer/lib/api/files-api.ts`, add:

```typescript
export async function getFileBinary(
  projectId: string,
  filePath: string,
  chatId?: string,
): Promise<{ path: string; content: string; encoding: 'base64' }> {
  const params = new URLSearchParams({ path: filePath, encoding: 'base64' });
  if (chatId) params.set('chatId', chatId);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/files?${params}`);
}
```

Export it from `packages/desktop/src/renderer/lib/api/index.ts` if not auto-exported.

### Step 3: Typecheck

Run: `pnpm --filter @mainframe/core exec tsc --noEmit && pnpm --filter @mainframe/desktop exec tsc --noEmit`

### Step 4: Commit

```
feat(core): support base64 encoding for binary file content

Add `encoding=base64` query parameter to GET /api/projects/:id/files
endpoint. Binary files (images, PDFs) get a 10MB limit vs 2MB for text.
Add getFileBinary() client function.
```

---

## Task 4: File Type Detection Utility

### Context

Multiple components need to know if a file is an image, SVG, PDF, CSV, or text. Create a shared utility.

### Files

- Create: `packages/desktop/src/renderer/lib/file-types.ts`

### Step 1: Create file type detection utility

```typescript
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);
const BINARY_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, 'pdf']);

export type FileViewerType = 'image' | 'svg' | 'pdf' | 'csv' | 'monaco';

export function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

export function getFileViewerType(filePath: string): FileViewerType {
  const ext = getFileExtension(filePath);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  return 'monaco';
}

export function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getFileExtension(filePath));
}
```

### Step 2: Commit

```
feat(desktop): add file type detection utility
```

---

## Task 5: Image Viewer Component

### Files

- Create: `packages/desktop/src/renderer/components/viewers/ImageViewer.tsx`

### Step 1: Create ImageViewer

```typescript
import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileBinary } from '../../lib/api';
import { getFileExtension } from '../../lib/file-types';

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export function ImageViewer({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setDataUrl(null);
    setError(null);
    getFileBinary(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        const mime = MIME_MAP[getFileExtension(filePath)] ?? 'application/octet-stream';
        setDataUrl(`data:${mime};base64,${result.content}`);
      })
      .catch(() => setError('Failed to load image'));
  }, [activeProjectId, filePath, activeChatId]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (!dataUrl) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>;
  }

  return (
    <div className="h-full flex items-center justify-center p-4 overflow-auto">
      <img src={dataUrl} className="max-w-full max-h-full object-contain" alt={filePath} />
    </div>
  );
}
```

### Step 2: Commit

```
feat(desktop): add ImageViewer component for file view panel
```

---

## Task 6: SVG Viewer Component

### Files

- Create: `packages/desktop/src/renderer/components/viewers/SvgViewer.tsx`

### Step 1: Create SvgViewer

SVG is text-based, so use the regular text API. Render via `<img>` with a data URL to prevent XSS from inline SVG.

```typescript
import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileContent } from '../../lib/api';

export function SvgViewer({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setDataUrl(null);
    setError(null);
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        const encoded = btoa(unescape(encodeURIComponent(result.content)));
        setDataUrl(`data:image/svg+xml;base64,${encoded}`);
      })
      .catch(() => setError('Failed to load SVG'));
  }, [activeProjectId, filePath, activeChatId]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (!dataUrl) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>;
  }

  return (
    <div className="h-full flex items-center justify-center p-4 overflow-auto bg-white/5 rounded">
      <img src={dataUrl} className="max-w-full max-h-full object-contain" alt={filePath} />
    </div>
  );
}
```

### Step 2: Commit

```
feat(desktop): add SvgViewer component for file view panel
```

---

## Task 7: PDF Viewer Component

### Files

- Create: `packages/desktop/src/renderer/components/viewers/PdfViewer.tsx`

### Step 1: Create PdfViewer

Use `<embed>` with a base64 data URL. Electron's Chromium has built-in PDF rendering.

```typescript
import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileBinary } from '../../lib/api';

export function PdfViewer({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setDataUrl(null);
    setError(null);
    getFileBinary(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        setDataUrl(`data:application/pdf;base64,${result.content}`);
      })
      .catch(() => setError('Failed to load PDF'));
  }, [activeProjectId, filePath, activeChatId]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (!dataUrl) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>;
  }

  return (
    <div className="h-full w-full">
      <embed src={dataUrl} type="application/pdf" className="h-full w-full" />
    </div>
  );
}
```

### Step 2: Commit

```
feat(desktop): add PdfViewer component for file view panel
```

---

## Task 8: CSV Viewer Component

### Files

- Create: `packages/desktop/src/renderer/components/viewers/CsvViewer.tsx`

### Step 1: Create CsvViewer

Parse CSV text and render as a styled HTML table. Use a simple parser that handles quoted fields.

```typescript
import React, { useEffect, useState, useMemo } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileContent } from '../../lib/api';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      row.push(field);
      field = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      if (ch === '\r') i++;
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

export function CsvViewer({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setRawContent(null);
    setError(null);
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => setRawContent(result.content))
      .catch(() => setError('Failed to load CSV'));
  }, [activeProjectId, filePath, activeChatId]);

  const rows = useMemo(() => (rawContent ? parseCsv(rawContent) : []), [rawContent]);
  const header = rows[0];
  const body = rows.slice(1);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (rawContent === null) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>;
  }

  if (!header || header.length === 0) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Empty CSV</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-mf-small font-mono">
        <thead className="sticky top-0 bg-mf-sidebar z-10">
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="text-left px-3 py-2 text-mf-text-primary font-medium border-b border-mf-divider whitespace-nowrap"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="hover:bg-mf-hover">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-mf-text-secondary border-b border-mf-divider/50 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Step 2: Commit

```
feat(desktop): add CsvViewer component for file view panel
```

---

## Task 9: Wire FileViewContent to Route Non-Text Files

### Files

- Modify: `packages/desktop/src/renderer/components/panels/FileViewContent.tsx`

### Step 1: Add extension-based routing

```typescript
import React, { Suspense } from 'react';
import { useTabsStore } from '../../store/tabs';
import { getFileViewerType } from '../../lib/file-types';

const EditorTab = React.lazy(() => import('../center/EditorTab').then((m) => ({ default: m.EditorTab })));
const DiffTab = React.lazy(() => import('../center/DiffTab').then((m) => ({ default: m.DiffTab })));
const SkillEditorTab = React.lazy(() =>
  import('../center/SkillEditorTab').then((m) => ({ default: m.SkillEditorTab })),
);
const ImageViewer = React.lazy(() => import('../viewers/ImageViewer').then((m) => ({ default: m.ImageViewer })));
const SvgViewer = React.lazy(() => import('../viewers/SvgViewer').then((m) => ({ default: m.SvgViewer })));
const PdfViewer = React.lazy(() => import('../viewers/PdfViewer').then((m) => ({ default: m.PdfViewer })));
const CsvViewer = React.lazy(() => import('../viewers/CsvViewer').then((m) => ({ default: m.CsvViewer })));

function EditorFallback(): React.ReactElement {
  return (
    <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading editor...</div>
  );
}

function renderEditorView(filePath: string, content?: string): React.ReactElement {
  const viewerType = getFileViewerType(filePath);
  switch (viewerType) {
    case 'image':
      return <ImageViewer filePath={filePath} />;
    case 'svg':
      return <SvgViewer filePath={filePath} />;
    case 'pdf':
      return <PdfViewer filePath={filePath} />;
    case 'csv':
      return <CsvViewer filePath={filePath} />;
    case 'monaco':
      return <EditorTab filePath={filePath} content={content} />;
  }
}

export function FileViewContent(): React.ReactElement | null {
  const fileView = useTabsStore((s) => s.fileView);
  if (!fileView) return null;

  return (
    <Suspense fallback={<EditorFallback />}>
      {fileView.type === 'editor' && renderEditorView(fileView.filePath, fileView.content)}
      {fileView.type === 'diff' && (
        <DiffTab
          filePath={fileView.filePath}
          source={fileView.source}
          chatId={fileView.chatId}
          oldPath={fileView.oldPath}
          original={fileView.original}
          modified={fileView.modified}
          startLine={fileView.startLine}
        />
      )}
      {fileView.type === 'skill-editor' && <SkillEditorTab skillId={fileView.skillId} adapterId={fileView.adapterId} />}
    </Suspense>
  );
}
```

### Step 2: Typecheck

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit && pnpm --filter @mainframe/core exec tsc --noEmit`

### Step 3: Commit

```
feat(desktop): route non-text files to specialized viewers

FileViewContent checks file extension and renders ImageViewer,
SvgViewer, PdfViewer, or CsvViewer instead of Monaco for non-text
files.
```

---

## Task 10: Final Verification

### Step 1: Full typecheck

Run: `pnpm build`

### Step 2: Verify no broken imports

Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`

### Step 3: Commit any fixups if needed
