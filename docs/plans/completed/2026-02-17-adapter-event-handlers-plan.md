# Adapter-Specific Event Handlers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract Claude-specific event handling into a dedicated handler class, make tool categorization adapter-declared, and remove `instanceof ClaudeAdapter` from core — so a second adapter (Codex) can be added without touching shared message logic.

**Architecture:** Each adapter gets its own event handler class. The current `EventHandler` becomes an orchestrator that dispatches to the right handler per adapter. Tool categorization moves from hardcoded sets to adapter-declared categories passed as parameters to grouping functions. `ChatMessage.metadata.adapterId` enables downstream adapter-aware behavior.

**Tech Stack:** TypeScript (strict, NodeNext), Vitest, pnpm workspaces.

---

### Task 1: Add `ToolCategories` type and `getToolCategories()` to BaseAdapter

**Files:**
- Modify: `packages/core/src/messages/tool-categorization.ts`
- Modify: `packages/core/src/adapters/base.ts`
- Test: `packages/core/src/__tests__/messages/tool-categorization.test.ts`

**Step 1: Write failing test for parameterized categorization**

Add to `packages/core/src/__tests__/messages/tool-categorization.test.ts`:

```ts
import { type ToolCategories, isExploreTool, isHiddenTool, isTaskProgressTool, isSubagentTool } from '../../messages/tool-categorization.js';

describe('parameterized categorization', () => {
  const categories: ToolCategories = {
    explore: new Set(['Read', 'Glob', 'Grep']),
    hidden: new Set(['TaskList', 'Skill']),
    progress: new Set(['TaskCreate']),
    subagent: new Set(['Task']),
  };

  it('isExploreTool checks against provided categories', () => {
    expect(isExploreTool('Read', categories)).toBe(true);
    expect(isExploreTool('Bash', categories)).toBe(false);
  });

  it('isHiddenTool checks against provided categories', () => {
    expect(isHiddenTool('TaskList', categories)).toBe(true);
    expect(isHiddenTool('Read', categories)).toBe(false);
  });

  it('isTaskProgressTool checks against provided categories', () => {
    expect(isTaskProgressTool('TaskCreate', categories)).toBe(true);
    expect(isTaskProgressTool('Bash', categories)).toBe(false);
  });

  it('isSubagentTool checks against provided categories', () => {
    expect(isSubagentTool('Task', categories)).toBe(true);
    expect(isSubagentTool('Bash', categories)).toBe(false);
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @mainframe/core test -- tool-categorization`
Expected: FAIL — `ToolCategories` and parameterized signatures don't exist yet.

**Step 3: Implement ToolCategories type and parameterized functions**

Rewrite `packages/core/src/messages/tool-categorization.ts`:

```ts
export interface ToolCategories {
  explore: Set<string>;
  hidden: Set<string>;
  progress: Set<string>;
  subagent: Set<string>;
}

export function isExploreTool(name: string, categories: ToolCategories): boolean {
  return categories.explore.has(name);
}
export function isHiddenTool(name: string, categories: ToolCategories): boolean {
  return categories.hidden.has(name);
}
export function isTaskProgressTool(name: string, categories: ToolCategories): boolean {
  return categories.progress.has(name);
}
export function isSubagentTool(name: string, categories: ToolCategories): boolean {
  return categories.subagent.has(name);
}
```

**Step 4: Add `getToolCategories()` to BaseAdapter**

In `packages/core/src/adapters/base.ts`, add:

```ts
import type { ToolCategories } from '../messages/tool-categorization.js';

// In BaseAdapter class:
getToolCategories(): ToolCategories {
  return { explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set() };
}
```

**Step 5: Update existing tests to use new signatures**

The existing tests in `tool-categorization.test.ts` reference the old 1-arg signatures and exported sets (`EXPLORE_TOOLS`, `HIDDEN_TOOLS`, `TASK_PROGRESS_TOOLS`). Update them to use the parameterized versions with Claude's categories. Remove tests for the exported sets (they no longer exist).

