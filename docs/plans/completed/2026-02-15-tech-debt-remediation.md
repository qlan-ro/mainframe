# Tech Debt Remediation Plan (Quick Wins + Medium-Term)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all 14 quick-win and medium-term items from the 2026-02-15 tech debt audit.

**Architecture:** Incremental changes — each task is independently committable. Quick wins (tasks 1–7) are safe, isolated fixes. Medium-term tasks (8–14) decompose complex functions and upgrade dependencies, each with test verification.

**Tech Stack:** TypeScript, pnpm workspaces, Zod, pino, Vitest, Electron + Vite

---

### Task 1: Add Path Character Validation to Skill/Agent Zod Schemas

**Files:**
- Modify: `packages/core/src/server/routes/schemas.ts:43,57`
- Test: `packages/core/src/__tests__/schemas.test.ts` (create if needed)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/schemas.test.ts` (or add to existing):

```typescript
import { describe, it, expect } from 'vitest';
import { CreateSkillBody, CreateAgentBody } from '../server/routes/schemas.js';

describe('CreateSkillBody', () => {
  it('rejects names with path separators', () => {
    const result = CreateSkillBody.safeParse({
      projectPath: '/tmp/project',
      name: '../evil',
    });
    expect(result.success).toBe(false);
  });

  it('rejects names with backslashes', () => {
    const result = CreateSkillBody.safeParse({
      projectPath: '/tmp/project',
      name: '..\\evil',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid names', () => {
    const result = CreateSkillBody.safeParse({
      projectPath: '/tmp/project',
      name: 'my-skill_v2',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateAgentBody', () => {
  it('rejects names with path separators', () => {
    const result = CreateAgentBody.safeParse({
      projectPath: '/tmp/project',
      name: 'foo/bar',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid names', () => {
    const result = CreateAgentBody.safeParse({
      projectPath: '/tmp/project',
      name: 'my-agent',
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/schemas.test.ts`
Expected: FAIL — `../evil` and `foo/bar` currently pass validation.

**Step 3: Add regex validation to Zod schemas**

In `packages/core/src/server/routes/schemas.ts`, change the `name` fields:

```typescript
// Line 41-48: CreateSkillBody
export const CreateSkillBody = z.object({
  projectPath: z.string().min(1),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only letters, numbers, hyphens, and underscores'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  scope: scopeEnum.optional(),
});

// Line 55-61: CreateAgentBody
export const CreateAgentBody = z.object({
  projectPath: z.string().min(1),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only letters, numbers, hyphens, and underscores'),
  description: z.string().optional(),
  content: z.string().optional(),
  scope: scopeEnum.optional(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/schemas.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/core/src/server/routes/schemas.ts packages/core/src/__tests__/schemas.test.ts
git commit -m "fix: add path character validation to skill/agent name schemas"
```

---

### Task 2: Remove 5 Unused Dependencies

**Files:**
- Modify: `packages/desktop/package.json`

**Step 1: Remove unused packages**

Run:
```bash
cd /Users/doruchiulan/Projects/qlan/mainframe
pnpm --filter @mainframe/desktop remove @radix-ui/react-context-menu @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select postcss
```

**Step 2: Verify build still works**

Run: `pnpm build`
Expected: All 3 packages build successfully.

**Step 3: Run tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add packages/desktop/package.json pnpm-lock.yaml
git commit -m "chore: remove 5 unused dependencies (4 Radix + postcss)"
```

---

### Task 3: Delete Dead Code

**Files:**
- Delete: `packages/types/src/api.ts`
- Modify: `packages/types/src/index.ts:4` (remove re-export)
- Modify: `packages/core/src/workspace/index.ts:1` (remove `isGitRepo` from export)
- Modify: `packages/core/src/attachment/index.ts:2` (remove `escapeXmlAttr` from export)

**Step 1: Remove `api.ts` re-export from types index**

In `packages/types/src/index.ts`, delete line 4:
```typescript
// DELETE: export * from './api.js';
```

**Step 2: Delete the dead file**

Run: `rm packages/types/src/api.ts`

**Step 3: Remove `isGitRepo` from workspace exports**

In `packages/core/src/workspace/index.ts`, change:
```typescript
// FROM:
export { createWorktree, removeWorktree, isGitRepo, type WorktreeInfo } from './worktree.js';
// TO:
export { createWorktree, removeWorktree, type WorktreeInfo } from './worktree.js';
```

Keep the function in `worktree.ts` itself (may be used internally later), just remove the public export.

**Step 4: Remove `escapeXmlAttr` from attachment exports**

In `packages/core/src/attachment/index.ts`, change:
```typescript
// FROM:
export { buildAttachedFilePathTag, escapeXmlAttr } from './attachment-helpers.js';
// TO:
export { buildAttachedFilePathTag } from './attachment-helpers.js';
```

Keep `escapeXmlAttr` in `attachment-helpers.ts` (used internally by `buildAttachedFilePathTag`), just remove the public re-export.

**Step 5: Verify build**

Run: `pnpm build`
Expected: All packages build. If anything imports `ApiResponse`, `ProjectsApi`, etc. from `@mainframe/types`, it will fail here — but our audit confirmed nothing does.

**Step 6: Run tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add packages/types/src/api.ts packages/types/src/index.ts packages/core/src/workspace/index.ts packages/core/src/attachment/index.ts
git commit -m "chore: remove dead code (api.ts, unused exports)"
```

---

### Task 4: Add `pnpm.overrides` for `tar` Vulnerability

**Files:**
- Modify: `package.json` (root)

**Step 1: Add overrides to root package.json**

In the root `package.json`, add `overrides` inside the existing `"pnpm"` block:

```json
"pnpm": {
  "onlyBuiltDependencies": [
    "better-sqlite3",
    "electron",
    "esbuild"
  ],
  "overrides": {
    "tar": ">=7.5.7"
  }
}
```

**Step 2: Reinstall to apply overrides**

Run: `pnpm install`

**Step 3: Verify the vulnerability is resolved**

Run: `pnpm audit`
Expected: No HIGH vulnerabilities for `tar`.

**Step 4: Verify build**

Run: `pnpm build`
Expected: All packages build.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "fix: add pnpm override for tar >= 7.5.7 (resolves 3 HIGH CVEs)"
```

---

### Task 5: Fix `tsconfig.web.json` Module Setting

**Files:**
- Modify: `packages/desktop/tsconfig.web.json`

**Step 1: Add `module: ESNext`**

The file inherits `module: NodeNext` from `tsconfig.base.json` but sets `moduleResolution: bundler`. These are inconsistent — bundler resolution requires `module: ESNext` or similar.

Change `packages/desktop/tsconfig.web.json` to:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./out",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler"
  },
  "include": ["src/renderer/**/*"]
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: All packages build.

**Step 3: Commit**

```bash
git add packages/desktop/tsconfig.web.json
git commit -m "fix: add module ESNext to tsconfig.web.json for bundler resolution"
```

---

### Task 6: Consolidate `PermissionMode` Type

**Files:**
- Modify: `packages/types/src/events.ts:19` (use imported `PermissionMode` instead of inline union)
- Modify: `packages/types/src/adapter.ts:58` (use `PermissionMode` instead of `string`)
- Modify: `packages/core/src/adapters/base.ts:30` (use `PermissionMode` instead of `string`)

**Step 1: Fix inline union in `events.ts`**

In `packages/types/src/events.ts`, line 19, change the inline union to use the imported type. The file already imports `PermissionMode` on line 3.

```typescript
// FROM (line 19):
  | { type: 'chat.create'; projectId: string; adapterId: string; model?: string; permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo' }
// TO:
  | { type: 'chat.create'; projectId: string; adapterId: string; model?: string; permissionMode?: PermissionMode }
```

**Step 2: Fix `adapter.ts` method signature**

In `packages/types/src/adapter.ts`, add import and update line 58:

```typescript
// Add to imports:
import type { PermissionMode } from './settings.js';

// FROM (line 58):
  setPermissionMode?(process: AdapterProcess, mode: string): Promise<void>;
// TO:
  setPermissionMode?(process: AdapterProcess, mode: PermissionMode): Promise<void>;
```

**Step 3: Fix `base.ts` stub implementation**

In `packages/core/src/adapters/base.ts`, update the import and line 30:

```typescript
// Add PermissionMode to existing @mainframe/types import (line 2):
import type { ..., PermissionMode } from '@mainframe/types';

// FROM (line 30):
  async setPermissionMode(_process: AdapterProcess, _mode: string): Promise<void> {}
// TO:
  async setPermissionMode(_process: AdapterProcess, _mode: PermissionMode): Promise<void> {}
```

**Step 4: Verify build**

Run: `pnpm build`
Expected: All packages build. Any callers passing a raw string will now get a type error if it's not a valid `PermissionMode`.

**Step 5: Run tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/types/src/events.ts packages/types/src/adapter.ts packages/core/src/adapters/base.ts
git commit -m "refactor: consolidate PermissionMode type across all definitions"
```

---

### Task 7: Declare `@mainframe/core` as Desktop Dependency

**Files:**
- Modify: `packages/desktop/package.json` (add dependency)
- Modify: `packages/desktop/electron.vite.config.ts:40` (use published export)

**Step 1: Add workspace dependency**

Run:
```bash
cd /Users/doruchiulan/Projects/qlan/mainframe
pnpm --filter @mainframe/desktop add @mainframe/core@workspace:*
```

**Step 2: Update the Vite alias to use the published export**

In `packages/desktop/electron.vite.config.ts`, check if the alias can be removed entirely. The `@mainframe/core` package exports `"./messages": "./dist/messages/index.js"` in its `package.json`. With the dependency declared, the bundler should resolve `@mainframe/core/messages` automatically.

Try removing the alias:

```typescript
// FROM (lines 38-42):
    resolve: {
      alias: {
        '@mainframe/core/messages': resolve(__dirname, '../core/src/messages/index.ts'),
      },
    },
// TO:
    resolve: {},
```

Or remove the entire `resolve` block if empty.

**Step 3: Verify build**

Run: `pnpm build`

If the build fails because Vite can't resolve `@mainframe/core/messages` from `dist/`, we keep the alias but point it to the compiled output:

```typescript
resolve: {
  alias: {
    '@mainframe/core/messages': resolve(__dirname, '../core/dist/messages/index.js'),
  },
},
```

**Step 4: Run tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/electron.vite.config.ts pnpm-lock.yaml
git commit -m "refactor: declare @mainframe/core as desktop dependency, use published export"
```

---

### Task 8: Decompose `handleEvent()` in `claude-events.ts`

**Files:**
- Modify: `packages/core/src/adapters/claude-events.ts:49-190`
- Modify: `packages/core/src/__tests__/claude-events.test.ts` (verify existing tests still pass)

**Step 1: Read and understand the current structure**

Read `packages/core/src/adapters/claude-events.ts`. The `handleEvent()` function (142 lines) is a switch with 5 cases: `system`, `assistant`, `user`, `control_request`, `result`.

**Step 2: Extract per-type handler functions**

Extract each case into a named function above `handleEvent()`:

```typescript
function handleSystemEvent(event: SystemEvent, state: AdapterState, emit: EmitFn): void {
  // Lines 59-66 content
}

function handleAssistantEvent(event: AssistantEvent, state: AdapterState, emit: EmitFn): void {
  // Lines 68-89 content
}

function handleUserEvent(event: UserEvent, state: AdapterState, emit: EmitFn): void {
  // Lines 91-142 content (largest case)
}

function handleControlRequestEvent(event: ControlRequestEvent, state: AdapterState, emit: EmitFn): void {
  // Lines 144-160 content
}

function handleResultEvent(event: ResultEvent, state: AdapterState, emit: EmitFn): void {
  // Lines 162-188 content
}
```

Then `handleEvent()` becomes a thin dispatcher:

```typescript
export function handleEvent(event: ClaudeEvent, state: AdapterState, emit: EmitFn): void {
  switch (event.type) {
    case 'system':          return handleSystemEvent(event, state, emit);
    case 'assistant':       return handleAssistantEvent(event, state, emit);
    case 'user':            return handleUserEvent(event, state, emit);
    case 'control_request': return handleControlRequestEvent(event, state, emit);
    case 'result':          return handleResultEvent(event, state, emit);
  }
}
```

**Step 3: Run existing tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/claude-events.test.ts`
Expected: All existing tests pass (pure refactor, no behavior change).

**Step 4: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/adapters/claude-events.ts
git commit -m "refactor: decompose handleEvent() into per-type handler functions"
```

---

### Task 9: Split `convertHistoryEntry()` in `claude-history.ts`

**Files:**
- Modify: `packages/core/src/adapters/claude-history.ts:36-137`
- Verify: `packages/core/src/__tests__/message-loading.test.ts` (existing comprehensive tests)

**Step 1: Read and understand the current structure**

Read `packages/core/src/adapters/claude-history.ts`. The function `convertHistoryEntry()` (101 lines) branches on `type === 'user'` vs `type === 'assistant'`.

**Step 2: Extract user/assistant converters**

Create two focused functions:

```typescript
function convertUserEntry(
  entry: HistoryEntry,
  sessionId: string,
): ChatMessage | null {
  // Lines 50-102 content (the `type === 'user'` branch)
}

function convertAssistantEntry(
  entry: HistoryEntry,
  sessionId: string,
): ChatMessage | null {
  // Lines 104-136 content (the `type === 'assistant'` branch)
}
```

Then `convertHistoryEntry()` becomes:

```typescript
export function convertHistoryEntry(
  entry: HistoryEntry,
  sessionId: string,
): ChatMessage | null {
  // Lines 39-48: error result handling (keep here)
  if (entry.type === 'user') return convertUserEntry(entry, sessionId);
  if (entry.type === 'assistant') return convertAssistantEntry(entry, sessionId);
  return null;
}
```

**Step 3: Run existing tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/message-loading.test.ts`
Expected: All 21 test cases pass (pure refactor).

**Step 4: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/adapters/claude-history.ts
git commit -m "refactor: split convertHistoryEntry() into user/assistant converters"
```

---

### Task 10: Data-Driven `ChatsRepository.update()`

**Files:**
- Modify: `packages/core/src/db/chats.ts:93-156`
- Verify: `packages/core/src/__tests__/chats.test.ts` (existing tests)

**Step 1: Read and understand the current structure**

Read `packages/core/src/db/chats.ts`. The `update()` method has 12 sequential `if (x !== undefined)` blocks that build SQL SET clauses.

**Step 2: Replace with a field-mapping approach**

Replace the sequential if-checks with a data-driven loop:

```typescript
update(id: string, fields: Partial<ChatUpdateFields>): void {
  const columnMap: Record<string, { column: string; transform?: (v: unknown) => unknown }> = {
    title: { column: 'title' },
    model: { column: 'model' },
    adapterId: { column: 'adapter_id' },
    status: { column: 'status' },
    permissionMode: { column: 'permission_mode' },
    totalCost: { column: 'total_cost' },
    totalInputTokens: { column: 'total_input_tokens' },
    totalOutputTokens: { column: 'total_output_tokens' },
    claudeSessionId: { column: 'claude_session_id' },
    contextFiles: { column: 'context_files', transform: (v) => JSON.stringify(v) },
    planFiles: { column: 'plan_files', transform: (v) => JSON.stringify(v) },
    skillFiles: { column: 'skill_files', transform: (v) => JSON.stringify(v) },
  };

  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, { column, transform }] of Object.entries(columnMap)) {
    const value = (fields as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(transform ? transform(value) : value);
    }
  }

  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  this.db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
```

**Step 3: Run existing tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/chats.test.ts`
Expected: All tests pass.

**Step 4: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/db/chats.ts
git commit -m "refactor: replace sequential if-checks in ChatsRepository.update() with data-driven loop"
```

---

### Task 11: Extract Route Handlers from Wrapper Functions

**Files:**
- Modify: `packages/core/src/server/routes/files.ts`
- Modify: `packages/core/src/server/routes/git.ts`
- Verify: `packages/core/src/__tests__/routes-files.test.ts` and `packages/core/src/__tests__/routes-git.test.ts`

**Step 1: Extract file route handlers**

In `packages/core/src/server/routes/files.ts`, extract the 4 inline handlers into named functions:

```typescript
// Before fileRoutes():
function handleTree(req: Request, res: Response, db: DatabaseManager): void { /* lines 28-59 */ }
function handleSearchFiles(req: Request, res: Response, db: DatabaseManager): void { /* lines 62-125 */ }
function handleFilesList(req: Request, res: Response, db: DatabaseManager): void { /* lines 128-167 */ }
function handleFileContent(req: Request, res: Response, db: DatabaseManager): void { /* lines 170-201 */ }

// fileRoutes() becomes just route registration:
export function fileRoutes(router: Router, db: DatabaseManager): void {
  router.get('/tree', (req, res) => handleTree(req, res, db));
  router.get('/search/files', (req, res) => handleSearchFiles(req, res, db));
  router.get('/files-list', (req, res) => handleFilesList(req, res, db));
  router.get('/files', (req, res) => handleFileContent(req, res, db));
}
```

**Step 2: Extract git route handlers**

Same pattern for `packages/core/src/server/routes/git.ts`:

```typescript
function handleGitStatus(req: Request, res: Response, db: DatabaseManager): void { /* lines 12-32 */ }
function handleGitBranch(req: Request, res: Response, db: DatabaseManager): void { /* lines 35-51 */ }
function handleDiff(req: Request, res: Response, db: DatabaseManager, adapters: AdapterRegistry): void { /* lines 54-116 */ }

export function gitRoutes(router: Router, db: DatabaseManager, adapters: AdapterRegistry): void {
  router.get('/git/status', (req, res) => handleGitStatus(req, res, db));
  router.get('/git/branch', (req, res) => handleGitBranch(req, res, db));
  router.get('/diff', (req, res) => handleDiff(req, res, db, adapters));
}
```

**Step 3: Run route tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes-files.test.ts src/__tests__/routes-git.test.ts`
Expected: All tests pass (pure refactor).

**Step 4: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/server/routes/files.ts packages/core/src/server/routes/git.ts
git commit -m "refactor: extract inline route handlers into named functions"
```

---

### Task 12: Upgrade `react-resizable-panels` 1→4

**Files:**
- Modify: `packages/desktop/package.json`
- Possibly modify: any files importing from `react-resizable-panels`

**Step 1: Check current usage**

Search for all imports of `react-resizable-panels` in the desktop package:

```bash
grep -r "react-resizable-panels" packages/desktop/src/ --include="*.tsx" --include="*.ts" -l
```

**Step 2: Read the migration notes**

Check the react-resizable-panels changelog for breaking changes between v1 and v4.

Key breaking changes (v1→v2→v3→v4):
- v2: `PanelGroup` `direction` prop renamed to `autoSaveId` behavior changed
- v3: Minimum React 18 (we have 19, fine)
- v4: CSS-based layout (no more inline styles), new `Panel.style` API

**Step 3: Upgrade the package**

Run:
```bash
pnpm --filter @mainframe/desktop add react-resizable-panels@^4
```

**Step 4: Fix breaking changes**

Read each file that imports `react-resizable-panels` and update API usage per the v4 migration guide. Common changes:
- Import names stay the same (`Panel`, `PanelGroup`, `PanelResizeHandle`)
- May need to add CSS import or configure styles
- Check if `onLayout` callback signature changed

**Step 5: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 6: Manual smoke test**

Run: `pnpm dev:desktop`
Verify panel resizing works correctly in the UI.

**Step 7: Commit**

```bash
git add packages/desktop/package.json pnpm-lock.yaml packages/desktop/src/
git commit -m "chore: upgrade react-resizable-panels 1→4"
```

---

### Task 13: Add Logging to Bare `catch {}` in Server Routes

**Files:**
- Modify: `packages/core/src/server/routes/files.ts` (5 catch blocks)
- Modify: `packages/core/src/server/routes/git.ts` (4 catch blocks, skip 2 intentional ones)
- Modify: `packages/core/src/server/routes/skills.ts` (3 catch blocks)
- Modify: `packages/core/src/server/routes/agents.ts` (3 catch blocks)
- Modify: `packages/core/src/server/routes/context.ts` (1 catch block)
- Modify: `packages/core/src/server/routes/chats.ts` (1 catch block)

**Step 1: Identify the logger pattern**

Each route file should already have access to a pino logger. Check the import pattern — route functions receive dependencies via parameters. Add a `logger` parameter where missing, or use the existing one.

**Step 2: Add logging to each bare catch block**

For each file, change bare `catch {}` or `catch (e) {}` to log with context:

```typescript
// Pattern: FROM
} catch {
  return res.json({ success: false, error: 'Failed to ...' });
}

// Pattern: TO
} catch (err) {
  logger.warn({ err, chatId }, 'Failed to ...');
  return res.json({ success: false, error: 'Failed to ...' });
}
```

**Files and specific catch blocks to update:**

`files.ts`: Lines 56, 77, 102, 150, 198 — add `logger.warn` with relevant context (path, query).

`git.ts`: Lines 29, 48, 87, 110 — add `logger.warn`. Skip lines 73 and 105 (intentional "new file" catches with comments).

`skills.ts`: Lines 53, 77, 100 — add `logger.warn` with skill/agent identifiers.

`agents.ts`: Lines 52, 76, 99 — add `logger.warn` with agent identifiers.

`context.ts`: Line 58 — add `logger.warn` with file path.

`chats.ts`: Line 29 — add `logger.warn` with chat ID.

**Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/server/routes/
git commit -m "fix: add logging to bare catch blocks in server routes"
```

---

### Task 14: Upgrade `@vitejs/plugin-react` 4→5

**Files:**
- Modify: `packages/desktop/package.json`

**Step 1: Upgrade the package**

Run:
```bash
pnpm --filter @mainframe/desktop add -D @vitejs/plugin-react@^5
```

**Step 2: Check for breaking changes**

v5 drops support for Vite 4 (we're on Vite 7, fine). The `react()` plugin call API is unchanged.

**Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 4: Run tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/desktop/package.json pnpm-lock.yaml
git commit -m "chore: upgrade @vitejs/plugin-react 4→5"
```

---

## Task Summary

| Task | Category | Risk | Estimated Effort |
|------|----------|------|-----------------|
| 1. Path char validation | Security fix | Low | 15 min |
| 2. Remove unused deps | Cleanup | Low | 10 min |
| 3. Delete dead code | Cleanup | Low | 15 min |
| 4. `tar` override | Security fix | Low | 10 min |
| 5. tsconfig fix | Config fix | Low | 5 min |
| 6. Consolidate PermissionMode | Type safety | Low | 20 min |
| 7. Desktop→Core dependency | Architecture | Medium | 30 min |
| 8. Decompose handleEvent() | Refactor | Medium | 1–2 hrs |
| 9. Split convertHistoryEntry() | Refactor | Medium | 1 hr |
| 10. Data-driven update() | Refactor | Medium | 1 hr |
| 11. Extract route handlers | Refactor | Medium | 1–2 hrs |
| 12. Upgrade react-resizable-panels | Dependency | High | 2 hrs |
| 13. Add route catch logging | Error handling | Low | 1 hr |
| 14. Upgrade plugin-react | Dependency | Low | 15 min |
