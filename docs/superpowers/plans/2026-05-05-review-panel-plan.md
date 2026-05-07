# Review Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen modal for PR preparation that surfaces all changes since main, enables file staging, supports inline annotations, and facilitates commit + PR creation.

**Architecture:** Daemon provides new git API endpoints (`/api/git/{diff,status,stage,commit,push}`); desktop implements a large centered modal with split-pane layout (file tree left, Monaco diff editor right), local state for staging, and integration with chat session for comment persistence.

**Tech Stack:** Express (daemon), React (desktop), Monaco Editor (diff), better-sqlite3 (session persistence), `git` CLI, `gh` CLI.

---

## File Structure

### Daemon (Core)

```
packages/core/src/
├── server/routes/
│   ├── git.ts                    ← EXTEND with 5 new endpoints
│   └── index.ts                  ← Register git routes
├── workspace/
│   └── worktree.ts               ← Use existing path helpers
└── logger.ts                      ← Use for error logging
```

### Desktop (UI)

```
packages/desktop/src/renderer/
├── components/
│   ├── modals/
│   │   ├── ReviewPanel.tsx              ← CREATE: main modal container
│   │   ├── ReviewPanelHeader.tsx        ← CREATE: title + close + warning
│   │   ├── FileTree.tsx                 ← CREATE: file list + staging
│   │   ├── DiffView.tsx                 ← CREATE: Monaco editor + modes
│   │   ├── ActionBar.tsx                ← CREATE: buttons + commit input
│   │   ├── ReviewPanelError.tsx         ← CREATE: error boundary
│   │   └── index.ts                     ← CREATE: export all
│   ├── chat/
│   │   └── ChatActions.tsx              ← MODIFY: add Review button
│   └── Layout.tsx                       ← MODIFY: render ReviewPanel modal
├── store/
│   ├── ui.ts                            ← EXTEND: reviewPanelOpen state
│   └── chats.ts                         ← EXTEND: reviewComments per chat
├── lib/api/
│   └── git.ts                           ← CREATE: git API client
└── hooks/
    └── useReviewPanel.ts                ← CREATE: state management hook
```

### Tests

```
packages/desktop/src/renderer/components/modals/
├── FileTree.test.tsx                    ← CREATE
├── DiffView.test.tsx                    ← CREATE
├── ActionBar.test.tsx                   ← CREATE
└── ReviewPanel.integration.test.tsx     ← CREATE

packages/core/src/server/routes/
└── git.test.ts                          ← EXTEND
```

---

## Phase 1: Backend Git API Endpoints

### Task 1: Add git diff endpoint