**Step 6: Update `messages/index.ts` exports**

Replace old exports with:

```ts
export {
  type ToolCategories,
  isExploreTool,
  isHiddenTool,
  isTaskProgressTool,
  isSubagentTool,
} from './tool-categorization.js';
```

**Step 7: Run tests**

Run: `pnpm --filter @mainframe/core test -- tool-categorization`
Expected: PASS.

**Step 8: Commit**

```bash
git add packages/core/src/messages/tool-categorization.ts packages/core/src/messages/index.ts packages/core/src/adapters/base.ts packages/core/src/__tests__/messages/tool-categorization.test.ts
git commit -m "refactor: parameterize tool categorization with ToolCategories type"
```

---

### Task 2: Add Claude tool categories to ClaudeAdapter

**Files:**
- Modify: `packages/core/src/adapters/claude.ts`
- Test: `packages/core/src/__tests__/adapter-registry.test.ts` (or a new focused test)

**Step 1: Write failing test**

```ts
import { ClaudeAdapter } from '../adapters/claude.js';

describe('ClaudeAdapter.getToolCategories', () => {
  it('returns Claude-specific tool categories', () => {
    const adapter = new ClaudeAdapter();
    const cats = adapter.getToolCategories();
    expect(cats.explore).toEqual(new Set(['Read', 'Glob', 'Grep']));
    expect(cats.hidden).toContain('TaskList');
    expect(cats.hidden).toContain('Skill');
    expect(cats.progress).toEqual(new Set(['TaskCreate', 'TaskUpdate']));
    expect(cats.subagent).toEqual(new Set(['Task']));
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @mainframe/core test -- adapter-registry`
Expected: FAIL — `getToolCategories` returns empty sets from BaseAdapter default.

**Step 3: Override in ClaudeAdapter**

In `packages/core/src/adapters/claude.ts`, add:

```ts
import type { ToolCategories } from '../messages/tool-categorization.js';

// In ClaudeAdapter class:
override getToolCategories(): ToolCategories {
  return {
    explore: new Set(['Read', 'Glob', 'Grep']),
    hidden: new Set([
      'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop',
      'TodoWrite', 'Skill', 'EnterPlanMode', 'AskUserQuestion',
    ]),
    progress: new Set(['TaskCreate', 'TaskUpdate']),
    subagent: new Set(['Task']),
  };
}
```

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test -- adapter-registry`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/adapters/claude.ts packages/core/src/__tests__/adapter-registry.test.ts
git commit -m "feat(claude): declare tool categories on ClaudeAdapter"
```

---

### Task 3: Update tool-grouping to accept ToolCategories parameter

**Files:**
- Modify: `packages/core/src/messages/tool-grouping.ts`
- Modify: `packages/core/src/__tests__/messages/tool-grouping.test.ts`

**Step 1: Update function signatures**

In `packages/core/src/messages/tool-grouping.ts`:
- `groupToolCallParts(parts: PartEntry[], categories: ToolCategories): PartEntry[]`
- `groupTaskChildren(parts: PartEntry[], categories: ToolCategories): PartEntry[]`

Replace internal calls:
- `isExploreTool(name)` → `isExploreTool(name, categories)`
- `isHiddenTool(name)` → `isHiddenTool(name, categories)`
- `isTaskProgressTool(name)` → `isTaskProgressTool(name, categories)`
- `part.toolName === 'Task'` → `isSubagentTool(part.toolName, categories)`

Update the import to include `isSubagentTool` and `type ToolCategories`.

**Step 2: Update all existing tests**

In `packages/core/src/__tests__/messages/tool-grouping.test.ts`, define a shared Claude categories fixture at the top:

```ts
import type { ToolCategories } from '../../messages/tool-categorization.js';

const CLAUDE_CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set(['TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'TodoWrite', 'Skill', 'EnterPlanMode', 'AskUserQuestion']),
  progress: new Set(['TaskCreate', 'TaskUpdate']),
  subagent: new Set(['Task']),
};
```

