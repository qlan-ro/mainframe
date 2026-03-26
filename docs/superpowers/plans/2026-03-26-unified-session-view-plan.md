# Unified Session View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the project selector and show all sessions across all projects in a single grouped sidebar, deriving the active project from the selected session.

**Architecture:** Add `parent_project_id` to the projects table for worktree linking. Add a `GET /api/chats` endpoint to fetch all chats across projects. Refactor the desktop sidebar to render collapsible project groups with all sessions visible, deriving `activeProjectId` from the selected session instead of a user-controlled dropdown.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Express, React, Zustand, pnpm workspaces

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/types/src/chat.ts` | Modify | Add `parentProjectId` to `Project` type |
| `packages/core/src/db/schema.ts` | Modify | Migration for `parent_project_id` column |
| `packages/core/src/db/projects.ts` | Modify | Add `parentProjectId` to all SELECT queries, add `setParentProject` method |
| `packages/core/src/db/chats.ts` | Modify | Add `listAll()` method |
| `packages/core/src/workspace/worktree.ts` | Modify | Add `parseWorktreeList()` and `getWorktrees()` |
| `packages/core/src/server/routes/projects.ts` | Modify | Worktree detection on create, clear parent on delete |
| `packages/core/src/server/routes/chats.ts` | Modify | Add `GET /api/chats` route |
| `packages/core/src/chat/chat-manager.ts` | Modify | Add `listAllChats()` method |
| `packages/desktop/src/renderer/lib/api/projects-api.ts` | Modify | Add `getAllChats()`, update `createProject` return |
| `packages/desktop/src/renderer/store/projects.ts` | Modify | Remove `activeProjectId`, add derived hook |
| `packages/desktop/src/renderer/store/chats.ts` | Modify | Hold all chats across projects |
| `packages/desktop/src/renderer/store/tabs.ts` | Modify | Remove `switchProject` and per-project snapshots |
| `packages/desktop/src/renderer/hooks/useAppInit.ts` | Modify | Fetch all chats on init, derive active project |
| `packages/desktop/src/renderer/lib/ws-event-router.ts` | Modify | Remove `activeProjectId` filtering |
| `packages/desktop/src/renderer/components/TitleBar.tsx` | Modify | Remove project selector dropdown |
| `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx` | Modify | Grouped-by-project session list |
| `packages/desktop/src/renderer/hooks/useActiveProjectId.ts` | Create | Derived `activeProjectId` hook |
| `packages/core/src/__tests__/routes/projects.test.ts` | Modify | Test worktree detection and `parentProjectId` |
| `packages/core/src/__tests__/routes/chats.test.ts` | Modify | Test `GET /api/chats` |
| `packages/core/src/db/__tests__/projects.test.ts` | Create | Test `parentProjectId` queries and `setParentProject` |
| `packages/core/src/db/__tests__/chats.test.ts` | Create | Test `listAll()` |
| `packages/core/src/workspace/__tests__/worktree.test.ts` | Create | Test `parseWorktreeList` |

---

### Task 1: Add `parentProjectId` to the `Project` type

**Files:**
- Modify: `packages/types/src/chat.ts:49-53` (Project interface)

- [ ] **Step 1: Update the Project interface**

In `packages/types/src/chat.ts`, add `parentProjectId` to the `Project` interface:

```ts
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  parentProjectId?: string;
}
```

- [ ] **Step 2: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/chat.ts
git commit -m "feat(types): add parentProjectId to Project interface"
```

---

### Task 2: DB migration — add `parent_project_id` column to projects

**Files:**
- Modify: `packages/core/src/db/schema.ts:56-88`

- [ ] **Step 1: Add the migration**

In `packages/core/src/db/schema.ts`, after the existing migrations block (after line 87), add:

```ts
  const projectCols = db.pragma('table_info(projects)') as { name: string }[];
  if (!projectCols.some((c) => c.name === 'parent_project_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id)');
  }
```

