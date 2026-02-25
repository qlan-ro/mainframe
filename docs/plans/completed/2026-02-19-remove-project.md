# Remove Project Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users remove a project from Mainframe via a hover-reveal ✕ button on the ProjectRail, with an inline confirm/cancel flip and correct daemon-side process cleanup.

**Architecture:** The backend already has the DELETE route and DB cascade logic; the gap is that it bypasses ChatManager, leaving orphaned processes alive. Fix: route calls `ctx.chats.removeProject()`, a new ChatManager method that kills active processes before deleting from DB. Frontend: add two local state vars to ProjectRail (`hoveringId`, `confirmingDeleteId`) and swap button content accordingly.

**Tech Stack:** TypeScript, Node.js, Vitest (core tests), React (desktop), Tailwind CSS, Lucide icons

---

### Task 1: Add `removeProject` to ChatManager (daemon)

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts`
- Test: `packages/core/src/__tests__/chat-manager-remove-project.test.ts` (new)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/chat-manager-remove-project.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { ChatManager } from '../chat/chat-manager.js';

function makeDb(chats: { id: string }[] = []) {
  return {
    chats: {
      list: vi.fn().mockReturnValue(chats),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      addMention: vi.fn(),
      getModifiedFilesList: vi.fn(),
    },
    projects: {
      list: vi.fn(),
      get: vi.fn(),
      getByPath: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
      removeWithChats: vi.fn(),
      updateLastOpened: vi.fn(),
    },
    settings: { get: vi.fn(), getByCategory: vi.fn(), set: vi.fn(), delete: vi.fn() },
  } as unknown as DatabaseManager;
}

function makeAdapters(): AdapterRegistry {
  return { get: vi.fn(), list: vi.fn() } as unknown as AdapterRegistry;
}

describe('ChatManager.removeProject', () => {
  it('calls removeWithChats when no chats are active', async () => {
    const db = makeDb([]);
    const manager = new ChatManager(db, makeAdapters());

    await manager.removeProject('proj-1');

    expect(db.projects.removeWithChats).toHaveBeenCalledWith('proj-1');
  });

  it('kills active process before deleting', async () => {
    const db = makeDb([{ id: 'chat-1' }]);
    const kill = vi.fn().mockResolvedValue(undefined);
    const adapters = makeAdapters();
    (adapters.get as any).mockReturnValue({ kill });

    const manager = new ChatManager(db, adapters);

    // Inject a fake active chat with a running process
    const fakeProcess = { id: 'proc-1' } as any;
    (manager as any).activeChats.set('chat-1', {
      chat: { id: 'chat-1', adapterId: 'claude', projectId: 'proj-1' },
      process: fakeProcess,
    });
    (manager as any).processToChat.set('proc-1', 'chat-1');

    await manager.removeProject('proj-1');

    expect(kill).toHaveBeenCalledWith(fakeProcess);
    expect((manager as any).processToChat.has('proc-1')).toBe(false);
    expect((manager as any).activeChats.has('chat-1')).toBe(false);
    expect(db.projects.removeWithChats).toHaveBeenCalledWith('proj-1');
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
pnpm --filter @mainframe/core test -- chat-manager-remove-project
```

Expected: FAIL — `removeProject is not a function`

**Step 3: Implement `removeProject` in ChatManager**

Open `packages/core/src/chat/chat-manager.ts`. Add this method after `endChat`:

```typescript
async removeProject(projectId: string): Promise<void> {
  const chats = this.db.chats.list(projectId);
  for (const chat of chats) {
    const active = this.activeChats.get(chat.id);
    if (active?.process) {
      const adapter = this.adapters.get(active.chat.adapterId);
      if (adapter) {
        try {
          await adapter.kill(active.process);
        } catch (err) {
          logger.warn({ err, chatId: chat.id }, 'failed to kill process on project removal');
        }
      }
      this.processToChat.delete(active.process.id);
    }
    this.activeChats.delete(chat.id);
    this.messages.delete(chat.id);
    this.permissions.clear(chat.id);
  }
  this.db.projects.removeWithChats(projectId);
}
```

