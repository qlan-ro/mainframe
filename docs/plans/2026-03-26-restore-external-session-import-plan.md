# Restore External Session Import UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-add the external session import button to the unified sessions panel header, with a popover for browsing and importing external Claude sessions.

**Architecture:** A `Download` icon button in the `ChatsPanel` header opens an `ImportSessionsPopover`. When a project filter is active, the popover fetches and lists that project's external sessions. When "All" is selected, the popover first shows a project picker. The button is disabled (with tooltip) when `externalSessionCount === 0`. On import, the popover closes immediately.

**Tech Stack:** React, Zustand, lucide-react, existing API functions (`getExternalSessions`, `importExternalSession`)

---

### Task 1: Create ImportSessionsPopover component

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/ImportSessionsPopover.tsx`

This component handles two states: project selection (when no `projectId` prop) and session listing (when `projectId` is provided or user picks one).

- [ ] **Step 1: Create the popover file with the project picker view**

```tsx
// packages/desktop/src/renderer/components/panels/ImportSessionsPopover.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, GitBranch, Clock, Loader2 } from 'lucide-react';
import type { ExternalSession, Project } from '@qlan-ro/mainframe-types';
import { getExternalSessions, importExternalSession } from '../../lib/api';
import { useChatsStore } from '../../store';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:import-sessions');

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  if (diffDays < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  if (diffDays < 14) return 'Last week';
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ImportSessionsPopoverProps {
  projects: Project[];
  activeProjectId: string | null;
  filterProjectId: string | null;
  onClose: () => void;
}

export function ImportSessionsPopover({
  projects,
  activeProjectId,
  filterProjectId,
  onClose,
}: ImportSessionsPopoverProps): React.ReactElement {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(filterProjectId);
  const [sessions, setSessions] = useState<ExternalSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const addChat = useChatsStore((s) => s.addChat);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-import-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Fetch sessions when a project is selected
  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    getExternalSessions(selectedProjectId)
      .then(setSessions)
      .catch((err) => log.warn('failed to fetch external sessions', { err: String(err) }))
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  const handleImport = useCallback(
    async (session: ExternalSession) => {
      if (!selectedProjectId || importing) return;
      setImporting(session.sessionId);
      try {
        const chat = await importExternalSession(
          selectedProjectId,
          session.sessionId,
          session.adapterId,
          session.firstPrompt?.slice(0, 80),
        );
        addChat(chat);
        onClose();
      } catch (err) {
        log.warn('import failed', { err: String(err) });
        setImporting(null);
      }
    },
    [selectedProjectId, importing, addChat, onClose],
  );

  // Sort: active project first, then alphabetical
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (a.id === activeProjectId) return -1;
      if (b.id === activeProjectId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [projects, activeProjectId]);

  // Project picker view
  if (!selectedProjectId) {
    return (
      <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] max-w-[280px] bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1">
        <div className="px-3 py-1.5 text-mf-status text-mf-text-secondary uppercase tracking-wider">
          Select project
        </div>
        {sortedProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => setSelectedProjectId(project.id)}
            className="w-full text-left px-3 py-1.5 text-mf-small truncate hover:bg-mf-hover transition-colors text-mf-text-primary"
            title={project.path}
          >
            {project.name}
          </button>
        ))}
      </div>
    );
  }

  // Session list view
  return (
    <div className="absolute right-0 top-full mt-1 z-50 min-w-[260px] max-w-[360px] bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1">
      {loading ? (
        <div className="px-3 py-4 flex items-center justify-center text-mf-text-secondary">
          <Loader2 size={14} className="animate-spin mr-2" />
          <span className="text-mf-small">Loading sessions...</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="px-3 py-3 text-mf-small text-mf-text-secondary text-center">
          No importable sessions
        </div>
      ) : (
        sessions.map((session) => (
          <div
            key={session.sessionId}
            data-testid="external-session-item"
            className="px-3 py-2 hover:bg-mf-hover transition-colors flex items-start gap-2"
          >
            <div className="flex-1 min-w-0">
              <div
                className="text-mf-small text-mf-text-primary truncate"
                title={session.firstPrompt}
              >
                {session.firstPrompt || 'Untitled session'}
              </div>
              <div className="text-mf-status text-mf-text-secondary mt-0.5 flex items-center gap-1">
                {session.gitBranch && (
                  <>
                    <GitBranch size={10} className="shrink-0" />
                    <span className="truncate max-w-[100px]">{session.gitBranch}</span>
                    <span>{'·'}</span>
                  </>
                )}
                <Clock size={10} className="shrink-0" />
                <span>{formatRelativeTime(session.modifiedAt)}</span>
              </div>
            </div>
            <button
              type="button"
              data-testid="import-session-btn"
              disabled={importing === session.sessionId}
              onClick={() => handleImport(session)}
              className="shrink-0 px-2 py-0.5 rounded text-mf-status bg-mf-hover hover:bg-mf-accent hover:text-white transition-colors disabled:opacity-40"
            >
              {importing === session.sessionId ? 'Importing...' : 'Import'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the file has no TypeScript errors**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit 2>&1 | head -20`
Expected: No errors related to `ImportSessionsPopover.tsx`

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ImportSessionsPopover.tsx
git commit -m "feat(desktop): add ImportSessionsPopover component for external session import"
```

---

### Task 2: Wire the import button into ChatsPanel header

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx`

Add a `Download` icon button between the New Session and View Toggle buttons. It reads `externalSessionCount` from the store, is disabled when count is 0, and toggles the `ImportSessionsPopover`.

- [ ] **Step 1: Add imports to ChatsPanel.tsx**

At the top of the file, add:
```tsx
import { Download } from 'lucide-react';
```
to the existing `lucide-react` import line.

Add the popover import:
```tsx
import { ImportSessionsPopover } from './ImportSessionsPopover';
```

- [ ] **Step 2: Add state and store selector inside `ChatsPanel`**

Inside the `ChatsPanel` function body, add:
```tsx
const externalSessionCount = useChatsStore((s) => s.externalSessionCount);
const [showImportPopover, setShowImportPopover] = useState(false);
```

- [ ] **Step 3: Add the import button to the header**

Insert the import button between the New Session `</div>` (line 302) and the View Toggle `<Tooltip>` (line 303). The button lives in a `relative` wrapper for the popover positioning:

```tsx
          <div className="relative" data-import-popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setShowImportPopover((prev) => !prev)}
                  disabled={externalSessionCount === 0}
                  className="p-1 rounded-mf-input text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  data-testid="import-sessions-btn"
                >
                  <Download size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {externalSessionCount === 0 ? 'No external sessions found' : 'Import external sessions'}
              </TooltipContent>
            </Tooltip>
            {showImportPopover && (
              <ImportSessionsPopover
                projects={projects}
                activeProjectId={activeProjectId}
                filterProjectId={filterProjectId}
                onClose={() => setShowImportPopover(false)}
              />
            )}
          </div>
```

- [ ] **Step 4: Verify no TypeScript errors**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit 2>&1 | head -20`
Expected: Clean compilation

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ChatsPanel.tsx
git commit -m "feat(desktop): wire import sessions button into ChatsPanel header"
```

---

### Task 3: Update E2E tests for the new UI

**Files:**
- Modify: `packages/e2e/tests/35-external-sessions.spec.ts`

The old tests target the removed collapsible section UI. Update them to target the new header button + popover flow.

- [ ] **Step 1: Rewrite the E2E tests**

Replace the full test body of `35-external-sessions.spec.ts` with tests that match the new UI:

```ts
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const DAEMON_BASE = `http://127.0.0.1:${process.env['PORT'] ?? '31415'}`;

function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

function seedExternalSession(
  projectPath: string,
  sessionId: string,
  opts: { firstPrompt?: string; gitBranch?: string } = {},
): string {
  const claudeDir = path.join(homedir(), '.claude', 'projects', encodeProjectPath(projectPath));
  mkdirSync(claudeDir, { recursive: true });

  const filePath = path.join(claudeDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      gitBranch: opts.gitBranch ?? 'main',
      message: {
        content: [{ type: 'text', text: opts.firstPrompt ?? 'Test external session' }],
      },
    }),
  ];
  writeFileSync(filePath, lines.join('\n') + '\n');
  return claudeDir;
}

test.describe('§35 External session import', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let claudeDir: string;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);

    claudeDir = seedExternalSession(project.projectPath, 'ext-session-aaa', {
      firstPrompt: 'Fix the login bug',
      gitBranch: 'feat/login-fix',
    });
    seedExternalSession(project.projectPath, 'ext-session-bbb', {
      firstPrompt: 'Add unit tests for auth module',
      gitBranch: 'feat/auth-tests',
    });

    await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
    await fixture.page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    rmSync(claudeDir, { recursive: true, force: true });
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('import button is enabled when external sessions exist', async () => {
    const btn = fixture.page.locator('[data-testid="import-sessions-btn"]');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toBeEnabled();
  });

  test('opens popover and shows importable sessions', async () => {
    await fixture.page.locator('[data-testid="import-sessions-btn"]').click();
    const items = fixture.page.locator('[data-testid="external-session-item"]');
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    await expect(items.first()).toContainText(/(Fix the login bug|Add unit tests)/);
  });

  test('imports a session and closes popover', async () => {
    // Re-open popover if closed
    const items = fixture.page.locator('[data-testid="external-session-item"]');
    if ((await items.count()) === 0) {
      await fixture.page.locator('[data-testid="import-sessions-btn"]').click();
      await expect(items.first()).toBeVisible({ timeout: 10_000 });
    }

    const chatsBefore = await fixture.page.locator('[data-testid="chat-list-item"]').count();

    await items.first().locator('[data-testid="import-session-btn"]').click();

    // Popover should close after import
    await expect(items).toHaveCount(0, { timeout: 10_000 });

    // Chat list should have one more entry
    await expect(fixture.page.locator('[data-testid="chat-list-item"]')).toHaveCount(chatsBefore + 1, {
      timeout: 10_000,
    });
  });

  test('imported session has a title', async () => {
    const firstChat = fixture.page.locator('[data-testid="chat-list-item"]').first();
    const text = await firstChat.textContent();
    expect(text).not.toContain('New Chat');
  });

  test('import does not switch active chat', async () => {
    const firstChat = fixture.page.locator('[data-testid="chat-list-item"]').first();
    await firstChat.click();
    await expect(firstChat.locator('.font-medium')).toBeVisible({ timeout: 5_000 });
    const activeTextBefore = await firstChat.locator('.font-medium').textContent();

    // Open popover and import the remaining session
    await fixture.page.locator('[data-testid="import-sessions-btn"]').click();
    const remaining = fixture.page.locator('[data-testid="external-session-item"]').first();
    await expect(remaining).toBeVisible({ timeout: 10_000 });
    await remaining.locator('[data-testid="import-session-btn"]').click();

    // Popover closes
    await expect(fixture.page.locator('[data-testid="external-session-item"]')).toHaveCount(0, { timeout: 10_000 });

    // Active chat unchanged
    const activeAfter = fixture.page.locator('[data-testid="chat-list-item"]').locator('.font-medium');
    await expect(activeAfter).toHaveText(activeTextBefore!);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/e2e/tests/35-external-sessions.spec.ts
git commit -m "test(e2e): update external session import tests for new popover UI"
```

---

### Task 4: Add changeset

**Files:**
- Create: `.changeset/<generated>.md`

- [ ] **Step 1: Create changeset**

Run: `pnpm changeset`
- Select `@qlan-ro/mainframe-desktop` — **patch**
- Message: "Restore external session import button in unified sessions panel"

- [ ] **Step 2: Commit**

```bash
git add .changeset/
git commit -m "chore: add changeset for external session import restoration"
```

---

### Task 5: Typecheck and verify

- [ ] **Step 1: Run full typecheck**

Run: `pnpm build`
Expected: Clean build across all packages

- [ ] **Step 2: Fix any issues found and commit**