- [ ] **Step 2: Build core package**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/db/schema.ts
git commit -m "feat(core): add parent_project_id migration to projects table"
```

---

### Task 3: Update `ProjectsRepository` — include `parentProjectId` in queries and add `setParentProject`

**Files:**
- Modify: `packages/core/src/db/projects.ts`
- Test: `packages/core/src/db/__tests__/projects.test.ts` (create new)

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/db/__tests__/projects.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectsRepository } from '../projects.js';
import { initializeSchema } from '../schema.js';

describe('ProjectsRepository', () => {
  let db: Database.Database;
  let repo: ProjectsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    repo = new ProjectsRepository(db);
  });

  describe('parentProjectId', () => {
    it('returns parentProjectId as null for regular projects', () => {
      const project = repo.create('/path/to/repo');
      expect(project.parentProjectId).toBeNull();

      const fetched = repo.get(project.id);
      expect(fetched?.parentProjectId).toBeNull();
    });

    it('returns parentProjectId in list()', () => {
      const project = repo.create('/path/to/repo');
      const projects = repo.list();
      expect(projects[0]?.parentProjectId).toBeNull();
    });

    it('returns parentProjectId in getByPath()', () => {
      repo.create('/path/to/repo');
      const project = repo.getByPath('/path/to/repo');
      expect(project?.parentProjectId).toBeNull();
    });
  });

  describe('setParentProject', () => {
    it('sets parent_project_id on a project', () => {
      const parent = repo.create('/main/repo');
      const worktree = repo.create('/main/repo/.worktrees/feat');

      repo.setParentProject(worktree.id, parent.id);

      const fetched = repo.get(worktree.id);
      expect(fetched?.parentProjectId).toBe(parent.id);
    });

    it('clears parent_project_id when called with null', () => {
      const parent = repo.create('/main/repo');
      const worktree = repo.create('/main/repo/.worktrees/feat');

      repo.setParentProject(worktree.id, parent.id);
      repo.clearParentProject(parent.id);

      const fetched = repo.get(worktree.id);
      expect(fetched?.parentProjectId).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/db/__tests__/projects.test.ts`
Expected: FAIL — `parentProjectId` not in query results, `setParentProject` and `clearParentProject` don't exist.

- [ ] **Step 3: Update ProjectsRepository**

In `packages/core/src/db/projects.ts`, update all SELECT queries to include `parent_project_id as parentProjectId`, and add two new methods:

```ts
import type Database from 'better-sqlite3';
import type { Project } from '@qlan-ro/mainframe-types';
import { nanoid } from 'nanoid';
import { basename } from 'node:path';

export class ProjectsRepository {
  constructor(private db: Database.Database) {}

  list(): Project[] {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt,
             parent_project_id as parentProjectId
      FROM projects
      ORDER BY last_opened_at DESC
    `);
    return stmt.all() as Project[];
  }

  get(id: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt,
             parent_project_id as parentProjectId
      FROM projects WHERE id = ?
    `);
    return stmt.get(id) as Project | null;
  }

  getByPath(path: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt,
             parent_project_id as parentProjectId
      FROM projects WHERE path = ?
    `);
    return stmt.get(path) as Project | null;
  }

  create(path: string, name?: string): Project {
    const id = nanoid();
    const now = new Date().toISOString();
    const projectName = name || basename(path);

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, path, created_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, projectName, path, now, now);

    return { id, name: projectName, path, createdAt: now, lastOpenedAt: now, parentProjectId: null };
  }

  updateLastOpened(id: string): void {
    const stmt = this.db.prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`);
    stmt.run(new Date().toISOString(), id);
  }

  setParentProject(projectId: string, parentId: string): void {
    const stmt = this.db.prepare(`UPDATE projects SET parent_project_id = ? WHERE id = ?`);
    stmt.run(parentId, projectId);
  }

  clearParentProject(parentId: string): void {
    const stmt = this.db.prepare(`UPDATE projects SET parent_project_id = NULL WHERE parent_project_id = ?`);
    stmt.run(parentId);
  }

  remove(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
    stmt.run(id);
  }

  removeWithChats(id: string): void {
    const deleteChats = this.db.prepare(`DELETE FROM chats WHERE project_id = ?`);
    const deleteProject = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
    const tx = this.db.transaction(() => {
      deleteChats.run(id);
      deleteProject.run(id);
    });
    tx();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/db/__tests__/projects.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/projects.ts packages/core/src/db/__tests__/projects.test.ts
git commit -m "feat(core): add parentProjectId to ProjectsRepository queries"
```

---

### Task 4: Add `listAll()` to `ChatsRepository`

**Files:**
- Modify: `packages/core/src/db/chats.ts:17-42` (add method after `list`)
- Test: `packages/core/src/db/__tests__/chats.test.ts` (create new)

- [ ] **Step 1: Write failing test**

Create `packages/core/src/db/__tests__/chats.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatsRepository } from '../chats.js';
import { ProjectsRepository } from '../projects.js';
import { initializeSchema } from '../schema.js';

describe('ChatsRepository', () => {
  let db: Database.Database;
  let chats: ChatsRepository;
  let projects: ProjectsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    chats = new ChatsRepository(db);
    projects = new ProjectsRepository(db);
  });

  describe('listAll', () => {
    it('returns chats across all projects sorted by updatedAt DESC', () => {
      const p1 = projects.create('/project/one');
      const p2 = projects.create('/project/two');

      const chat1 = chats.create(p1.id, 'claude');
      const chat2 = chats.create(p2.id, 'claude');
      const chat3 = chats.create(p1.id, 'claude');

      const all = chats.listAll();
      expect(all).toHaveLength(3);
      // Most recent first
      expect(all[0]!.id).toBe(chat3.id);
      expect(all[1]!.id).toBe(chat2.id);
      expect(all[2]!.id).toBe(chat1.id);
    });

    it('excludes archived chats', () => {
      const p1 = projects.create('/project/one');
      const chat1 = chats.create(p1.id, 'claude');
      chats.update(chat1.id, { status: 'archived' });

      const chat2 = chats.create(p1.id, 'claude');

      const all = chats.listAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(chat2.id);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/db/__tests__/chats.test.ts`
Expected: FAIL — `listAll` method doesn't exist.

- [ ] **Step 3: Add `listAll` method to ChatsRepository**

In `packages/core/src/db/chats.ts`, add after the existing `list(projectId)` method:

```ts
  listAll(): Chat[] {
    const stmt = this.db.prepare(`
      SELECT id, adapter_id as adapterId, project_id as projectId,
             title, claude_session_id as claudeSessionId,
             model, permission_mode as permissionMode,
             status, created_at as createdAt, updated_at as updatedAt,
             total_cost as totalCost,
             total_tokens_input as totalTokensInput,
             total_tokens_output as totalTokensOutput,
             last_context_tokens_input as lastContextTokensInput,
             worktree_path as worktreePath, branch_name as branchName,
             process_state as processState,
             mentions, modified_files as modifiedFiles
      FROM chats
      WHERE status != 'archived'
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all() as Chat[];
    return rows.map((row) => ({
      ...row,
      mentions: parseJsonColumn<SessionMention[]>(row.mentions, []),
      modifiedFiles: parseJsonColumn<string[]>(row.modifiedFiles, []),
    }));
  }
```

Note: `parseJsonColumn` is a local helper — check if it exists in the file. If the existing `list()` method parses JSON inline, extract the same pattern. The column list must exactly match the existing `list(projectId)` method but without the `WHERE project_id = ?` filter.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/db/__tests__/chats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/chats.ts packages/core/src/db/__tests__/chats.test.ts
git commit -m "feat(core): add listAll() to ChatsRepository for cross-project chat listing"
```

---

### Task 5: Add worktree detection utilities