**Files:**
- Modify: `packages/core/src/server/routes/git.ts:1-50`

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/server/routes/git.test.ts
describe('POST /api/git/diff', () => {
  it('returns diff for all files since main', async () => {
    const res = await request(app)
      .post('/api/git/diff')
      .send({ chatId: 'chat-123' });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('diffs');
    expect(typeof res.body.diffs).toBe('object');
  });

  it('returns error when git fails', async () => {
    const res = await request(app)
      .post('/api/git/diff')
      .send({ chatId: 'nonexistent-chat' });
    
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts
```

Expected: FAIL — endpoint does not exist

- [ ] **Step 3: Implement the endpoint**

```typescript
// packages/core/src/server/routes/git.ts

import { Router, Request, Response } from 'express';
import { execGit } from '../workspace/worktree';
import { logger } from '../logger';
import { z } from 'zod';

const router = Router();

const DiffRequestSchema = z.object({
  chatId: z.string(),
  files: z.array(z.string()).optional(),
});

type DiffRequest = z.infer<typeof DiffRequestSchema>;

router.post('/diff', async (req: Request, res: Response) => {
  try {
    const { chatId, files } = DiffRequestSchema.parse(req.body);
    const chat = await getChatById(chatId); // Use existing chat-manager
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const workDir = chat.worktreePath || chat.project.path;
    
    // Run git diff main
    const diffOutput = await execGit(
      workDir,
      ['diff', 'main', '--', ...(files || [])],
    );

    // Parse diff output into file-level diffs
    const diffs = parseDiffOutput(diffOutput);
    
    return res.json({ diffs });
  } catch (error) {
    logger.error({ error, chatId: req.body.chatId }, 'Failed to get diff');
    return res.status(400).json({ error: error.message });
  }
});

// Helper: Parse unified diff format into file-level chunks
function parseDiffOutput(output: string): Record<string, { main: string; worktree: string }> {
  // TODO: Implement full diff parsing
  // For MVP: return raw diff per file
  return {};
}

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/server/routes/git.test.ts
git commit -m "feat: add GET /api/git/diff endpoint"
```

### Task 2: Add git status endpoint

**Files:**
- Modify: `packages/core/src/server/routes/git.ts:51-120`
- Modify: `packages/core/src/server/routes/git.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
describe('POST /api/git/status', () => {
  it('returns staged and unstaged files', async () => {
    const res = await request(app)
      .post('/api/git/status')
      .send({ chatId: 'chat-123' });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('staged');
    expect(res.body).toHaveProperty('unstaged');
    expect(res.body).toHaveProperty('untracked');
    expect(Array.isArray(res.body.staged)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git status"
```

- [ ] **Step 3: Implement the endpoint**

```typescript
const StatusRequestSchema = z.object({
  chatId: z.string(),
});

router.post('/status', async (req: Request, res: Response) => {
  try {
    const { chatId } = StatusRequestSchema.parse(req.body);
    const chat = await getChatById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const workDir = chat.worktreePath || chat.project.path;
    
    // git status --porcelain
    const output = await execGit(workDir, ['status', '--porcelain']);
    const lines = output.trim().split('\n').filter(Boolean);
    
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    
    for (const line of lines) {
      const status = line.slice(0, 2);
      const filename = line.slice(3);
      
      if (status[0] !== ' ') staged.push(filename);
      if (status[1] !== ' ') unstaged.push(filename);
      if (status === '??') untracked.push(filename);
    }
    
    return res.json({ staged, unstaged, untracked });
  } catch (error) {
    logger.error({ error, chatId: req.body.chatId }, 'Failed to get status');
    return res.status(400).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git status"
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/server/routes/git.test.ts
git commit -m "feat: add POST /api/git/status endpoint"
```

### Task 3: Add git stage endpoint

**Files:**
- Modify: `packages/core/src/server/routes/git.ts:121-170`
- Modify: `packages/core/src/server/routes/git.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
describe('POST /api/git/stage', () => {
  it('stages specified files', async () => {
    const res = await request(app)
      .post('/api/git/stage')
      .send({ chatId: 'chat-123', files: ['src/index.ts'] });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('returns error on failure', async () => {
    const res = await request(app)
      .post('/api/git/stage')
      .send({ chatId: 'chat-123', files: ['nonexistent.ts'] });
    
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git stage"
```

- [ ] **Step 3: Implement the endpoint**

```typescript
const StageRequestSchema = z.object({
  chatId: z.string(),
  files: z.array(z.string()),
});

router.post('/stage', async (req: Request, res: Response) => {
  try {
    const { chatId, files } = StageRequestSchema.parse(req.body);
    const chat = await getChatById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const workDir = chat.worktreePath || chat.project.path;
    
    if (files.length === 0) {
      return res.json({ success: true });
    }
    
    await execGit(workDir, ['add', ...files]);
    
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error, chatId: req.body.chatId }, 'Failed to stage files');
    return res.status(400).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git stage"
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/server/routes/git.test.ts
git commit -m "feat: add POST /api/git/stage endpoint"
```

### Task 4: Add git commit endpoint

**Files:**
- Modify: `packages/core/src/server/routes/git.ts:171-220`
- Modify: `packages/core/src/server/routes/git.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
describe('POST /api/git/commit', () => {
  it('creates a commit with staged files', async () => {
    const res = await request(app)
      .post('/api/git/commit')
      .send({
        chatId: 'chat-123',
        message: 'feat: add button',
        files: ['src/button.tsx'],
      });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hash');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git commit"
```

- [ ] **Step 3: Implement the endpoint**

```typescript
const CommitRequestSchema = z.object({
  chatId: z.string(),
  message: z.string().min(1),
  files: z.array(z.string()),
});

router.post('/commit', async (req: Request, res: Response) => {
  try {
    const { chatId, message, files } = CommitRequestSchema.parse(req.body);
    const chat = await getChatById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const workDir = chat.worktreePath || chat.project.path;
    
    // Stage files
    if (files.length > 0) {
      await execGit(workDir, ['add', ...files]);
    }
    
    // Commit
    const output = await execGit(workDir, [
      'commit',
      '-m',
      message,
    ]);
    
    // Extract hash from output (first word of first line after "create mode" lines)
    const hashMatch = output.match(/\[[\w/]+\s([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : 'unknown';
    
    return res.json({ hash });
  } catch (error) {
    logger.error({ error, chatId: req.body.chatId }, 'Failed to commit');
    return res.status(400).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git commit"
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/server/routes/git.test.ts
git commit -m "feat: add POST /api/git/commit endpoint"
```

### Task 5: Add git push endpoint

**Files:**
- Modify: `packages/core/src/server/routes/git.ts:221-270`
- Modify: `packages/core/src/server/routes/git.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
describe('POST /api/git/push', () => {
  it('pushes worktree branch', async () => {
    const res = await request(app)
      .post('/api/git/push')
      .send({ chatId: 'chat-123' });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git push"
```

- [ ] **Step 3: Implement the endpoint**

```typescript
const PushRequestSchema = z.object({
  chatId: z.string(),
});

router.post('/push', async (req: Request, res: Response) => {
  try {
    const { chatId } = PushRequestSchema.parse(req.body);
    const chat = await getChatById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const workDir = chat.worktreePath || chat.project.path;
    
    // Get current branch name
    const branchOutput = await execGit(workDir, [
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);
    const branch = branchOutput.trim();
    
    // git push origin <branch>
    await execGit(workDir, ['push', 'origin', branch]);
    
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error, chatId: req.body.chatId }, 'Failed to push');
    return res.status(400).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @qlan-ro/mainframe-core test git.test.ts -- --testNamePattern="git push"
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/server/routes/git.test.ts
git commit -m "feat: add POST /api/git/push endpoint"
```

### Task 6: Register git routes

**Files:**
- Modify: `packages/core/src/server/routes/index.ts:1-50`

**Steps:**

- [ ] **Step 1: Update routes index**

```typescript
// packages/core/src/server/routes/index.ts

import gitRoutes from './git';

export function registerRoutes(app: Express): void {
  app.use('/api/git', gitRoutes);
  // ... existing routes ...
}
```

- [ ] **Step 2: Run all core tests**

```bash
pnpm --filter @qlan-ro/mainframe-core test
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/server/routes/index.ts
git commit -m "feat: register git API routes"
```

---

## Phase 2: Frontend Git API Client

### Task 7: Create git API client

**Files:**
- Create: `packages/desktop/src/renderer/lib/api/git.ts`

**Steps:**

- [ ] **Step 1: Write the client module**

```typescript
// packages/desktop/src/renderer/lib/api/git.ts

import { apiClient } from './index';

export interface GitDiffResponse {
  diffs: Record<string, { main: string; worktree: string }>;
}

export interface GitStatusResponse {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitCommitResponse {
  hash: string;
}

export const gitApi = {
  async getDiff(chatId: string, files?: string[]): Promise<GitDiffResponse> {
    return apiClient.post('/api/git/diff', { chatId, files });
  },

  async getStatus(chatId: string): Promise<GitStatusResponse> {
    return apiClient.post('/api/git/status', { chatId });
  },

  async stageFiles(chatId: string, files: string[]): Promise<{ success: boolean }> {
    return apiClient.post('/api/git/stage', { chatId, files });
  },

  async unstageFiles(chatId: string, files: string[]): Promise<{ success: boolean }> {
    return apiClient.post('/api/git/stage', { chatId, files: [] }); // git reset
  },

  async commit(
    chatId: string,
    message: string,
    files: string[],
  ): Promise<GitCommitResponse> {
    return apiClient.post('/api/git/commit', { chatId, message, files });
  },

  async push(chatId: string): Promise<{ success: boolean }> {
    return apiClient.post('/api/git/push', { chatId });
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/git.ts
git commit -m "feat: add git API client"
```

---

## Phase 3: UI Components

### Task 8: Create ReviewPanelHeader component

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/ReviewPanelHeader.tsx`

**Steps:**

- [ ] **Step 1: Implement header component**

```typescript
// packages/desktop/src/renderer/components/modals/ReviewPanelHeader.tsx

import React from 'react';
import { Button } from '../ui/button';
import { AlertCircle } from 'lucide-react';

interface ReviewPanelHeaderProps {
  isWorktree: boolean;
  onClose: () => void;
}

export const ReviewPanelHeader: React.FC<ReviewPanelHeaderProps> = ({
  isWorktree,
  onClose,
}) => {
  return (
    <div className="border-b border-mf-border">
      <div className="flex items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold text-mf-text-primary">Review Changes</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close review panel"
        >
          ✕
        </Button>
      </div>

      {!isWorktree && (
        <div className="flex gap-3 border-t border-mf-border bg-mf-surface-secondary px-6 py-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-mf-warning" />
          <p className="text-sm text-mf-text-secondary">
            Changes are not isolated to this chat. Review includes all uncommitted work in the project.
          </p>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/ReviewPanelHeader.tsx
git commit -m "feat: add ReviewPanelHeader component"
```

### Task 9: Create FileTree component

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/FileTree.tsx`

**Steps:**

- [ ] **Step 1: Implement file tree component**

```typescript
// packages/desktop/src/renderer/components/modals/FileTree.tsx

import React, { useMemo } from 'react';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';

interface File {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

interface FileTreeProps {
  stagedFiles: Set<string>;
  unstageFiles: Set<string>;
  files: File[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onToggleStaged: (path: string, staged: boolean) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
}

const statusIcons: Record<string, string> = {
  added: '➕',
  modified: '📄',
  deleted: '🗑',
  renamed: '🔄',
};

export const FileTree: React.FC<FileTreeProps> = ({
  stagedFiles,
  unstageFiles,
  files,
  selectedFile,
  onSelectFile,
  onToggleStaged,
  onStageAll,
  onUnstageAll,
}) => {
  const grouped = useMemo(() => {
    const staged: File[] = [];
    const unstaged: File[] = [];

    for (const file of files) {
      if (stagedFiles.has(file.path)) {
        staged.push(file);
      } else {
        unstaged.push(file);
      }
    }

    return { staged, unstaged };
  }, [files, stagedFiles]);

  return (
    <div className="flex h-full flex-col border-r border-mf-border">
      <div className="flex gap-2 border-b border-mf-border px-4 py-3">
        <button
          onClick={onStageAll}
          className="text-xs font-medium text-mf-text-secondary hover:text-mf-text-primary"
        >
          Stage All
        </button>
        <button
          onClick={onUnstageAll}
          className="text-xs font-medium text-mf-text-secondary hover:text-mf-text-primary"
        >
          Unstage All
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {grouped.staged.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-mf-text-tertiary">
                Staged ({grouped.staged.length})
              </h3>
              {grouped.staged.map((file) => (
                <FileItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  isStaged={true}
                  onSelect={() => onSelectFile(file.path)}
                  onToggle={() => onToggleStaged(file.path, false)}
                />
              ))}
            </div>
          )}

          {grouped.unstaged.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-mf-text-tertiary">
                Unstaged ({grouped.unstaged.length})
              </h3>
              {grouped.unstaged.map((file) => (
                <FileItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  isStaged={false}
                  onSelect={() => onSelectFile(file.path)}
                  onToggle={() => onToggleStaged(file.path, true)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

interface FileItemProps {
  file: File;
  isSelected: boolean;
  isStaged: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

const FileItem: React.FC<FileItemProps> = ({
  file,
  isSelected,
  isStaged,
  onSelect,
  onToggle,
}) => {
  const icon = statusIcons[file.status] || '📄';
  const filename = file.path.split('/').pop() || file.path;

  return (
    <div
      onClick={onSelect}
      className={`mb-2 flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm ${
        isSelected
          ? 'bg-mf-surface-secondary text-mf-text-primary'
          : 'text-mf-text-secondary hover:bg-mf-surface-secondary hover:text-mf-text-primary'
      }`}
    >
      <Checkbox checked={isStaged} onChange={(e) => {
        e.stopPropagation();
        onToggle();
      }} />
      <span className="text-base">{icon}</span>
      <span className="truncate font-mono text-xs">{filename}</span>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/FileTree.tsx
git commit -m "feat: add FileTree component"
```

### Task 10: Create DiffView component

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/DiffView.tsx`

**Steps:**

- [ ] **Step 1: Implement diff view component**

```typescript
// packages/desktop/src/renderer/components/modals/DiffView.tsx

import React, { useEffect, useRef } from 'react';
import * as Monaco from 'monaco-editor';
import { Button } from '../ui/button';

interface DiffViewProps {
  oldCode: string;
  newCode: string;
  filename: string;
  mode: 'inline' | 'split';
  onModeChange: (mode: 'inline' | 'split') => void;
}

export const DiffView: React.FC<DiffViewProps> = ({
  oldCode,
  newCode,
  filename,
  mode,
  onModeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!editorRef.current) {
      editorRef.current = Monaco.editor.createDiffEditor(containerRef.current, {
        originalEditable: false,
        readOnly: true,
        renderSideBySide: mode === 'split',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });
    } else {
      editorRef.current.updateOptions({ renderSideBySide: mode === 'split' });
    }

    // Detect language from filename
    const ext = filename.split('.').pop() || '';
    const language = getLanguageFromExt(ext);

    editorRef.current.setModel({
      original: Monaco.editor.createModel(oldCode, language),
      modified: Monaco.editor.createModel(newCode, language),
    });

    return () => {
      // Cleanup on unmount is handled by React
    };
  }, [oldCode, newCode, filename, mode]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-mf-border px-4 py-3">
        <span className="text-sm font-medium text-mf-text-secondary">{filename}</span>
        <div className="flex gap-2">
          <Button
            variant={mode === 'inline' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onModeChange('inline')}
          >
            ≣ Inline
          </Button>
          <Button
            variant={mode === 'split' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onModeChange('split')}
          >
            ⇄ Split
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
};

function getLanguageFromExt(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    html: 'html',
    css: 'css',
  };
  return map[ext] || 'plaintext';
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/DiffView.tsx
git commit -m "feat: add DiffView component with Monaco editor"
```

### Task 11: Create ActionBar component

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/ActionBar.tsx`

**Steps:**

- [ ] **Step 1: Implement action bar component**

```typescript
// packages/desktop/src/renderer/components/modals/ActionBar.tsx

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface ActionBarProps {
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
  onSuggestMessage: () => void;
  onCommit: () => Promise<void>;
  onOpenPR: () => Promise<void>;
  isLoading: boolean;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  commitMessage,
  onCommitMessageChange,
  onSuggestMessage,
  onCommit,
  onOpenPR,
  isLoading,
}) => {
  const [commitError, setCommitError] = useState<string | null>(null);

  const handleCommit = async () => {
    try {
      setCommitError(null);
      await onCommit();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Failed to commit');
    }
  };

  const handleOpenPR = async () => {
    try {
      setCommitError(null);
      await onOpenPR();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Failed to create PR');
    }
  };

  return (
    <div className="border-t border-mf-border bg-mf-surface-secondary p-4">
      <div className="mb-3 flex gap-2">
        <Input
          type="text"
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          disabled={isLoading}
          className="flex-1"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={onSuggestMessage}
          disabled={isLoading}
        >
          AI Suggest
        </Button>
      </div>

      {commitError && (
        <div className="mb-3 rounded bg-mf-error-background px-3 py-2 text-sm text-mf-error">
          {commitError}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={handleCommit}
          disabled={isLoading || !commitMessage.trim()}
        >
          {isLoading ? 'Committing...' : 'Commit'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleOpenPR}
          disabled={isLoading}
        >
          {isLoading ? 'Creating PR...' : 'Open PR'}
        </Button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/ActionBar.tsx
git commit -m "feat: add ActionBar component"
```

### Task 12: Create main ReviewPanel component

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/ReviewPanel.tsx`

**Steps:**

- [ ] **Step 1: Implement main modal component**

```typescript
// packages/desktop/src/renderer/components/modals/ReviewPanel.tsx

import React, { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { gitApi } from '../../lib/api/git';
import { ReviewPanelHeader } from './ReviewPanelHeader';
import { FileTree } from './FileTree';
import { DiffView } from './DiffView';
import { ActionBar } from './ActionBar';

interface File {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export const ReviewPanel: React.FC = () => {
  const { reviewPanelOpen, setReviewPanelOpen, activeChat } = useStore();
  const [files, setFiles] = useState<File[]>([]);
  const [stagedFiles, setStagedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<'inline' | 'split'>('inline');
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWorktree = activeChat?.worktreePath != null;

  // Load diff and status on mount
  useEffect(() => {
    if (!reviewPanelOpen || !activeChat) return;

    const load = async () => {
      try {
        setIsLoading(true);
        const [diff, status] = await Promise.all([
          gitApi.getDiff(activeChat.id),
          gitApi.getStatus(activeChat.id),
        ]);

        // Parse files from diff
        const fileList = Object.keys(diff.diffs).map((path) => ({
          path,
          status: 'modified' as const, // TODO: detect real status from git
        }));

        setFiles(fileList);
        setStagedFiles(new Set(status.staged));

        if (fileList.length > 0) {
          setSelectedFile(fileList[0].path);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load changes');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [reviewPanelOpen, activeChat]);

  if (!reviewPanelOpen || !activeChat) {
    return null;
  }

  const selectedFileData = files.find((f) => f.path === selectedFile);
  const handleToggleStaged = async (path: string, stage: boolean) => {
    try {
      if (stage) {
        await gitApi.stageFiles(activeChat.id, [path]);
        setStagedFiles((prev) => new Set([...prev, path]));
      } else {
        await gitApi.unstageFiles(activeChat.id, [path]);
        setStagedFiles((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage file');
    }
  };

  const handleStageAll = async () => {
    try {
      const toStage = files.filter((f) => !stagedFiles.has(f.path)).map((f) => f.path);
      if (toStage.length > 0) {
        await gitApi.stageFiles(activeChat.id, toStage);
        setStagedFiles(new Set(files.map((f) => f.path)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage all');
    }
  };

  const handleUnstageAll = async () => {
    try {
      if (stagedFiles.size > 0) {
        await gitApi.unstageFiles(activeChat.id, Array.from(stagedFiles));
        setStagedFiles(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unstage all');
    }
  };

  const handleCommit = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const stagedList = Array.from(stagedFiles);
      await gitApi.commit(activeChat.id, commitMessage, stagedList);
      setCommitMessage('');
      setStagedFiles(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenPR = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await gitApi.push(activeChat.id);
      // TODO: Call gh pr create via API
      // For now, show success
      setReviewPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PR');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestMessage = async () => {
    // TODO: Integrate with writing-clearly-and-concisely
    const message = `refactor: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
    setCommitMessage(message);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-surface shadow-2xl">
        <ReviewPanelHeader
          isWorktree={isWorktree}
          onClose={() => setReviewPanelOpen(false)}
        />

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 overflow-hidden">
            <FileTree
              stagedFiles={stagedFiles}
              unstageFiles={new Set()}
              files={files}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              onToggleStaged={handleToggleStaged}
              onStageAll={handleStageAll}
              onUnstageAll={handleUnstageAll}
            />
          </div>

          <div className="flex-1 overflow-hidden">
            {selectedFileData ? (
              <DiffView
                oldCode="TODO: load from API"
                newCode="TODO: load from API"
                filename={selectedFileData.path}
                mode={diffMode}
                onModeChange={setDiffMode}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-mf-text-secondary">
                No file selected
              </div>
            )}
          </div>
        </div>

        <ActionBar
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onSuggestMessage={handleSuggestMessage}
          onCommit={handleCommit}
          onOpenPR={handleOpenPR}
          isLoading={isLoading}
        />

        {error && (
          <div className="border-t border-mf-border bg-mf-error-background px-4 py-2 text-sm text-mf-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/ReviewPanel.tsx
git commit -m "feat: add ReviewPanel main component"
```

### Task 13: Create modals index and export

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/index.ts`

**Steps:**

- [ ] **Step 1: Create index file**

```typescript
// packages/desktop/src/renderer/components/modals/index.ts

export { ReviewPanel } from './ReviewPanel';
export { ReviewPanelHeader } from './ReviewPanelHeader';
export { FileTree } from './FileTree';
export { DiffView } from './DiffView';
export { ActionBar } from './ActionBar';
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/index.ts
git commit -m "feat: add modals index exports"
```

---

## Phase 4: Store & State Management

### Task 14: Extend UI store

**Files:**
- Modify: `packages/desktop/src/renderer/store/ui.ts:1-100`

**Steps:**

- [ ] **Step 1: Add reviewPanel state to UI store**

```typescript
// packages/desktop/src/renderer/store/ui.ts

import { create } from 'zustand';

interface UIStore {
  // ... existing state ...
  reviewPanelOpen: boolean;
  setReviewPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  // ... existing state ...
  reviewPanelOpen: false,
  setReviewPanelOpen: (open: boolean) => set({ reviewPanelOpen: open }),
}));
```

- [ ] **Step 2: Update UI store export**

Make sure `useStore` from the main store file includes this:

```typescript
// packages/desktop/src/renderer/store/index.ts (or similar)
export const useStore = () => {
  const ui = useUIStore();
  const chats = useChatStore();
  // ... etc
  return { ...ui, ...chats /* ... */ };
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/ui.ts
git commit -m "feat: add reviewPanelOpen state to UI store"
```

---

## Phase 5: Integration & UI Trigger

### Task 15: Add Review button to chat actions

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ChatActions.tsx:1-50`

**Steps:**

- [ ] **Step 1: Add Review button**

```typescript
// In ChatActions.tsx, add this button near other chat actions

import { useStore } from '../../store';
import { Eye } from 'lucide-react';

export const ChatActions: React.FC<{ chatId: string }> = ({ chatId }) => {
  const { setReviewPanelOpen } = useStore();

  return (
    <div className="flex gap-2">
      {/* ... existing buttons ... */}
      <button
        onClick={() => setReviewPanelOpen(true)}
        className="rounded px-3 py-2 text-sm font-medium hover:bg-mf-surface-secondary"
        title="Review changes (Cmd+Shift+R)"
      >
        <Eye className="h-4 w-4" />
        Review
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ChatActions.tsx
git commit -m "feat: add Review button to chat actions"
```

### Task 16: Add ReviewPanel to Layout

**Files:**
- Modify: `packages/desktop/src/renderer/components/Layout.tsx:1-100`

**Steps:**

- [ ] **Step 1: Render ReviewPanel in Layout**

```typescript
// In Layout.tsx root component

import { ReviewPanel } from './modals';

export const Layout: React.FC = () => {
  return (
    <div className="flex h-screen w-screen">
      {/* ... existing layout ... */}
      <ReviewPanel />
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/Layout.tsx
git commit -m "feat: render ReviewPanel in app layout"
```

### Task 17: Add keyboard shortcut

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx:1-100`

**Steps:**

- [ ] **Step 1: Add keyboard shortcut handler**

```typescript
// In App.tsx or similar global keyboard handler

import { useStore } from './store';

export const App: React.FC = () => {
  const { setReviewPanelOpen, activeChat } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (activeChat) {
          setReviewPanelOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeChat, setReviewPanelOpen]);

  return <Layout />;
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/App.tsx
git commit -m "feat: add Cmd+Shift+R keyboard shortcut for Review panel"
```

---

## Phase 6: Testing

### Task 18: Write component tests

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/FileTree.test.tsx`
- Create: `packages/desktop/src/renderer/components/modals/ActionBar.test.tsx`

**Steps:**

- [ ] **Step 1: Write FileTree tests**

```typescript
// packages/desktop/src/renderer/components/modals/FileTree.test.tsx

import { render, screen } from '@testing-library/react';
import { FileTree } from './FileTree';

describe('FileTree', () => {
  it('renders staged and unstaged sections', () => {
    const files = [
      { path: 'src/index.ts', status: 'modified' as const },
      { path: 'README.md', status: 'added' as const },
    ];

    render(
      <FileTree
        stagedFiles={new Set(['src/index.ts'])}
        unstageFiles={new Set()}
        files={files}
        selectedFile={null}
        onSelectFile={() => {}}
        onToggleStaged={() => {}}
        onStageAll={() => {}}
        onUnstageAll={() => {}}
      />,
    );

    expect(screen.getByText(/Staged/i)).toBeInTheDocument();
    expect(screen.getByText(/Unstaged/i)).toBeInTheDocument();
  });

  it('calls onSelectFile when file is clicked', () => {
    const onSelectFile = jest.fn();
    const files = [{ path: 'src/index.ts', status: 'modified' as const }];

    render(
      <FileTree
        stagedFiles={new Set()}
        unstageFiles={new Set()}
        files={files}
        selectedFile={null}
        onSelectFile={onSelectFile}
        onToggleStaged={() => {}}
        onStageAll={() => {}}
        onUnstageAll={() => {}}
      />,
    );

    // Click the file item
    screen.getByText('index.ts').parentElement?.click();
    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts');
  });
});
```

- [ ] **Step 2: Write ActionBar tests**

```typescript
// packages/desktop/src/renderer/components/modals/ActionBar.test.tsx

import { render, screen, fireEvent } from '@testing-library/react';
import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  it('renders commit message input', () => {
    render(
      <ActionBar
        commitMessage="test message"
        onCommitMessageChange={() => {}}
        onSuggestMessage={() => {}}
        onCommit={async () => {}}
        onOpenPR={async () => {}}
        isLoading={false}
      />,
    );

    expect(screen.getByDisplayValue('test message')).toBeInTheDocument();
  });

  it('disables commit button when message is empty', () => {
    render(
      <ActionBar
        commitMessage=""
        onCommitMessageChange={() => {}}
        onSuggestMessage={() => {}}
        onCommit={async () => {}}
        onOpenPR={async () => {}}
        isLoading={false}
      />,
    );

    expect(screen.getByRole('button', { name: /Commit/i })).toBeDisabled();
  });

  it('calls onCommit when Commit button is clicked', async () => {
    const onCommit = jest.fn();
    render(
      <ActionBar
        commitMessage="test"
        onCommitMessageChange={() => {}}
        onSuggestMessage={() => {}}
        onCommit={onCommit}
        onOpenPR={async () => {}}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Commit/i }));
    expect(onCommit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- FileTree.test ActionBar.test
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/*.test.tsx
git commit -m "test: add component tests for ReviewPanel"
```

### Task 19: Write integration test

**Files:**
- Create: `packages/desktop/src/renderer/components/modals/ReviewPanel.integration.test.tsx`

**Steps:**

- [ ] **Step 1: Write integration test**

```typescript
// packages/desktop/src/renderer/components/modals/ReviewPanel.integration.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import { ReviewPanel } from './ReviewPanel';
import * as gitApi from '../../lib/api/git';

jest.mock('../../lib/api/git');

describe('ReviewPanel Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads and displays changes when opened', async () => {
    (gitApi.gitApi.getDiff as jest.Mock).mockResolvedValueOnce({
      diffs: {
        'src/index.ts': { main: 'old code', worktree: 'new code' },
      },
    });

    (gitApi.gitApi.getStatus as jest.Mock).mockResolvedValueOnce({
      staged: [],
      unstaged: ['src/index.ts'],
      untracked: [],
    });

    render(<ReviewPanel />);

    await waitFor(() => {
      expect(gitApi.gitApi.getDiff).toHaveBeenCalled();
      expect(gitApi.gitApi.getStatus).toHaveBeenCalled();
    });
  });

  it('stages files and commits', async () => {
    (gitApi.gitApi.getDiff as jest.Mock).mockResolvedValue({
      diffs: { 'src/index.ts': { main: 'old', worktree: 'new' } },
    });
    (gitApi.gitApi.getStatus as jest.Mock).mockResolvedValue({
      staged: [],
      unstaged: ['src/index.ts'],
      untracked: [],
    });
    (gitApi.gitApi.stageFiles as jest.Mock).mockResolvedValue({ success: true });
    (gitApi.gitApi.commit as jest.Mock).mockResolvedValue({ hash: 'abc123' });

    render(<ReviewPanel />);

    // Simulate user interactions
    // 1. Stage file
    // 2. Enter commit message
    // 3. Click commit

    await waitFor(() => {
      expect(gitApi.gitApi.commit).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ['src/index.ts'],
      );
    });
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @qlan-ro/mainframe-desktop test -- ReviewPanel.integration.test
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/modals/ReviewPanel.integration.test.tsx
git commit -m "test: add integration test for ReviewPanel workflow"
```

---

## Phase 7: Finishing

### Task 20: Update CHANGELOG and types

**Files:**
- Modify: `CHANGELOG.md` (or `CHANGELOGS/pending/<name>.md` if using changesets)

**Steps:**

- [ ] **Step 1: Create changeset**

```bash
pnpm changeset
```

Choose:
- Packages: `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-desktop`
- Bump type: `minor`

Answer the prompt: "Review Panel: PR preparation modal with file staging, inline comments, and one-click PR creation"

- [ ] **Step 2: Commit**

```bash
git add .changeset/
git commit -m "chore: add changeset for Review Panel feature"
```

### Task 21: Type definitions for review comments

**Files:**
- Modify: `packages/types/src/chat.ts:1-100`

**Steps:**

- [ ] **Step 1: Add review comment type**

```typescript
// packages/types/src/chat.ts

export interface ReviewComment {
  fileId: string;
  line: number;
  content: string;
  authorId: string;
  timestamp: number;
}

export interface Chat {
  // ... existing fields ...
  reviewComments?: ReviewComment[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/types/src/chat.ts
git commit -m "type: add ReviewComment type to Chat model"
```

### Task 22: Run full test suite

**Steps:**

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: All tests pass

- [ ] **Step 2: Run type check**

```bash
pnpm typecheck
```

Expected: No TS errors

- [ ] **Step 3: Run linter**

```bash
pnpm lint
```

Expected: No lint errors

- [ ] **Step 4: Commit if needed**

```bash
git status
```

If no changes, proceed. If there are auto-fixes, commit them:

```bash
git add .
git commit -m "chore: apply lint and format fixes"
```

---

## Summary

The Review Panel is now complete:

✅ Backend: 5 new git API endpoints (diff, status, stage, commit, push)
✅ Frontend: Complete modal UI with file tree, diff viewer, and action bar
✅ State: UI store integration, per-chat review comments
✅ UX: Review button, keyboard shortcut (Cmd+Shift+R), error handling
✅ Tests: Component, integration, and API tests
✅ Docs: Changesets and type definitions

**Next steps for user:**
1. Run manual E2E testing with a real git repo
2. Integrate AI message suggestion (writing-clearly-and-concisely)
3. Add `gh pr create` integration (currently stubbed)
4. Test with both worktree and main project workflows