Update every `groupToolCallParts(parts)` call to `groupToolCallParts(parts, CLAUDE_CATEGORIES)` and every `groupTaskChildren(parts)` call to `groupTaskChildren(parts, CLAUDE_CATEGORIES)`.

**Step 3: Add test for empty categories (Codex-like adapter)**

```ts
describe('with empty categories (no grouping)', () => {
  const empty: ToolCategories = {
    explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set(),
  };

  it('passes all tool calls through ungrouped', () => {
    const parts = [tc('Read', 'r1'), tc('Grep', 'g1'), tc('TodoWrite', 'h1')];
    const result = groupToolCallParts(parts, empty);
    expect(result).toHaveLength(3);
  });

  it('does not create _TaskGroup entries', () => {
    const parts = [tc('Task', 't1'), tc('Bash', 'b1')];
    const result = groupTaskChildren(parts, empty);
    expect(result).toHaveLength(2);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Task');
  });
});
```

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test -- tool-grouping`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/messages/tool-grouping.ts packages/core/src/__tests__/messages/tool-grouping.test.ts
git commit -m "refactor: pass ToolCategories to grouping functions"
```

---

### Task 4: Update convert-message.ts to resolve categories from adapterId

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.test.ts`

**Step 1: Update `convertMessage` to accept `ToolCategories`**

Change signature: `convertMessage(message: GroupedMessage, categories: ToolCategories): ThreadMessageLike`

Update the two call sites inside the function:
- `groupToolCallParts(parts as PartEntry[])` → `groupToolCallParts(parts as PartEntry[], categories)`
- `groupTaskChildren(afterGrouping)` → `groupTaskChildren(afterGrouping, categories)`

Add the import: `import type { ToolCategories } from '@mainframe/core/messages';`

**Step 2: Update existing tests**

In `convert-message.test.ts`, import `ToolCategories` and define a Claude fixture. Pass it to every `convertMessage()` call.

**Step 3: Find all callers of `convertMessage` in the desktop package**

Search for `convertMessage(` in the desktop package. Update each call site to pass `categories`. The caller should resolve categories from the chat's `adapterId` and a registry lookup. The simplest approach: create a `getToolCategoriesForAdapter(adapterId: string)` helper that returns Claude's categories for `'claude'` and empty defaults otherwise. This helper lives in `convert-message.ts` or a small utility next to it.

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/desktop test -- convert-message`
Expected: PASS.

**Step 5: Run typecheck**

Run: `pnpm --filter @mainframe/desktop build`
Expected: PASS — no type errors from callers passing the new param.

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.test.ts
git commit -m "refactor(desktop): pass ToolCategories through convert-message"
```

---

### Task 5: Extract ClaudeEventHandler from EventHandler

**Files:**
- Create: `packages/core/src/chat/claude-event-handler.ts`
- Modify: `packages/core/src/chat/event-handler.ts`
- Modify: `packages/core/src/__tests__/event-handler.test.ts`

**Step 1: Define the AdapterEventHandler interface**

In `packages/core/src/chat/event-handler.ts`, add:

```ts
import type { BaseAdapter } from '../adapters/base.js';

export interface AdapterEventHandler {
  setup(adapter: BaseAdapter): void;
}
```

**Step 2: Create claude-event-handler.ts**

Move the entire body of the current `EventHandler.setup()` method (lines 31–165 — all the `claude.on(...)` listeners) into a new `ClaudeEventHandler` class:

```ts
import type { ClaudeAdapter } from '../adapters/claude.js';
import type { MessageMetadata } from '../adapters/base.js';
import type { DatabaseManager } from '../db/index.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ChatLookup, AdapterEventHandler } from './event-handler.js';
import type { BaseAdapter } from '../adapters/base.js';
import type { DaemonEvent } from '@mainframe/types';
import { trackFileActivity } from './context-tracker.js';

export class ClaudeEventHandler implements AdapterEventHandler {
  constructor(
    private lookup: ChatLookup,
    private db: DatabaseManager,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private emitEvent: (event: DaemonEvent) => void,
  ) {}

  setup(adapter: BaseAdapter): void {
    const claude = adapter as ClaudeAdapter;

    // Paste all claude.on(...) listeners from the current EventHandler.setup() here.
    // No logic changes — pure extraction.
  }
}
```

**Step 3: Rewrite EventHandler.setup() as orchestrator**

```ts
import { ClaudeEventHandler } from './claude-event-handler.js';

export class EventHandler {
  private handlers = new Map<string, AdapterEventHandler>();

  constructor(
    private lookup: ChatLookup,
    private db: DatabaseManager,
    private adapters: AdapterRegistry,
    private messages: MessageCache,
    private permissions: PermissionManager,
    private emitEvent: (event: DaemonEvent) => void,
  ) {
    this.handlers.set('claude', new ClaudeEventHandler(lookup, db, messages, permissions, emitEvent));
  }

  setup(): void {
    for (const adapter of this.adapters.all()) {
      const handler = this.handlers.get(adapter.id);
      if (handler) handler.setup(adapter as BaseAdapter);
    }
  }
}
```

**Step 4: Add `all()` method to AdapterRegistry**

In `packages/core/src/adapters/index.ts`, add:

```ts
all(): Adapter[] {
  return [...this.adapters.values()];
}
```

**Step 5: Run existing event-handler tests — they must still pass unchanged**

Run: `pnpm --filter @mainframe/core test -- event-handler`
Expected: PASS — behavior is identical, only the code location changed.

**Step 6: Remove the `ClaudeAdapter` import from `event-handler.ts`**

The only import of `ClaudeAdapter` in event-handler.ts was for the cast. Now event-handler.ts should only import `AdapterRegistry`, `BaseAdapter`, and the handler classes.

**Step 7: Run typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: PASS.

**Step 8: Commit**

```bash
git add packages/core/src/chat/claude-event-handler.ts packages/core/src/chat/event-handler.ts packages/core/src/adapters/index.ts packages/core/src/__tests__/event-handler.test.ts
git commit -m "refactor: extract ClaudeEventHandler, make EventHandler an orchestrator"
```

---

### Task 6: Add `extractPlanFiles`/`extractSkillFiles` to Adapter interface and fix lifecycle-manager

**Files:**
- Modify: `packages/types/src/adapter.ts`
- Modify: `packages/core/src/adapters/claude.ts`
- Modify: `packages/core/src/adapters/base.ts`
- Modify: `packages/core/src/chat/lifecycle-manager.ts`

**Step 1: Add optional methods to Adapter interface**

In `packages/types/src/adapter.ts`, add to the `Adapter` interface:

```ts
extractPlanFiles?(sessionId: string, projectPath: string): Promise<string[]>;
extractSkillFiles?(sessionId: string, projectPath: string): Promise<import('./skill.js').SkillFileEntry[]>;
```

**Step 2: Implement in ClaudeAdapter (rename existing methods)**

In `packages/core/src/adapters/claude.ts`, rename `extractPlanFilePaths` → `extractPlanFiles` and `extractSkillFilePaths` → `extractSkillFiles`. Keep the implementations identical.

**Step 3: Update lifecycle-manager.ts**

Replace `packages/core/src/chat/lifecycle-manager.ts:240-251`:

```ts
// Before:
if (adapter instanceof ClaudeAdapter) {
  const [planPaths, skillPaths] = await Promise.all([
    adapter.extractPlanFilePaths(chat.claudeSessionId, effectivePath),
    adapter.extractSkillFilePaths(chat.claudeSessionId, effectivePath),
  ]);
  // ...
}

// After:
if (chat.claudeSessionId) {
  const [planPaths, skillPaths] = await Promise.all([
    adapter.extractPlanFiles?.(chat.claudeSessionId, effectivePath) ?? Promise.resolve([]),
    adapter.extractSkillFiles?.(chat.claudeSessionId, effectivePath) ?? Promise.resolve([]),
  ]);
  for (const p of planPaths) this.deps.db.chats.addPlanFile(chatId, p);
  for (const p of skillPaths) this.deps.db.chats.addSkillFile(chatId, p);
}
```

Remove the `import { ClaudeAdapter } from '../adapters/index.js';` line from lifecycle-manager.ts.

**Step 4: Search for any remaining `extractPlanFilePaths`/`extractSkillFilePaths` references**

Run: `grep -r "extractPlanFilePaths\|extractSkillFilePaths" packages/`
Expected: No matches (all renamed).

**Step 5: Run typecheck**

Run: `pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/types/src/adapter.ts packages/core/src/adapters/claude.ts packages/core/src/adapters/base.ts packages/core/src/chat/lifecycle-manager.ts
git commit -m "refactor: move plan/skill extraction to Adapter interface, remove instanceof check"
```

---

### Task 7: Stamp adapterId on ChatMessage metadata

**Files:**
- Modify: `packages/core/src/chat/claude-event-handler.ts`
- Modify: `packages/core/src/__tests__/event-handler.test.ts`

**Step 1: Write failing test**

Add to `event-handler.test.ts`:

```ts
it('stamps adapterId on emitted messages', () => {
  const processId = 'proc-1';
  const chatId = 'chat-1';
  lookup.activeChats.set(chatId, {
    chat: { id: chatId, adapterId: 'claude', totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
    process: { id: processId },
  });
  const processToChat = new Map([['proc-1', 'chat-1']]);
  (lookup as any).getChatIdForProcess = (pid: string) => processToChat.get(pid);

  claude.emit('message', processId, [{ type: 'text', text: 'hello' }]);

  const emitted = emitEvent.mock.calls.find(([e]: [any]) => e.type === 'message.added');
  expect(emitted).toBeDefined();
  expect(emitted![0].message.metadata?.adapterId).toBe('claude');
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @mainframe/core test -- event-handler`
Expected: FAIL — metadata doesn't include `adapterId` yet.

**Step 3: Add adapterId to metadata in ClaudeEventHandler**

In `claude-event-handler.ts`, wherever `createTransientMessage` is called, ensure metadata includes `adapterId: 'claude'`. The cleanest way: the constructor receives the `adapterId` string and merges it into metadata on every `createTransientMessage` call.

```ts
constructor(
  private adapterId: string,
  // ...existing deps
) {}

// In each listener:
const msgMeta = { ...metadata, adapterId: this.adapterId };
const message = this.messages.createTransientMessage(chatId, 'assistant', content, msgMeta);
```

Update the EventHandler constructor to pass `'claude'` when creating ClaudeEventHandler.

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test -- event-handler`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/chat/claude-event-handler.ts packages/core/src/chat/event-handler.ts packages/core/src/__tests__/event-handler.test.ts
git commit -m "feat: stamp adapterId on ChatMessage metadata"
```

---

### Task 8: Full build and cross-package typecheck

**Files:** None (verification only).

**Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS — no type errors across types, core, desktop.

**Step 2: Run all tests**

Run: `pnpm test`
Expected: PASS — no regressions.

**Step 3: Verify no remaining Claude imports in core message pipeline**

Run: `grep -rn "ClaudeAdapter\|instanceof Claude" packages/core/src/chat/ packages/core/src/messages/`
Expected: Only `claude-event-handler.ts` references `ClaudeAdapter`. No references in `event-handler.ts`, `lifecycle-manager.ts`, or `messages/`.

**Step 4: Commit if any fixups were needed**

```bash
git add -A && git commit -m "chore: fixups from full build verification"
```