**Files:**
- Modify: `packages/core/src/workspace/worktree.ts`
- Test: `packages/core/src/workspace/__tests__/worktree.test.ts` (create new)

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/workspace/__tests__/worktree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWorktreeList } from '../worktree.js';

describe('parseWorktreeList', () => {
  it('parses porcelain output into worktree entries', () => {
    const output = [
      'worktree /Users/dev/my-project',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /Users/dev/my-project/.worktrees/feat-x',
      'HEAD def5678',
      'branch refs/heads/feat-x',
      '',
    ].join('\n');

    const entries = parseWorktreeList(output);
    expect(entries).toEqual([
      { path: '/Users/dev/my-project', branch: 'refs/heads/main' },
      { path: '/Users/dev/my-project/.worktrees/feat-x', branch: 'refs/heads/feat-x' },
    ]);
  });

  it('handles detached HEAD entries', () => {
    const output = [
      'worktree /Users/dev/repo',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /Users/dev/repo/.worktrees/detached',
      'HEAD def5678',
      'detached',
      '',
    ].join('\n');

    const entries = parseWorktreeList(output);
    expect(entries).toEqual([
      { path: '/Users/dev/repo', branch: 'refs/heads/main' },
      { path: '/Users/dev/repo/.worktrees/detached', branch: null },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/workspace/__tests__/worktree.test.ts`
Expected: FAIL — `parseWorktreeList` doesn't exist.

- [ ] **Step 3: Add `parseWorktreeList` and `getWorktrees`**

In `packages/core/src/workspace/worktree.ts`, add:

```ts
export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const lines = output.split('\n');
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
      currentBranch = null;
    } else if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length);
    } else if (line === 'detached') {
      currentBranch = null;
    } else if (line === '' && currentPath !== null) {
      entries.push({ path: currentPath, branch: currentBranch });
      currentPath = null;
      currentBranch = null;
    }
  }

  return entries;
}

export async function getWorktrees(projectPath: string): Promise<WorktreeEntry[]> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: projectPath,
    });
    return parseWorktreeList(stdout);
  } catch {
    return [];
  }
}
```

Note: `execFileAsync` should use `node:child_process` `execFile` wrapped with `node:util` `promisify`, or use the existing async exec pattern in the codebase. Check `worktree.ts` for how `execFileSync` is currently imported and convert to async.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/workspace/__tests__/worktree.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workspace/worktree.ts packages/core/src/workspace/__tests__/worktree.test.ts
git commit -m "feat(core): add worktree list parsing and async getWorktrees"
```

---

### Task 6: Worktree detection on project creation + clear on delete

**Files:**
- Modify: `packages/core/src/server/routes/projects.ts`
- Modify: `packages/core/src/__tests__/routes/projects.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/core/src/__tests__/routes/projects.test.ts`:

```ts
describe('POST /api/projects — worktree detection', () => {
  it('returns parentProjectId as null for regular projects', async () => {
    mockCtx.db.projects.getByPath.mockReturnValue(null);
    mockCtx.db.projects.create.mockReturnValue({
      id: '1', name: 'repo', path: '/repo', createdAt: '', lastOpenedAt: '', parentProjectId: null,
    });
    mockCtx.db.projects.list.mockReturnValue([]);

    const res = await request(app).post('/api/projects').send({ path: '/repo' });
    expect(res.body.parentProjectId).toBeNull();
  });
});

describe('DELETE /api/projects/:id — clears parent references', () => {
  it('clears parentProjectId on child projects when parent is deleted', async () => {
    mockCtx.chats.removeProject.mockResolvedValue(undefined);

    const res = await request(app).delete('/api/projects/parent-id');
    expect(res.status).toBe(204);
    expect(mockCtx.db.projects.clearParentProject).toHaveBeenCalledWith('parent-id');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/routes/projects.test.ts`
Expected: FAIL

- [ ] **Step 3: Update project routes**

In `packages/core/src/server/routes/projects.ts`:

1. Import `getWorktrees` from `../../workspace/worktree.js`.
2. In `POST /api/projects`, after `ctx.db.projects.create(...)`:
   - Call `getWorktrees` on the new project's path. For each existing project in `ctx.db.projects.list()`, check if the new project's path appears in that project's worktree list → set `parent_project_id` on the new project.
   - Call `getWorktrees` on the new project's path. For each worktree entry, check if a registered project exists at that path → set `parent_project_id` on that existing project.
   - Re-fetch and return the project with `parentProjectId` populated.
3. In `DELETE /api/projects/:id`, before calling `ctx.chats.removeProject(id)`:
   - Call `ctx.db.projects.clearParentProject(id)` to unlink any worktree children.

```ts
// POST handler — after create:
const allProjects = ctx.db.projects.list();

// Check if new project is a worktree of an existing project
for (const existing of allProjects) {
  if (existing.id === project.id) continue;
  const worktrees = await getWorktrees(existing.path);
  if (worktrees.some((wt) => wt.path === path)) {
    ctx.db.projects.setParentProject(project.id, existing.id);
    break;
  }
}

// Check if existing projects are worktrees of the new project
const newWorktrees = await getWorktrees(path);
for (const wt of newWorktrees) {
  const existingProject = ctx.db.projects.getByPath(wt.path);
  if (existingProject && !existingProject.parentProjectId) {
    ctx.db.projects.setParentProject(existingProject.id, project.id);
  }
}

const result = ctx.db.projects.get(project.id);
res.status(201).json(result);
```

```ts
// DELETE handler — before removeProject:
ctx.db.projects.clearParentProject(id);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/routes/projects.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/routes/projects.ts packages/core/src/__tests__/routes/projects.test.ts
git commit -m "feat(core): detect worktree relationships on project create/delete"
```

---