Note: `logger` is already available — check the imports in `chat-manager.ts`. If there's no top-level logger, add:
```typescript
import { createChildLogger } from '../logger.js';
const logger = createChildLogger('chat-manager');
```

**Step 4: Run the test to verify it passes**

```bash
pnpm --filter @mainframe/core test -- chat-manager-remove-project
```

Expected: PASS

**Step 5: Typecheck**

```bash
pnpm --filter @mainframe/core build
```

Expected: no errors

**Step 6: Commit**

```bash
git add packages/core/src/chat/chat-manager.ts packages/core/src/__tests__/chat-manager-remove-project.test.ts
git commit -m "feat(core): add ChatManager.removeProject with process cleanup"
```

---

### Task 2: Update DELETE route to use ChatManager

**Files:**
- Modify: `packages/core/src/server/routes/projects.ts`
- Modify: `packages/core/src/__tests__/routes/projects.test.ts`

**Step 1: Update the route test**

In `packages/core/src/__tests__/routes/projects.test.ts`, find the `DELETE /api/projects/:id` describe block (line 134) and replace it:

```typescript
describe('DELETE /api/projects/:id', () => {
  it('calls chatManager.removeProject', async () => {
    (ctx.chats as any).removeProject = vi.fn().mockResolvedValue(undefined);

    const router = projectRoutes(ctx);
    const handler = extractHandler(router, 'delete', '/api/projects/:id');
    const res = mockRes();

    await handler({ params: { id: 'p1' }, query: {} }, res, vi.fn());

    expect((ctx.chats as any).removeProject).toHaveBeenCalledWith('p1');
    expect(ctx.db.projects.removeWithChats).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
pnpm --filter @mainframe/core test -- routes/projects
```

Expected: FAIL — `ctx.chats.removeProject` not called

**Step 3: Update the route**

In `packages/core/src/server/routes/projects.ts`, replace the DELETE handler body:

```typescript
// Before:
router.delete('/api/projects/:id', (req: Request, res: Response) => {
  ctx.db.projects.removeWithChats(param(req, 'id'));
  res.json({ success: true });
});

// After:
router.delete('/api/projects/:id', (req: Request, res: Response) => {
  ctx.chats.removeProject(param(req, 'id'))
    .then(() => res.json({ success: true }))
    .catch((err: unknown) => {
      logger.error({ err }, 'failed to remove project');
      res.status(500).json({ success: false, error: 'Failed to remove project' });
    });
});
```

Add a logger import at the top of the file if not present:
```typescript
import { createChildLogger } from '../../logger.js';
const logger = createChildLogger('projects-route');
```

**Step 4: Run tests**

```bash
pnpm --filter @mainframe/core test -- routes/projects
```

Expected: PASS

**Step 5: Typecheck**

```bash
pnpm --filter @mainframe/core build
```

**Step 6: Commit**

```bash
git add packages/core/src/server/routes/projects.ts packages/core/src/__tests__/routes/projects.test.ts
git commit -m "feat(core): route DELETE /api/projects/:id through ChatManager"
```

---

### Task 3: Add hover-reveal ✕ and inline confirm/cancel to ProjectRail

**Files:**
- Modify: `packages/desktop/src/renderer/components/ProjectRail.tsx`

No backend or store changes needed — `removeProject` API function and `store.removeProject()` already exist.

**Step 1: Update ProjectRail**

Replace the full contents of `packages/desktop/src/renderer/components/ProjectRail.tsx`:

```tsx
import React, { useCallback, useState } from 'react';
import { Plus, Settings, HelpCircle, X, Check } from 'lucide-react';
import { useProjectsStore, useSettingsStore } from '../store';
import { createProject, removeProject } from '../lib/api';
import { cn } from '../lib/utils';

export function ProjectRail(): React.ReactElement {
  const { projects, activeProjectId, setActiveProject, addProject, removeProject: removeFromStore } =
    useProjectsStore();
  const [hoveringId, setHoveringId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const handleAddProject = useCallback(async () => {
    try {
      const path = await window.mainframe.openDirectoryDialog();
      if (!path) return;

      const project = await createProject(path);
      addProject(project);
      setActiveProject(project.id);
    } catch (error) {
      console.warn('[project-rail] failed to add project:', error);
    }
  }, [addProject, setActiveProject]);

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await removeProject(id);
        removeFromStore(id);
      } catch (error) {
        console.warn('[project-rail] failed to remove project:', error);
      } finally {
        setConfirmingDeleteId(null);
        setHoveringId(null);
      }
    },
    [removeFromStore],
  );

  const handleMouseLeave = useCallback((id: string) => {
    setHoveringId(null);
    // Cancel confirm if mouse leaves while confirming this project
    setConfirmingDeleteId((prev) => (prev === id ? null : prev));
  }, []);

  return (
    <div className="w-12 bg-mf-app-bg flex flex-col py-3 px-[2px] pl-[6px]">
      {/* Project icons */}
      <div className="flex-1 flex flex-col items-center gap-3 overflow-y-auto">
        {projects.map((project) => {
          const isHovering = hoveringId === project.id;
          const isConfirming = confirmingDeleteId === project.id;

          return (
            <div
              key={project.id}
              className="relative w-8 h-8 shrink-0"
              onMouseEnter={() => setHoveringId(project.id)}
              onMouseLeave={() => handleMouseLeave(project.id)}
            >
              {isConfirming ? (
                /* Inline confirm state: ✓ / ✗ */
                <div className="w-8 h-8 flex items-center justify-center gap-0.5 rounded-mf-card bg-mf-panel-bg">
                  <button
                    onClick={() => handleConfirmDelete(project.id)}
                    className="w-3.5 h-3.5 flex items-center justify-center rounded text-green-400 hover:text-green-300 transition-colors"
                    title="Confirm remove"
                    aria-label="Confirm remove project"
                  >
                    <Check size={11} />
                  </button>
                  <button
                    onClick={() => setConfirmingDeleteId(null)}
                    className="w-3.5 h-3.5 flex items-center justify-center rounded text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                    title="Cancel"
                    aria-label="Cancel remove project"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                /* Normal project button */
                <>
                  <button
                    onClick={() => setActiveProject(project.id)}
                    className={cn(
                      'w-8 h-8 flex items-center justify-center',
                      'rounded-mf-card text-mf-small font-semibold transition-colors',
                      activeProjectId === project.id
                        ? 'bg-mf-accent text-white ring-2 ring-mf-accent/50'
                        : 'bg-mf-panel-bg text-mf-text-secondary hover:text-mf-text-primary',
                    )}
                    title={project.name}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </button>
                  {/* Hover-reveal ✕ */}
                  {isHovering && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDeleteId(project.id);
                      }}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-mf-app-bg text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                      title="Remove project"
                      aria-label="Remove project"
                    >
                      <X size={9} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}

        <button
          onClick={handleAddProject}
          className="w-8 h-8 flex items-center justify-center shrink-0 rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg transition-colors"
          title="Add Project"
          aria-label="Add project"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-3 pt-3">
        <button
          onClick={() => useSettingsStore.getState().open()}
          className="w-8 h-8 flex items-center justify-center rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={() => useSettingsStore.getState().open(undefined, 'about')}
          className="w-8 h-8 flex items-center justify-center rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          title="Help"
          aria-label="Show app information"
        >
          <HelpCircle size={16} />
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: no TypeScript errors

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/ProjectRail.tsx
git commit -m "feat(desktop): add hover-reveal remove button to ProjectRail"
```

---

### Task 4: Manual smoke test

Start the app and verify:

1. Add at least two projects
2. Hover a project button → small ✕ appears in top-right corner
3. Click ✕ → button area flips to ✓ / ✗
4. Move mouse away → confirm state cancels, button returns to normal
5. Hover again, click ✕, then click ✓ → project disappears from rail; active project switches if needed
6. Add a third project, open a chat in it, start a message (so a CLI process runs), then remove that project → verify the process is gone (no zombie in Activity Monitor / `ps aux | grep claude`)
7. Click ✗ on the confirm state → nothing is deleted, returns to normal

---

### Task 5: Final typecheck and test run

```bash
pnpm --filter @mainframe/core build
pnpm --filter @mainframe/core test
```

Expected: all tests pass, no type errors.

**Commit if any fixes were needed, then open PR.**
