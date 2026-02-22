# Move ClaudeAdapter Into Builtin Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all Claude-specific adapter files out of `adapters/` and into `plugins/builtin/claude/`, leaving `adapters/` as generic infrastructure only.

**Architecture:** Six Claude-specific files move into the builtin plugin folder with shorter names (`adapter.ts`, `session.ts`, etc.). `AdapterRegistry` constructor becomes empty — the plugin system is now the sole source of adapter registration. All import paths in tests and source files update to the new locations. No barrel re-exports.

**Tech Stack:** TypeScript (NodeNext), pnpm workspaces, vitest

---

## Task 1: Move Claude files into the plugin folder

**Files:**
- Move: `packages/core/src/adapters/claude.ts` → `packages/core/src/plugins/builtin/claude/adapter.ts`
- Move: `packages/core/src/adapters/claude-session.ts` → `packages/core/src/plugins/builtin/claude/session.ts`
- Move: `packages/core/src/adapters/claude-events.ts` → `packages/core/src/plugins/builtin/claude/events.ts`
- Move: `packages/core/src/adapters/claude-history.ts` → `packages/core/src/plugins/builtin/claude/history.ts`
- Move: `packages/core/src/adapters/claude-skills.ts` → `packages/core/src/plugins/builtin/claude/skills.ts`
- Move: `packages/core/src/adapters/frontmatter.ts` → `packages/core/src/plugins/builtin/claude/frontmatter.ts`

**Step 1: Move the files**

```bash
cd packages/core/src
mv adapters/claude.ts plugins/builtin/claude/adapter.ts
mv adapters/claude-session.ts plugins/builtin/claude/session.ts
mv adapters/claude-events.ts plugins/builtin/claude/events.ts
mv adapters/claude-history.ts plugins/builtin/claude/history.ts
mv adapters/claude-skills.ts plugins/builtin/claude/skills.ts
mv adapters/frontmatter.ts plugins/builtin/claude/frontmatter.ts
```

**Step 2: Fix internal imports within the moved files**

Each moved file imports from sibling files that have also moved. Update relative imports:

In `adapter.ts` — change any `from './claude-session.js'` → `from './session.js'`, `from './claude-events.js'` → `from './events.js'`, etc.

In `session.ts` — same pattern: `./claude-events.js` → `./events.js`, `./claude-history.js` → `./history.js`, `./claude-skills.js` → `./skills.js`, `./frontmatter.js` → `./frontmatter.js`.

In `events.ts`, `history.ts`, `skills.ts` — fix any cross-references between the moved files.

Also fix the upward path to `BaseAdapter`/`BaseSession` — they moved FROM a sibling to a grandparent:
- Old: `from './base.js'` or `from './base-session.js'`
- New: `from '../../base.js'` and `from '../../base-session.js'`

**Step 3: Verify moved files compile**

```bash
pnpm --filter @mainframe/core build
```
Expected: TypeScript errors about missing imports in other files — that's expected, those are fixed in subsequent tasks. The moved files themselves should have no internal errors.

---

## Task 2: Update `adapters/index.ts` — remove Claude, clean to generic only

**Files:**
- Modify: `packages/core/src/adapters/index.ts`

**Step 1: Rewrite the file**

Replace the entire file with:

```typescript
import type { Adapter, AdapterInfo } from '@mainframe/types';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  all(): Adapter[] {
    return [...this.adapters.values()];
  }

  killAll(): void {
    for (const adapter of this.adapters.values()) {
      adapter.killAll();
    }
  }

  async list(): Promise<AdapterInfo[]> {
    const infos: AdapterInfo[] = [];
    for (const adapter of this.adapters.values()) {
      const installed = await adapter.isInstalled();
      const version = installed ? await adapter.getVersion() : undefined;
      const models = await adapter.listModels();
      infos.push({
        id: adapter.id,
        name: adapter.name,
        description: `${adapter.name} adapter`,
        installed,
        version: version || undefined,
        models,
      });
    }
    return infos;
  }
}

export { BaseAdapter } from './base.js';
export { BaseSession } from './base-session.js';
```

**Step 2: Build to confirm**

```bash
pnpm --filter @mainframe/core build
```
Expected: Errors in files that imported `ClaudeAdapter` from `adapters/index.js` — fixed in subsequent tasks.

---