### Task 7: Add `GET /api/chats` route and `listAllChats` to ChatManager

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts:307-310`
- Modify: `packages/core/src/server/routes/chats.ts`
- Modify: `packages/core/src/__tests__/routes/chats.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/__tests__/routes/chats.test.ts`:

```ts
describe('GET /api/chats', () => {
  it('returns all non-archived chats across projects', async () => {
    const mockChats = [
      { id: 'c1', projectId: 'p1', title: 'Chat 1', status: 'active' },
      { id: 'c2', projectId: 'p2', title: 'Chat 2', status: 'active' },
    ];
    mockCtx.chats.listAllChats.mockReturnValue(mockChats);

    const res = await request(app).get('/api/chats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockChats);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/routes/chats.test.ts`
Expected: FAIL — `listAllChats` doesn't exist, no route for `GET /api/chats`.

- [ ] **Step 3: Add `listAllChats` to ChatManager**

In `packages/core/src/chat/chat-manager.ts`, add after `listChats`:

```ts
  listAllChats(): Chat[] {
    const chats = this.db.chats.listAll();
    return chats.map((chat) => this.enrichChat(chat));
  }
```

- [ ] **Step 4: Add `GET /api/chats` route**

In `packages/core/src/server/routes/chats.ts`, add the new route before the existing `GET /api/projects/:projectId/chats`:

```ts
  router.get('/api/chats', (req, res) => {
    const chats = ctx.chats.listAllChats();
    res.json(chats);
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/routes/chats.test.ts`
Expected: PASS

- [ ] **Step 6: Build core**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/chat/chat-manager.ts packages/core/src/server/routes/chats.ts packages/core/src/__tests__/routes/chats.test.ts
git commit -m "feat(core): add GET /api/chats endpoint for cross-project chat listing"
```

---

### Task 8: Add `getAllChats` to the desktop API client

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/projects-api.ts`

- [ ] **Step 1: Add `getAllChats` function**

In `packages/desktop/src/renderer/lib/api/projects-api.ts`, add:

```ts
export async function getAllChats(): Promise<Chat[]> {
  return fetchJson('/api/chats');
}
```

Add the `Chat` import from `@qlan-ro/mainframe-types` if not already present.

- [ ] **Step 2: Export from index**

Verify `packages/desktop/src/renderer/lib/api/index.ts` re-exports from `projects-api` (it already does).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/projects-api.ts
git commit -m "feat(desktop): add getAllChats API client function"
```

---

### Task 9: Refactor `useProjectsStore` — remove `activeProjectId`

**Files:**
- Modify: `packages/desktop/src/renderer/store/projects.ts`

- [ ] **Step 1: Remove `activeProjectId` from the store**

Replace the store with:

```ts
import { create } from 'zustand';
import type { Project } from '@qlan-ro/mainframe-types';

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  loading: false,
  error: null,
  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
```

Remove all `localStorage` reads/writes for `mf:activeProjectId`. Remove `setActiveProject`.

- [ ] **Step 2: Create `useActiveProjectId` hook**

Create a new file `packages/desktop/src/renderer/hooks/useActiveProjectId.ts`:

```ts
import { useChatsStore } from '../store/chats.js';

export function useActiveProjectId(): string | null {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chats = useChatsStore((s) => s.chats);

  if (!activeChatId) return null;
  const chat = chats.find((c) => c.id === activeChatId);
  return chat?.projectId ?? null;
}
```

- [ ] **Step 3: Find and fix all usages of old `activeProjectId`**

Search the codebase for all imports of `activeProjectId` from `useProjectsStore` and `setActiveProject`. Replace each with `useActiveProjectId()`. Key files to update:
- `ChatsPanel.tsx` — replace `useProjectsStore` `activeProjectId` usage
- `TitleBar.tsx` — replace project selector logic (handled in Task 12)
- `useAppInit.ts` — replace init logic (handled in Task 11)
- `ws-event-router.ts` — replace filtering (handled in Task 10)
- Any other files found via grep

Run: `grep -r "activeProjectId\|setActiveProject" packages/desktop/src/ --include="*.ts" --include="*.tsx" -l`

Update each file. Do NOT update files that are fully rewritten in later tasks (Tasks 10, 11, 12, 13) — only fix files not covered by other tasks.

- [ ] **Step 4: Build desktop to check for type errors**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: May have errors in files handled by later tasks. Note them but don't fix — they'll be resolved in Tasks 10-13.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/projects.ts packages/desktop/src/renderer/hooks/useActiveProjectId.ts
git commit -m "refactor(desktop): derive activeProjectId from selected session"
```

---

### Task 10: Remove `activeProjectId` filtering from WebSocket event router

**Files:**
- Modify: `packages/desktop/src/renderer/lib/ws-event-router.ts`

- [ ] **Step 1: Update `routeEvent` to accept all events**

In `ws-event-router.ts`:

1. Remove all imports of `useProjectsStore`.
2. In `chat.created` handler: remove the `activeProjectId` check. Always call `chats.addChat(event.chat)` and `tabs.openChatTab(...)` (unless `source === 'import'`).
3. In `sessions.external.count` handler: remove the `activeProjectId` check. Always update the count. Note: if `externalSessionCount` is project-scoped, it may need to become a `Map<projectId, number>` — check how it's used and update accordingly.
4. In `chat.updated` handler: remove any `activeProjectId` check. Always call `chats.updateChat`.

- [ ] **Step 2: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build (or errors only in files handled by Tasks 11-13).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/ws-event-router.ts
git commit -m "refactor(desktop): remove project filtering from WebSocket event router"
```

---

### Task 11: Refactor `useAppInit` and `useProject` hooks

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useAppInit.ts`

- [ ] **Step 1: Update `useAppInit` to fetch all projects and all chats**

In the `useAppInit` hook:
1. Remove `activeProjectId` restoration from `localStorage`.
2. After fetching projects, call `getAllChats()` (from `projects-api.ts`) to populate the chats store with all chats.
3. Restore `activeChatId` from `localStorage` (persist just the chat id, not the project id). If the chat exists in the fetched list, set it active and subscribe.

- [ ] **Step 2: Refactor `useProject` to react to derived `activeProjectId`**

The `useProject` hook should:
1. Accept the derived `activeProjectId` (from `useActiveProjectId()`).
2. On `activeProjectId` change (when user clicks a session from a different project):
   - Load project-specific context: skills, agents, commands, launch statuses.
   - Do NOT call `switchProject` on tabs store (removed).
   - Do NOT re-fetch chats (they're all already loaded).
3. Remove the `switchProject` call entirely.
4. Keep the daemon reconnect handler — on reconnect, re-fetch all chats via `getAllChats()` and re-fetch project context for the current `activeProjectId`.

- [ ] **Step 3: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build (or errors only in files handled by Tasks 12-13).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useAppInit.ts
git commit -m "refactor(desktop): fetch all chats on init, derive project context from session"
```

---

### Task 12: Remove project selector from TitleBar

**Files:**
- Modify: `packages/desktop/src/renderer/components/TitleBar.tsx`

- [ ] **Step 1: Remove project dropdown**

In `TitleBar.tsx`:
1. Remove the project selector dropdown button and its state (`isOpen`, `confirmDeleteId`, etc.).
2. Remove the `DirectoryPickerModal` trigger from the title bar (it moves to ChatsPanel).
3. Remove `setActiveProject` usage.
4. Show the active project name in the title bar, derived from the selected session. Use `useActiveProjectId()` to get the project id, then look up the project name from `useProjectsStore`.
5. When no session is selected, show "Mainframe".
6. Keep the project delete logic available — it moves to the ChatsPanel context menu (Task 13).

Remove all unused imports after cleanup.

- [ ] **Step 2: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build (or errors only in Task 13).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/TitleBar.tsx
git commit -m "refactor(desktop): remove project selector dropdown from title bar"
```

---

### Task 13: Unified ChatsPanel with collapsible project groups

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx`

- [ ] **Step 1: Implement collapsible project groups**

Rewrite `ChatsPanel.tsx` to:

1. Read `projects` from `useProjectsStore` and `chats` from `useChatsStore`.
2. Group chats by `projectId`. Sort groups by the most recent `updatedAt` of their chats.
3. Render each group as a collapsible section:
   - Header: project name, chat count, collapse/expand chevron.
   - For worktree projects (`parentProjectId` is set): show a small badge/subtitle like `↳ branch of <parent-name>`.
   - Right side of header: a `+` button to create a new session in that project, and a `...` menu with "Remove project" option.
4. Sessions within each group: same rendering as current (title, status dot, archive action, etc.).
5. Persist collapse state to `localStorage` key `mf:collapsedProjects` as a JSON array of project IDs.

2. Add an "Add Project" button at the bottom of the panel. On click, open `DirectoryPickerModal` (move the modal trigger from `TitleBar`).

- [ ] **Step 2: Wire up project creation**

The "Add Project" button calls `createProject(path)` from the API, then `addProject(project)` on the projects store. No `setActiveProject` needed — a new project starts with no sessions, so the active project doesn't change.

- [ ] **Step 3: Wire up project deletion**

The "Remove project" menu item on each project group header:
1. Confirms with a dialog.
2. Calls `removeProject(id)` API.
3. Closes all tabs for that project's chats.
4. Removes chats from the store.
5. Removes the project from the projects store.
6. If the deleted project was the active project (derived from selected session), clear `activeChatId`.

- [ ] **Step 4: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ChatsPanel.tsx
git commit -m "feat(desktop): unified session panel with collapsible project groups"
```

---

### Task 14: Remove per-project tab snapshots from tabs store

**Files:**
- Modify: `packages/desktop/src/renderer/store/tabs.ts`

- [ ] **Step 1: Remove `switchProject` and snapshot persistence**

In `packages/desktop/src/renderer/store/tabs.ts`:

1. Remove the `ProjectTabSnapshot` type.
2. Remove `projectTabs` from state (the `Map<string, ProjectTabSnapshot>`).
3. Remove `switchProject(prevProjectId, nextProjectId)` method.
4. Remove `saveProjectTabs()` and `loadProjectTabs()` helpers.
5. Remove the auto-save subscriber that writes per-project snapshots on state change.
6. Clean up the `localStorage` key `mf:projectTabs` — add a one-time cleanup in `useAppInit` that removes this key if present.
7. Keep all tab management methods (`openChatTab`, `closeTab`, `setActiveTab`, etc.) — they work the same, just without project scoping.

- [ ] **Step 2: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/tabs.ts
git commit -m "refactor(desktop): remove per-project tab snapshots, unify tab management"
```

---

### Task 15: localStorage cleanup migration

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useAppInit.ts`

- [ ] **Step 1: Add one-time localStorage cleanup**

In `useAppInit`, at the start of the init effect, add:

```ts
// One-time cleanup of removed localStorage keys
if (localStorage.getItem('mf:activeProjectId') !== null) {
  localStorage.removeItem('mf:activeProjectId');
  localStorage.removeItem('mf:projectTabs');
}
```

- [ ] **Step 2: Persist `activeChatId` instead of `activeProjectId`**

In `useChatsStore` or `useAppInit`, persist the `activeChatId` to `localStorage` key `mf:activeChatId` on change, and restore it on init.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useAppInit.ts packages/desktop/src/renderer/store/chats.ts
git commit -m "chore(desktop): clean up removed localStorage keys, persist activeChatId"
```

---

### Task 16: Startup worktree backfill

**Files:**
- Modify: `packages/core/src/server/routes/projects.ts` (or a separate startup hook)

- [ ] **Step 1: Add backfill on server startup**

Create a function `backfillWorktreeRelationships` that:
1. Reads all projects from the DB.
2. For each project without a `parentProjectId`, runs `getWorktrees(project.path)`.
3. For each worktree entry, checks if a project exists at that path.
4. If found and that project has no `parentProjectId`, sets it.

Call this function once during daemon startup (in the server initialization code, after schema migration). It should be idempotent and log any relationships it discovers.

```ts
export async function backfillWorktreeRelationships(db: { projects: ProjectsRepository }): Promise<void> {
  const projects = db.projects.list();
  const pathToId = new Map(projects.map((p) => [p.path, p.id]));

  for (const project of projects) {
    if (project.parentProjectId) continue;
    const worktrees = await getWorktrees(project.path);
    for (const wt of worktrees) {
      if (wt.path === project.path) continue;
      const childId = pathToId.get(wt.path);
      if (childId) {
        const child = projects.find((p) => p.id === childId);
        if (child && !child.parentProjectId) {
          db.projects.setParentProject(childId, project.id);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Wire into daemon startup**

Find where the daemon server starts (after `initializeSchema`), and call `backfillWorktreeRelationships(ctx.db)`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/workspace/worktree.ts packages/core/src/server/index.ts
git commit -m "feat(core): backfill worktree relationships on daemon startup"
```

---

### Task 17: Full build and typecheck

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: Clean build across all packages.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Fix any issues**

Address any type errors, test failures, or build issues discovered.

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve build and test issues from unified session view refactor"
```

---

### Task 18: Changesets

- [ ] **Step 1: Create changesets**

Run: `pnpm changeset`

Pick affected packages:
- `@qlan-ro/mainframe-types` — minor (new field on `Project`)
- `@qlan-ro/mainframe-core` — minor (new endpoint, worktree detection)
- `@qlan-ro/mainframe-desktop` — minor (unified session view)

Summary: "Remove project selector in favor of unified session view. Sessions are grouped by project in the sidebar. Active project is derived from the selected session. Worktree projects are auto-detected and linked to their parent."

- [ ] **Step 2: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changesets for unified session view"
```