## Task 3: Update `plugins/builtin/claude/index.ts`

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/index.ts`

**Step 1: Update the import**

Change:
```typescript
import { ClaudeAdapter } from '../../../adapters/claude.js';
```
To:
```typescript
import { ClaudeAdapter } from './adapter.js';
```

**Step 2: Build**

```bash
pnpm --filter @mainframe/core build
```
Expected: Remaining errors in test files and `core/src/index.ts` — not yet fixed.

---

## Task 4: Update `packages/core/src/index.ts`

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1: Check current imports**

Read `packages/core/src/index.ts` and find any import of `ClaudeAdapter` or claude-related symbols from `adapters/`. Update them to import from `plugins/builtin/claude/adapter.js` if needed.

The daemon entry point imports `claudeManifest` and `activate` from the plugin. If it also imports `ClaudeAdapter` directly, update that import path.

**Step 2: Build**

```bash
pnpm --filter @mainframe/core build
```
Expected: Only test-related errors remain.

---

## Task 5: Update test files — part 1 (adapter-registry + adapter-events)

**Files:**
- Modify: `packages/core/src/__tests__/adapter-registry.test.ts`
- Modify: `packages/core/src/__tests__/event-pipeline-parity.test.ts`

**Step 1: `adapter-registry.test.ts`**

Change:
```typescript
import { AdapterRegistry, ClaudeAdapter } from '../adapters/index.js';
```
To:
```typescript
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../plugins/builtin/claude/adapter.js';
```

Also: the `new AdapterRegistry()` constructor no longer auto-registers Claude. If any test relies on the registry being pre-populated, add an explicit `registry.register(new ClaudeAdapter())` before that assertion.

**Step 2: `event-pipeline-parity.test.ts`**

Change:
```typescript
import { buildToolResultBlocks, convertHistoryEntry } from '../adapters/claude-history.js';
```
To:
```typescript
import { buildToolResultBlocks, convertHistoryEntry } from '../plugins/builtin/claude/history.js';
```

**Step 3: Run these two test files**

```bash
pnpm --filter @mainframe/core exec vitest run -- "adapter-registry|event-pipeline-parity"
```
Expected: PASS.

---

## Task 6: Update test files — part 2 (claude-events + claude-skills)

**Files:**
- Modify: `packages/core/src/__tests__/claude-events.test.ts`
- Modify: `packages/core/src/__tests__/claude-skills.test.ts`

**Step 1: `claude-events.test.ts`**

Change:
```typescript
import { handleStdout, handleStderr } from '../adapters/claude-events.js';
import { ClaudeSession } from '../adapters/claude-session.js';
```
To:
```typescript
import { handleStdout, handleStderr } from '../plugins/builtin/claude/events.js';
import { ClaudeSession } from '../plugins/builtin/claude/session.js';
```

**Step 2: `claude-skills.test.ts`**

Change:
```typescript
import { ... } from '../adapters/claude-skills.js';
import { parseFrontmatter } from '../adapters/frontmatter.js';
```
To:
```typescript
import { ... } from '../plugins/builtin/claude/skills.js';
import { parseFrontmatter } from '../plugins/builtin/claude/frontmatter.js';
```

**Step 3: Run**

```bash
pnpm --filter @mainframe/core exec vitest run -- "claude-events|claude-skills"
```
Expected: PASS.

---

## Task 7: Update test files — part 3 (frontmatter + message-loading + control-requests)

**Files:**
- Modify: `packages/core/src/__tests__/frontmatter.test.ts`
- Modify: `packages/core/src/__tests__/message-loading.test.ts`
- Modify: `packages/core/src/__tests__/control-requests.test.ts`

**Step 1: `frontmatter.test.ts`**

Change:
```typescript
import { parseFrontmatter, buildFrontmatter } from '../adapters/frontmatter.js';
```
To:
```typescript
import { parseFrontmatter, buildFrontmatter } from '../plugins/builtin/claude/frontmatter.js';
```

**Step 2: `message-loading.test.ts`**

Change:
```typescript
import { buildToolResultBlocks } from '../adapters/claude-history.js';
import { ClaudeAdapter } from '../adapters/claude.js';
```
To:
```typescript
import { buildToolResultBlocks } from '../plugins/builtin/claude/history.js';
import { ClaudeAdapter } from '../plugins/builtin/claude/adapter.js';
```

**Step 3: `control-requests.test.ts`**

Change:
```typescript
import { ClaudeAdapter } from '../adapters/claude.js';
```
To:
```typescript
import { ClaudeAdapter } from '../plugins/builtin/claude/adapter.js';
```

(`BaseSession` stays from `../adapters/base-session.js` — that's correct.)

**Step 4: Run**

```bash
pnpm --filter @mainframe/core exec vitest run -- "frontmatter|message-loading|control-requests"
```
Expected: PASS.

---

## Task 8: Full build + full test run + commit

**Step 1: Full build**

```bash
pnpm build
```
Expected: PASS — no errors, no warnings.

**Step 2: Full test run**

```bash
pnpm --filter @mainframe/core test
```
Expected: Same pass rate as before (477/480 — only pre-existing title-generation failures).

**Step 3: Commit**

```bash
git add packages/core/src/adapters/ packages/core/src/plugins/builtin/claude/ packages/core/src/__tests__/
git commit -m "refactor: move Claude adapter files into builtin plugin, empty AdapterRegistry constructor"
```
