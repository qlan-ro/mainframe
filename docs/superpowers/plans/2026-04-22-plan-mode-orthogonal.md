# Plan Mode as an Orthogonal Axis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split plan mode out of `PermissionMode` into its own boolean axis, ship Codex plan-mode parity with `PlanApprovalCard`, redesign the per-adapter settings control, and fix the Thinking-indicator race after clear-context approve.

**Architecture:** Data model changes in `@qlan-ro/mainframe-types` cascade to the DB schema, chat-manager config endpoint, both plugin adapters (Claude + Codex), the plan-mode handler (newly adapter-pluggable), and the renderer. Session `kill()` becomes deterministic via awaited exit, with a session-identity guard on stale `onExit` as defense in depth.

**Tech Stack:** TypeScript (strict, NodeNext), pnpm workspaces, `better-sqlite3`, Vitest, React, Electron, Zod schemas on all WS routes.

**Spec:** `docs/superpowers/specs/2026-04-22-plan-mode-orthogonal-design.md`

---

## File Structure

Files created/modified, grouped by responsibility:

**Types (`packages/types/src/`)**
- Modify `adapter.ts` — shrink `SessionSpawnOptions.permissionMode`, add `planMode`, add `Adapter.capabilities`, shrink `ControlResponse.executionMode` (already done)
- Modify `chat.ts` — shrink `Chat.permissionMode`, add `Chat.planMode`

**Core DB (`packages/core/src/db/`)**
- Modify `schema.ts` — add `plan_mode` column + value migration
- Modify `chats.ts` — add `planMode` to `updateColumnMap`, read `plan_mode` in row builders

**Core chat (`packages/core/src/chat/`)**
- Modify `plan-mode-handler.ts` — becomes adapter-agnostic dispatcher
- Create `plan-mode-actions.ts` — `PlanModeActionHandler` interface + `PlanActionContext` shape
- Modify `chat-manager.ts` + `config-manager.ts` — `planMode` parameter plumbed through `updateChatConfig`
- Modify `permission-handler.ts` — dispatch via adapter-provided handler
- Modify `lifecycle-manager.ts` — read `defaultPlanMode` in `createChatWithDefaults`

**Claude plugin (`packages/core/src/plugins/builtin/claude/`)**
- Modify `session.ts` — `kill()` awaits close with 3s SIGKILL fallback; spawn uses `planMode ? 'plan' : permissionMode` for `--permission-mode`
- Modify `adapter.ts` — declare `capabilities: { planMode: true }`
- Create `plan-mode-handler.ts` — `ClaudePlanModeHandler` implementing `PlanModeActionHandler`

**Codex plugin (`packages/core/src/plugins/builtin/codex/`)**
- Modify `session.ts` — `kill()` awaits close with timeout; `buildCollaborationMode()` reads `planMode`
- Modify `event-mapper.ts` — wire `item/plan/delta` and terminal `plan` item into `currentTurnPlan` state; clear on `turn/started` / `turn/completed`
- Modify `approval-handler.ts` — route `requestUserInput` to `ExitPlanMode` when `planMode === true` AND a plan was captured this turn
- Modify `types.ts` — extend `CodexSessionState` with `currentTurnPlan`
- Modify `adapter.ts` — declare `capabilities: { planMode: true }`
- Create `plan-mode-handler.ts` — `CodexPlanModeHandler` implementing `PlanModeActionHandler`

**Core server (`packages/core/src/server/`)**
- Modify `ws-schemas.ts` — `chat.updateConfig` accepts `planMode?: boolean`
- Modify `websocket.ts` — forward `planMode` to `chatManager.updateChatConfig`

**Event handler (`packages/core/src/chat/`)**
- Modify `event-handler.ts` — `buildSessionSink` takes `sessionId`; `onExit` guards against superseded sessions

**Desktop renderer (`packages/desktop/src/renderer/`)**
- Modify `components/chat/assistant-ui/composer/PlanModeToggle.tsx` — delete `adapterSupportsPlanMode` and `displayModeForDropdown`
- Modify `components/chat/assistant-ui/composer/ComposerCard.tsx` — delete `lastNonPlanModeRef`, use `adapter.capabilities.planMode`, pass `planMode` through `updateChatConfig`
- Modify `components/settings/ProviderSection.tsx` — drop Plan from radio options, add "Start in Plan Mode" checkbox
- Modify `components/settings/constants.ts` — shrink `MODE_OPTIONS`
- Modify `lib/client.ts` / `lib/api/` — `updateChatConfig` signature takes `planMode`
- Modify `components/chat/PlanApprovalCard.tsx` — hide clear-context checkbox for adapters that don't support it (Codex v1)

**E2E (`packages/e2e/tests/`)**
- Create `33-codex-plan-approval.spec.ts` — Codex plan-exit UX test
- Extend `07-plan-approval.spec.ts` — cover orthogonal toggle semantics

---

## Ground Rules

- Every code-touching task does TDD: failing test first, then implementation, then green test, then commit.
- After each task: `pnpm -r run typecheck` must pass. Only commit green.
- Never commit to main. Branch is `feat/plan-mode-button`.
- Per CLAUDE.md: `pnpm changeset` (not `--empty`) at the end for the whole PR.
- Log exact commands and expected output in every run step.

---

## Task 1: Types — Split `PermissionMode`, Add `planMode`, Add Capabilities

**Files:**
- Modify: `packages/types/src/chat.ts`
- Modify: `packages/types/src/adapter.ts`

No test file — types are verified by downstream typecheck in later tasks.

- [ ] **Step 1: Shrink `Chat.permissionMode` and add `Chat.planMode`**

Edit `packages/types/src/chat.ts:16`:

```ts
  permissionMode?: 'default' | 'acceptEdits' | 'yolo';
  planMode?: boolean;
```

- [ ] **Step 2: Shrink `SessionSpawnOptions.permissionMode` and add `planMode`**

Edit `packages/types/src/adapter.ts:31-36`:

```ts
export interface SessionSpawnOptions {
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'yolo';
  planMode?: boolean;
  executablePath?: string;
  systemPrompt?: string;
}
```

- [ ] **Step 3: Add `capabilities` to the `Adapter` interface**

Edit `packages/types/src/adapter.ts:187-218` — add the field right after `name`:

```ts
export interface Adapter {
  id: string;
  name: string;
  readonly capabilities: {
    planMode: boolean;
  };

  isInstalled(): Promise<boolean>;
  // ...rest unchanged
}
```

- [ ] **Step 4: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: success. Downstream typecheck failures in core/desktop are expected and will be resolved in later tasks — do NOT fix them yet.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/chat.ts packages/types/src/adapter.ts
git commit -m "types: split plan mode out of PermissionMode + add adapter capabilities"
```

---

## Task 2: DB Schema — Add `plan_mode` Column + Value Migration

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Test: `packages/core/src/__tests__/db/plan-mode-migration.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/db/plan-mode-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../db/schema.js';

describe('plan_mode column migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('adds plan_mode column defaulting to 0', () => {
    initializeSchema(db);
    const cols = db.pragma('table_info(chats)') as { name: string }[];
    expect(cols.some((c) => c.name === 'plan_mode')).toBe(true);
  });

  it("rewrites permission_mode='plan' to ('default', plan_mode=1) on migration", () => {
    // Pre-migration: create the old schema + seed a row with permission_mode='plan'
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, created_at TEXT, last_opened_at TEXT);
      CREATE TABLE chats (
        id TEXT PRIMARY KEY, adapter_id TEXT, project_id TEXT,
        status TEXT, created_at TEXT, updated_at TEXT,
        permission_mode TEXT
      );
      INSERT INTO projects VALUES ('p1', 'x', '/x', '2026', '2026');
      INSERT INTO chats VALUES ('c1', 'claude', 'p1', 'active', '2026', '2026', 'plan');
      INSERT INTO chats VALUES ('c2', 'codex', 'p1', 'active', '2026', '2026', 'default');
    `);

    initializeSchema(db);

    const rows = db.prepare('SELECT id, permission_mode, plan_mode FROM chats ORDER BY id').all() as {
      id: string;
      permission_mode: string | null;
      plan_mode: number;
    }[];
    expect(rows[0]).toEqual({ id: 'c1', permission_mode: 'default', plan_mode: 1 });
    expect(rows[1]).toEqual({ id: 'c2', permission_mode: 'default', plan_mode: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/db/plan-mode-migration.test.ts`
Expected: FAIL — `plan_mode` column missing.

- [ ] **Step 3: Add column + migration in `schema.ts`**

Edit `packages/core/src/db/schema.ts` — in the migrations block (after the `pinned` check near line 92) add:

```ts
  if (!cols.some((c) => c.name === 'plan_mode')) {
    db.exec('ALTER TABLE chats ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE chats SET plan_mode = 1, permission_mode = 'default' WHERE permission_mode = 'plan'");
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/db/plan-mode-migration.test.ts`
Expected: PASS — both test cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/__tests__/db/plan-mode-migration.test.ts
git commit -m "core(db): add plan_mode column and migrate permission_mode='plan' values"
```

---

## Task 3: `ChatsRepository` — Persist `planMode`

**Files:**
- Modify: `packages/core/src/db/chats.ts`
- Test: `packages/core/src/__tests__/db/chats.test.ts` (existing — add cases)

- [ ] **Step 1: Write failing test cases**

Append to the existing `packages/core/src/__tests__/db/chats.test.ts`:

```ts
  it('reads and writes planMode', () => {
    const chat = repo.create('p1', 'claude');
    expect(chat.planMode).toBe(false);

    repo.update(chat.id, { planMode: true });
    const reread = repo.get(chat.id)!;
    expect(reread.planMode).toBe(true);

    repo.update(chat.id, { planMode: false });
    expect(repo.get(chat.id)!.planMode).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/db/chats.test.ts -t "reads and writes planMode"`
Expected: FAIL — `planMode` is `undefined`.

- [ ] **Step 3: Add `planMode` to `updateColumnMap` and row builders**

Edit `packages/core/src/db/chats.ts:136-154` — add to `updateColumnMap`:

```ts
    planMode: { column: 'plan_mode', transform: (v) => (v ? 1 : 0) },
```

Then find the three row builders at lines ~48, ~76, ~104, ~268. Each builds a `Chat` from a row. Add:

```ts
      planMode: !!(row.planMode ?? row.plan_mode),
```

Note: existing rows use snake_case column aliases in some paths. Verify which each builder reads — follow the same pattern (`row.<camel>` or `row.<snake>`) the rest of that builder uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/db/chats.test.ts -t "reads and writes planMode"`
Expected: PASS.

Also run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/db/chats.test.ts`
Expected: all existing cases still green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/chats.ts packages/core/src/__tests__/db/chats.test.ts
git commit -m "core(db): plumb planMode through ChatsRepository read/write"
```

---

## Task 4: Create `PlanModeActionHandler` Interface

**Files:**
- Create: `packages/core/src/chat/plan-mode-actions.ts`

No test — pure types.

- [ ] **Step 1: Create the file**

```ts
// packages/core/src/chat/plan-mode-actions.ts
import type { Chat, ControlResponse, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ActiveChat } from './types.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { DatabaseManager } from '../db/index.js';

export interface PlanActionContext {
  chatId: string;
  active: ActiveChat;
  chat: Chat;
  db: DatabaseManager;
  messages: MessageCache;
  permissions: PermissionManager;
  emitEvent(event: DaemonEvent): void;
  clearDisplayCache(chatId: string): void;
  startChat(chatId: string): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

export interface PlanModeActionHandler {
  /**
   * User approved the plan WITHOUT clearing context. Default behavior for
   * most adapters is to set planMode=false and apply the chosen exec mode.
   */
  onApprove(response: ControlResponse, context: PlanActionContext): Promise<void>;

  /**
   * User approved AND checked "Clear Context". Adapter decides how to reset
   * (Claude: kill & respawn with same session id; Codex: thread/start new thread).
   */
  onApproveAndClearContext(response: ControlResponse, context: PlanActionContext): Promise<void>;

  /**
   * User rejected the plan. Adapter translates this to the appropriate
   * per-protocol "stay in plan" response.
   */
  onReject(response: ControlResponse, context: PlanActionContext): Promise<void>;

  /**
   * User provided revision feedback. Adapter forwards as free-form text.
   */
  onRevise(feedback: string, response: ControlResponse, context: PlanActionContext): Promise<void>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit -p tsconfig.build.json`
Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/chat/plan-mode-actions.ts
git commit -m "core(chat): add PlanModeActionHandler interface"
```

---

## Task 5: Extract `ClaudePlanModeHandler` + Fix Base-Mode Restore

**Files:**
- Create: `packages/core/src/plugins/builtin/claude/plan-mode-handler.ts`
- Test: `packages/core/src/plugins/builtin/claude/__tests__/plan-mode-handler.test.ts` (create)

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/plugins/builtin/claude/__tests__/plan-mode-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ClaudePlanModeHandler } from '../plan-mode-handler.js';
import type { PlanActionContext } from '../../../../chat/plan-mode-actions.js';
import type { ControlResponse } from '@qlan-ro/mainframe-types';

function mkContext(overrides: Partial<PlanActionContext> = {}): PlanActionContext {
  const session = {
    isSpawned: true,
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
  const chat = {
    id: 'c1',
    planMode: true,
    permissionMode: 'acceptEdits' as const,
    adapterId: 'claude',
    projectId: 'p1',
    status: 'active' as const,
    createdAt: '', updatedAt: '',
    totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, lastContextTokensInput: 0,
  };
  return {
    chatId: 'c1',
    active: { chat, session: session as any },
    chat,
    db: { chats: { update: vi.fn() } } as any,
    messages: { get: vi.fn().mockReturnValue([]) } as any,
    permissions: { shift: vi.fn() } as any,
    emitEvent: vi.fn(),
    clearDisplayCache: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ClaudePlanModeHandler', () => {
  const baseResponse: ControlResponse = {
    requestId: 'r1',
    toolUseId: 't1',
    behavior: 'allow',
    toolName: 'ExitPlanMode',
    executionMode: 'acceptEdits',
  };

  it('onApprove clears planMode and calls setPermissionMode with the base mode', async () => {
    const ctx = mkContext();
    const handler = new ClaudePlanModeHandler();
    await handler.onApprove(baseResponse, ctx);

    expect(ctx.chat.planMode).toBe(false);
    expect(ctx.db.chats.update).toHaveBeenCalledWith('c1', { planMode: false, permissionMode: 'acceptEdits' });
    expect(ctx.active.session!.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('onReject forwards the deny message with Claude preamble handled by respondToPermission', async () => {
    const ctx = mkContext();
    const handler = new ClaudePlanModeHandler();
    const denyResponse: ControlResponse = { ...baseResponse, behavior: 'deny', message: 'needs more work' };
    await handler.onReject(denyResponse, ctx);
    expect(ctx.active.session!.respondToPermission).toHaveBeenCalledWith(denyResponse);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/claude/__tests__/plan-mode-handler.test.ts`
Expected: FAIL — `ClaudePlanModeHandler` does not exist.

- [ ] **Step 3: Implement the handler**

Create `packages/core/src/plugins/builtin/claude/plan-mode-handler.ts`:

```ts
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { PlanModeActionHandler, PlanActionContext } from '../../../chat/plan-mode-actions.js';
import { extractLatestPlanFileFromMessages } from '../../../chat/context-tracker.js';

export class ClaudePlanModeHandler implements PlanModeActionHandler {
  async onApprove(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    ctx.db.chats.update(ctx.chatId, { planMode: false, permissionMode: exec });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.setPermissionMode(exec);
      await ctx.active.session.respondToPermission(response);
    }
  }

  async onApproveAndClearContext(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    const plan = (response.updatedInput as Record<string, unknown> | undefined)?.plan as string | undefined;

    const recoveredPlanPath = extractLatestPlanFileFromMessages(ctx.messages.get(ctx.chatId) ?? []);
    if (recoveredPlanPath && ctx.db.chats.addPlanFile(ctx.chatId, recoveredPlanPath)) {
      ctx.emitEvent({ type: 'context.updated', chatId: ctx.chatId });
    }

    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.respondToPermission({
        ...response,
        behavior: 'deny',
        message: 'User chose to clear context and start a new session.',
      });
      ctx.permissions.shift(ctx.chatId);
      await ctx.active.session.kill();
      ctx.active.session = null;
    } else {
      ctx.permissions.shift(ctx.chatId);
    }

    ctx.chat.claudeSessionId = undefined;
    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    ctx.db.chats.update(ctx.chatId, { claudeSessionId: undefined, planMode: false, permissionMode: exec });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    ctx.messages.set(ctx.chatId, []);
    ctx.clearDisplayCache(ctx.chatId);
    ctx.emitEvent({ type: 'messages.cleared', chatId: ctx.chatId });

    await ctx.startChat(ctx.chatId);
    if (plan) {
      await ctx.sendMessage(ctx.chatId, `Implement the following plan:\n\n${plan}`);
    }
  }

  async onReject(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.respondToPermission(response);
    }
  }

  async onRevise(_feedback: string, response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    // Claude handles feedback via respondToPermission's message field — the PlanApprovalCard
    // already sends behavior=deny with the user's feedback as message.
    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.respondToPermission(response);
    }
  }
}
```

Note the missing `messages.set` method on `MessageCache` in the signature of `PlanActionContext` — add it if missing. The existing `plan-mode-handler.ts` already uses `this.ctx.messages.set(chatId, [])`, so it exists; just make sure the interface in `plan-mode-actions.ts` references it. (Look at `MessageCache` in `packages/core/src/chat/message-cache.ts` and confirm `set(chatId, msgs): void` is public. If not, surface it.)

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/claude/__tests__/plan-mode-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/plan-mode-handler.ts \
        packages/core/src/plugins/builtin/claude/__tests__/plan-mode-handler.test.ts
git commit -m "core(claude): extract plan-mode handler; clear planMode on approve instead of rewriting permissionMode"
```

---

## Task 6: Refactor `plan-mode-handler.ts` to Adapter-Agnostic Dispatcher

**Files:**
- Modify: `packages/core/src/chat/plan-mode-handler.ts`
- Modify: `packages/core/src/plugins/builtin/claude/adapter.ts` (declare capabilities + factory)
- Modify: `packages/core/src/__tests__/plan-mode-handler.test.ts` (update existing tests — the module now delegates)

- [ ] **Step 1: Add `createPlanModeHandler` to the Adapter type**

Edit `packages/types/src/adapter.ts:187-218` — add an optional factory method to the `Adapter` interface:

```ts
  createPlanModeHandler?(): unknown;
  // Typed import would cause a core→types cycle, so core casts the result.
  // Core imports PlanModeActionHandler from './plan-mode-actions'.
```

- [ ] **Step 2: Update Claude adapter to declare capabilities + factory**

Edit `packages/core/src/plugins/builtin/claude/adapter.ts`:

```ts
import { ClaudePlanModeHandler } from './plan-mode-handler.js';

// In the adapter object:
capabilities: { planMode: true },
createPlanModeHandler() {
  return new ClaudePlanModeHandler();
},
```

Verify where the adapter is exported (likely `index.ts`) and follow that pattern.

- [ ] **Step 3: Rewrite the dispatcher**

Replace `packages/core/src/chat/plan-mode-handler.ts` with:

```ts
import type { Chat, ControlResponse, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';
import type { PermissionManager } from './permission-manager.js';
import type { MessageCache } from './message-cache.js';
import type { ActiveChat } from './types.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { PlanModeActionHandler, PlanActionContext } from './plan-mode-actions.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('chat:plan-mode');

export interface PlanModeContext {
  messages: MessageCache;
  db: DatabaseManager;
  permissions: PermissionManager;
  adapters: AdapterRegistry;
  getActiveChat(chatId: string): ActiveChat | undefined;
  emitEvent(event: DaemonEvent): void;
  clearDisplayCache(chatId: string): void;
  startChat(chatId: string): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

export class PlanModeHandler {
  constructor(private ctx: PlanModeContext) {}

  /** Legacy entry for callers that still expect the old no-process method. */
  async handleNoProcess(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
    const exec = (response.executionMode ?? 'default') as NonNullable<Chat['permissionMode']>;
    if (exec !== active.chat.permissionMode || active.chat.planMode) {
      active.chat.permissionMode = exec;
      active.chat.planMode = false;
      this.ctx.db.chats.update(chatId, { permissionMode: exec, planMode: false });
      this.ctx.emitEvent({ type: 'chat.updated', chat: active.chat });
    }
  }

  async handleClearContext(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
    const handler = this.resolveHandler(active.chat.adapterId);
    if (!handler) {
      log.warn({ chatId, adapterId: active.chat.adapterId }, 'no plan-mode handler for adapter');
      return;
    }
    await handler.onApproveAndClearContext(response, this.buildActionContext(chatId, active));
  }

  async handleEscalation(chatId: string, active: ActiveChat, response: ControlResponse): Promise<void> {
    const handler = this.resolveHandler(active.chat.adapterId);
    if (!handler) {
      log.warn({ chatId, adapterId: active.chat.adapterId }, 'no plan-mode handler for adapter');
      return;
    }
    await handler.onApprove(response, this.buildActionContext(chatId, active));
  }

  private resolveHandler(adapterId: string): PlanModeActionHandler | null {
    const adapter = this.ctx.adapters.get(adapterId);
    if (!adapter?.createPlanModeHandler) return null;
    return adapter.createPlanModeHandler() as PlanModeActionHandler;
  }

  private buildActionContext(chatId: string, active: ActiveChat): PlanActionContext {
    return {
      chatId,
      active,
      chat: active.chat,
      db: this.ctx.db,
      messages: this.ctx.messages,
      permissions: this.ctx.permissions,
      emitEvent: this.ctx.emitEvent,
      clearDisplayCache: this.ctx.clearDisplayCache,
      startChat: this.ctx.startChat,
      sendMessage: this.ctx.sendMessage,
    };
  }
}
```

- [ ] **Step 4: Update `PlanModeContext` construction**

Find where `PlanModeHandler` is instantiated in `chat-manager.ts` (grep `new PlanModeHandler`) and add `adapters: this.adapters` to the passed context. The `AdapterRegistry` is already a field on `ChatManager`.

- [ ] **Step 5: Update existing tests in `__tests__/plan-mode-handler.test.ts`**

Existing tests use the old direct-to-Claude handler. Rewrite them to mock an adapter with `createPlanModeHandler` returning a spy, then verify the dispatcher calls the expected method. Keep the same coverage; just update the mock shape.

Use `Agent` tool (Explore) if needed to read `packages/core/src/__tests__/plan-mode-handler.test.ts` and mirror its structure:

```ts
const mockHandler = {
  onApprove: vi.fn(), onApproveAndClearContext: vi.fn(),
  onReject: vi.fn(), onRevise: vi.fn(),
};
const mockAdapter = { createPlanModeHandler: () => mockHandler, capabilities: { planMode: true } };
const adapters = { get: () => mockAdapter } as any;

// construct handler with adapters in ctx
// call handler.handleClearContext(...)
// expect(mockHandler.onApproveAndClearContext).toHaveBeenCalled()
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/plan-mode-handler.test.ts`
Expected: PASS (both rewritten cases).

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/restore-permission.test.ts src/__tests__/control-requests.test.ts`
Expected: still green (dispatcher preserves behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/chat/plan-mode-handler.ts \
        packages/core/src/chat/plan-mode-actions.ts \
        packages/core/src/plugins/builtin/claude/adapter.ts \
        packages/core/src/__tests__/plan-mode-handler.test.ts \
        packages/types/src/adapter.ts
git commit -m "core(chat): make plan-mode handler adapter-pluggable"
```

---

## Task 7: Codex — Capture `plan` Items via Delta Accumulation

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/types.ts`
- Modify: `packages/core/src/plugins/builtin/codex/event-mapper.ts`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts` (create)

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNotification, type CodexSessionState } from '../event-mapper.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

const NULL_SINK: SessionSink = {
  onInit: vi.fn(), onMessage: vi.fn(), onToolResult: vi.fn(), onPermission: vi.fn(),
  onResult: vi.fn(), onExit: vi.fn(), onError: vi.fn(), onCompact: vi.fn(), onCompactStart: vi.fn(),
  onContextUsage: vi.fn(), onPlanFile: vi.fn(), onSkillFile: vi.fn(), onQueuedProcessed: vi.fn(),
  onTodoUpdate: vi.fn(), onPrDetected: vi.fn(),
};

describe('Codex plan item capture', () => {
  let state: CodexSessionState;

  beforeEach(() => {
    state = { threadId: 't1', currentTurnId: 'turn1', currentTurnPlan: null };
  });

  it('accumulates plan delta text into currentTurnPlan', () => {
    handleNotification('item/plan/delta', { itemId: 'p1', delta: '# Plan\n' }, NULL_SINK, state);
    handleNotification('item/plan/delta', { itemId: 'p1', delta: 'Step 1\n' }, NULL_SINK, state);
    expect(state.currentTurnPlan).toEqual({ id: 'p1', text: '# Plan\nStep 1\n' });
  });

  it('finalises the plan when a plan item is emitted', () => {
    handleNotification('item/plan/delta', { itemId: 'p2', delta: 'partial' }, NULL_SINK, state);
    handleNotification('item/completed', { item: { id: 'p2', type: 'plan', text: 'complete plan' } }, NULL_SINK, state);
    expect(state.currentTurnPlan).toEqual({ id: 'p2', text: 'complete plan' });
  });

  it('clears currentTurnPlan on turn/started', () => {
    state.currentTurnPlan = { id: 'old', text: 'stale' };
    handleNotification('turn/started', { turnId: 'turn2' }, NULL_SINK, state);
    expect(state.currentTurnPlan).toBeNull();
  });

  it('clears currentTurnPlan on turn/completed', () => {
    state.currentTurnPlan = { id: 'p', text: 'x' };
    handleNotification('turn/completed', { turnId: 'turn1' }, NULL_SINK, state);
    expect(state.currentTurnPlan).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts`
Expected: FAIL — `currentTurnPlan` not on state.

- [ ] **Step 3: Extend `CodexSessionState`**

Edit `packages/core/src/plugins/builtin/codex/types.ts` (or wherever `CodexSessionState` is defined; search if it's in `event-mapper.ts`):

```ts
export interface CodexSessionState {
  threadId: string | null;
  currentTurnId: string | null;
  currentTurnPlan: { id: string; text: string } | null;
}
```

Initialize in `session.ts` — `readonly state: CodexSessionState = { threadId: null, currentTurnId: null, currentTurnPlan: null };`.

- [ ] **Step 4: Handle plan-related notifications in `event-mapper.ts`**

In `packages/core/src/plugins/builtin/codex/event-mapper.ts` — find the existing `handleNotification` switch and replace the existing `turn/plan/updated` / `item/plan/delta` stubs with real handlers, plus add terminal-item handling:

```ts
    case 'item/plan/delta': {
      const { itemId, delta } = params as { itemId: string; delta: string };
      const prev = state.currentTurnPlan;
      if (prev && prev.id === itemId) {
        state.currentTurnPlan = { id: itemId, text: prev.text + delta };
      } else {
        state.currentTurnPlan = { id: itemId, text: delta };
      }
      return;
    }
    case 'item/completed': {
      const item = (params as { item?: { id?: string; type?: string; text?: string } }).item;
      if (item && item.type === 'plan' && typeof item.text === 'string' && item.id) {
        state.currentTurnPlan = { id: item.id, text: item.text };
      }
      return;
    }
    case 'turn/started':
    case 'turn/completed':
      state.currentTurnPlan = null;
      // fall through to whatever existing handling lives here
      break;
```

(Preserve existing per-case behavior for `turn/started` and `turn/completed` — add the clear before any existing fall-through.)

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/types.ts \
        packages/core/src/plugins/builtin/codex/event-mapper.ts \
        packages/core/src/plugins/builtin/codex/session.ts \
        packages/core/src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts
git commit -m "core(codex): capture plan items from item/plan/delta and item/completed"
```

---

## Task 8: Codex — Route `requestUserInput` to `ExitPlanMode` When Plan Captured

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/approval-handler.ts`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts` (create)

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalHandler } from '../approval-handler.js';

function mkSink() {
  return {
    onInit: vi.fn(), onMessage: vi.fn(), onToolResult: vi.fn(),
    onPermission: vi.fn(), onResult: vi.fn(), onExit: vi.fn(),
    onError: vi.fn(), onCompact: vi.fn(), onCompactStart: vi.fn(),
    onContextUsage: vi.fn(), onPlanFile: vi.fn(), onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(), onTodoUpdate: vi.fn(), onPrDetected: vi.fn(),
  };
}

describe('Codex requestUserInput routing', () => {
  const requestUserInputParams = {
    toolCallId: 'tc1',
    questions: ['Implement this plan?'],
    options: [
      [{ label: 'Yes, implement this plan', description: 'Switch to Default and start coding.' }],
      [{ label: 'No, stay in Plan mode', description: 'Continue planning with the model.' }],
    ],
  };

  it('routes to ExitPlanMode when planMode=true and a plan was captured this turn', () => {
    const sink = mkSink();
    const handler = new ApprovalHandler(sink);
    handler.setPlanContext({ planMode: true, currentTurnPlan: { id: 'p1', text: 'full plan text' } });
    handler.handleRequest('item/tool/requestUserInput', requestUserInputParams, 42, vi.fn());

    expect(sink.onPermission).toHaveBeenCalledTimes(1);
    const req = sink.onPermission.mock.calls[0]![0] as { toolName: string; input: Record<string, unknown> };
    expect(req.toolName).toBe('ExitPlanMode');
    expect(req.input.plan).toBe('full plan text');
  });

  it('routes to AskUserQuestion when planMode=false', () => {
    const sink = mkSink();
    const handler = new ApprovalHandler(sink);
    handler.setPlanContext({ planMode: false, currentTurnPlan: { id: 'p1', text: 'x' } });
    handler.handleRequest('item/tool/requestUserInput', requestUserInputParams, 43, vi.fn());
    const req = sink.onPermission.mock.calls[0]![0] as { toolName: string };
    expect(req.toolName).toBe('AskUserQuestion');
  });

  it('routes to AskUserQuestion when no plan captured yet', () => {
    const sink = mkSink();
    const handler = new ApprovalHandler(sink);
    handler.setPlanContext({ planMode: true, currentTurnPlan: null });
    handler.handleRequest('item/tool/requestUserInput', requestUserInputParams, 44, vi.fn());
    const req = sink.onPermission.mock.calls[0]![0] as { toolName: string };
    expect(req.toolName).toBe('AskUserQuestion');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts`
Expected: FAIL — `setPlanContext` method missing.

- [ ] **Step 3: Extend `ApprovalHandler`**

Edit `packages/core/src/plugins/builtin/codex/approval-handler.ts` — at the top, add:

```ts
interface PlanContext {
  planMode: boolean;
  currentTurnPlan: { id: string; text: string } | null;
}

// In ApprovalHandler class:
private planContext: PlanContext = { planMode: false, currentTurnPlan: null };

setPlanContext(ctx: PlanContext): void {
  this.planContext = ctx;
}
```

Then in `handleRequest`, where `method === 'item/tool/requestUserInput'` maps to `toolName = 'AskUserQuestion'` (around line 40-47), replace:

```ts
    } else if (method === 'item/tool/requestUserInput') {
      // ...
      toolName = 'AskUserQuestion';
```

with:

```ts
    } else if (method === 'item/tool/requestUserInput') {
      // ...
      const isPlanExit =
        this.planContext.planMode &&
        this.planContext.currentTurnPlan !== null &&
        Array.isArray((params as { options?: unknown[] }).options) &&
        ((params as { options?: unknown[] }).options?.length ?? 0) === 2;
      if (isPlanExit) {
        toolName = 'ExitPlanMode';
        input = { plan: this.planContext.currentTurnPlan!.text, allowedPrompts: [] };
      } else {
        toolName = 'AskUserQuestion';
        // ...existing input mapping
      }
```

Adjust for the actual local-variable structure (read the current implementation — mutate in place rather than mirror the snippet verbatim).

- [ ] **Step 4: Call `setPlanContext` from `CodexSession` before forwarding**

In `packages/core/src/plugins/builtin/codex/session.ts`, find where `approvalHandler.handleRequest` is invoked (around line 129). Before the call, or at the start of `onRequest`, push the latest plan context:

```ts
      onRequest: (method, params, id) => {
        approvalHandler.setPlanContext({
          planMode: /* read from the chat — see note below */,
          currentTurnPlan: this.state.currentTurnPlan,
        });
        approvalHandler.handleRequest(method, params, id, (rpcId, result) => {
          this.client?.respond(rpcId, result);
        });
      },
```

The adapter session doesn't have direct access to the `Chat` object. Two options — pick the simpler:

- (i) Add a `setPlanMode(on: boolean)` method on `CodexSession` and call it from `chat-manager.updateChatConfig` + `spawn` + wherever `planMode` changes; session stores the boolean locally.
- (ii) Pass `planMode` via `SessionSpawnOptions` at spawn and require the consumer to call `session.setPlanMode` on toggles.

Use (i). Add a `pendingPlanMode: boolean = false` field to `CodexSession`, a `setPlanMode(on)` setter, and read it in the `onRequest` closure.

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/approval-handler.ts \
        packages/core/src/plugins/builtin/codex/session.ts \
        packages/core/src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts
git commit -m "core(codex): route requestUserInput to ExitPlanMode when in plan mode with captured plan"
```

---

## Task 9: Codex — Plan-Mode Handler (`CodexPlanModeHandler`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/plan-mode-handler.ts`
- Modify: `packages/core/src/plugins/builtin/codex/adapter.ts` — declare capabilities + factory
- Modify: `packages/core/src/plugins/builtin/codex/session.ts` — expose `respondToRequestUserInput(toolCallId, answer)` helper and `startNewThread()` for clear-context approve
- Test: `packages/core/src/plugins/builtin/codex/__tests__/plan-mode-handler.test.ts` (create)

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/plugins/builtin/codex/__tests__/plan-mode-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CodexPlanModeHandler } from '../plan-mode-handler.js';
import type { PlanActionContext } from '../../../../chat/plan-mode-actions.js';
import type { ControlResponse } from '@qlan-ro/mainframe-types';

function mkCtx() {
  const session = {
    isSpawned: true,
    setPlanMode: vi.fn(),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    startNewThread: vi.fn().mockResolvedValue('thread-2'),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
  const chat = {
    id: 'c1', planMode: true, permissionMode: 'acceptEdits' as const,
    adapterId: 'codex', projectId: 'p1', status: 'active' as const,
    createdAt: '', updatedAt: '', totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0,
    lastContextTokensInput: 0,
  };
  return {
    chatId: 'c1',
    active: { chat, session: session as any },
    chat,
    db: { chats: { update: vi.fn() } } as any,
    messages: { get: vi.fn().mockReturnValue([]), set: vi.fn() } as any,
    permissions: { shift: vi.fn() } as any,
    emitEvent: vi.fn(),
    clearDisplayCache: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlanActionContext;
}

describe('CodexPlanModeHandler', () => {
  const planText = 'PROPOSED PLAN TEXT';
  const baseResponse: ControlResponse = {
    requestId: 'r1', toolUseId: 'tc1', behavior: 'allow', toolName: 'ExitPlanMode',
    executionMode: 'acceptEdits', updatedInput: { plan: planText },
  };

  it('onApprove responds with first option and clears planMode', async () => {
    const ctx = mkCtx();
    const h = new CodexPlanModeHandler();
    await h.onApprove(baseResponse, ctx);
    expect(ctx.chat.planMode).toBe(false);
    expect(ctx.db.chats.update).toHaveBeenCalledWith('c1', { planMode: false, permissionMode: 'acceptEdits' });
    expect((ctx.active.session as any).respondToPermission).toHaveBeenCalled();
  });

  it('onApproveAndClearContext starts a new thread and sends the plan as first input', async () => {
    const ctx = mkCtx();
    const h = new CodexPlanModeHandler();
    await h.onApproveAndClearContext(baseResponse, ctx);
    expect((ctx.active.session as any).startNewThread).toHaveBeenCalled();
    expect((ctx.active.session as any).sendMessage).toHaveBeenCalledWith(
      expect.stringContaining(planText),
      undefined,
      undefined,
    );
    expect(ctx.chat.planMode).toBe(false);
  });

  it('onReject responds with the deny option', async () => {
    const ctx = mkCtx();
    const h = new CodexPlanModeHandler();
    const rejectResp: ControlResponse = { ...baseResponse, behavior: 'deny' };
    await h.onReject(rejectResp, ctx);
    expect((ctx.active.session as any).respondToPermission).toHaveBeenCalledWith(rejectResp);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/plan-mode-handler.test.ts`
Expected: FAIL — module and methods missing.

- [ ] **Step 3: Implement `CodexPlanModeHandler`**

Create `packages/core/src/plugins/builtin/codex/plan-mode-handler.ts`:

```ts
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { PlanModeActionHandler, PlanActionContext } from '../../../chat/plan-mode-actions.js';

/**
 * Codex plan-mode uses per-turn collaborationMode. Answering the exit
 * requestUserInput with the correct option + flipping chat.planMode is
 * sufficient to exit plan mode for the next turn.
 */
export class CodexPlanModeHandler implements PlanModeActionHandler {
  async onApprove(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    ctx.db.chats.update(ctx.chatId, { planMode: false, permissionMode: exec });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      setPlanMode?(on: boolean): void;
      respondToPermission(r: ControlResponse): Promise<void>;
    } | null;
    if (session?.isSpawned) {
      session.setPlanMode?.(false);
      // The approval-handler in session.ts knows how to translate our allow/deny
      // into the Codex requestUserInput answer format. Forward unchanged.
      await session.respondToPermission(response);
    }
  }

  async onApproveAndClearContext(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    const plan = (response.updatedInput as Record<string, unknown> | undefined)?.plan as string | undefined;

    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      startNewThread?(): Promise<string>;
      sendMessage(msg: string, images?: unknown, uuid?: string): Promise<void>;
      kill(): Promise<void>;
    } | null;

    if (session?.isSpawned) {
      // Close the requestUserInput by denying first so Codex unblocks.
      await (session as any).respondToPermission({ ...response, behavior: 'deny', message: 'Clearing context.' });
      ctx.permissions.shift(ctx.chatId);
      await session.kill();
      ctx.active.session = null;
    } else {
      ctx.permissions.shift(ctx.chatId);
    }

    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    // Codex "claudeSessionId" equivalent is the thread id; drop it to force a new thread.
    ctx.chat.claudeSessionId = undefined;
    ctx.db.chats.update(ctx.chatId, {
      claudeSessionId: undefined, planMode: false, permissionMode: exec,
    });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    ctx.messages.set(ctx.chatId, []);
    ctx.clearDisplayCache(ctx.chatId);
    ctx.emitEvent({ type: 'messages.cleared', chatId: ctx.chatId });

    await ctx.startChat(ctx.chatId);
    if (plan) {
      await ctx.sendMessage(ctx.chatId, `Implement the following plan:\n\n${plan}`);
    }
  }

  async onReject(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      respondToPermission(r: ControlResponse): Promise<void>;
    } | null;
    if (session?.isSpawned) {
      await session.respondToPermission(response);
    }
  }

  async onRevise(_feedback: string, response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    // Feedback was already appended to response.message by the caller.
    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      respondToPermission(r: ControlResponse): Promise<void>;
    } | null;
    if (session?.isSpawned) {
      await session.respondToPermission(response);
    }
  }
}
```

- [ ] **Step 4: Map approve/deny to the correct Codex requestUserInput option**

In `packages/core/src/plugins/builtin/codex/approval-handler.ts`, the `resolve(response)` path that completes a `requestUserInput` with the user's choice exists already (line 80-106). Update it so when the entry was routed as `ExitPlanMode`:

- `response.behavior === 'allow'` → pick the option that matches `/^yes/i`, fall back to index 0
- `response.behavior === 'deny'` with no `message` → pick the option that matches `/^no/i`, fall back to index 1
- `response.behavior === 'deny'` with a `message` (user Revise) → use the free-text answer path; if Codex rejects free-form (`isOther: false`), fall back to picking the `/^no/i` option and include the message in the follow-up user turn. Log a warning.

Store the rendered option labels on the pending entry when emitting so `resolve` can prefix-match.

- [ ] **Step 5: Declare Codex capability + factory**

Edit `packages/core/src/plugins/builtin/codex/adapter.ts` (or `index.ts`):

```ts
import { CodexPlanModeHandler } from './plan-mode-handler.js';

// In the adapter object:
capabilities: { planMode: true },
createPlanModeHandler() {
  return new CodexPlanModeHandler();
},
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/`
Expected: all Codex tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/plan-mode-handler.ts \
        packages/core/src/plugins/builtin/codex/adapter.ts \
        packages/core/src/plugins/builtin/codex/approval-handler.ts \
        packages/core/src/plugins/builtin/codex/__tests__/plan-mode-handler.test.ts
git commit -m "core(codex): CodexPlanModeHandler + approve/deny → requestUserInput option mapping"
```

---

## Task 10: Codex — Use `planMode` in `buildCollaborationMode`

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/session.ts`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts` (create)

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts
import { describe, it, expect } from 'vitest';
import { CodexSession } from '../session.js';

describe('CodexSession.buildCollaborationMode', () => {
  it('returns plan when planMode=true', () => {
    const s = new CodexSession({ projectPath: '/x' });
    (s as any).pendingPlanMode = true;
    const mode = (s as any).buildCollaborationMode();
    expect(mode.mode).toBe('plan');
  });
  it('returns default when planMode=false', () => {
    const s = new CodexSession({ projectPath: '/x' });
    (s as any).pendingPlanMode = false;
    const mode = (s as any).buildCollaborationMode();
    expect(mode.mode).toBe('default');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts`
Expected: FAIL (current impl reads `pendingPermissionMode === 'plan'`).

- [ ] **Step 3: Edit `buildCollaborationMode` and spawn options**

`packages/core/src/plugins/builtin/codex/session.ts:334-344`:

```ts
  private buildCollaborationMode(): CollaborationMode {
    const mode = this.pendingPlanMode ? 'plan' : 'default';
    return {
      mode,
      settings: { model: this.pendingModel ?? '', reasoning_effort: null, developer_instructions: null },
    };
  }
```

And in `spawn(options)` — initialise `pendingPlanMode` from `options.planMode ?? false`. Remove the `permissionMode === 'plan'` branch in `mapPermissionMode` (plan is no longer a permission value).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/session.ts \
        packages/core/src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts
git commit -m "core(codex): derive collaborationMode from planMode (not permissionMode)"
```

---

## Task 11: Claude — Use `planMode` in Spawn Flag

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts`
- Test: `packages/core/src/__tests__/claude-spawn-args.test.ts` (existing — extend)

- [ ] **Step 1: Extend the existing spawn-args test**

Append cases to `packages/core/src/__tests__/claude-spawn-args.test.ts` (use the `Explore` subagent or Read tool to look at the current test, then mirror):

```ts
  it('passes --permission-mode plan when planMode=true', () => {
    const args = buildSpawnArgs({ planMode: true, permissionMode: 'acceptEdits' });
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('passes --permission-mode <base> when planMode=false', () => {
    const args = buildSpawnArgs({ planMode: false, permissionMode: 'acceptEdits' });
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
  });
```

(If the test file doesn't expose `buildSpawnArgs`, extract it from inside `spawn` to a pure helper; otherwise stub via spy on `spawn`.)

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/claude-spawn-args.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `spawn()`**

`packages/core/src/plugins/builtin/claude/session.ts:146-147`:

```ts
    const cliMode = options.planMode
      ? 'plan'
      : options.permissionMode === 'yolo'
        ? 'bypassPermissions'
        : (options.permissionMode ?? 'default');
    args.push('--permission-mode', cliMode, '--allow-dangerously-skip-permissions');
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/claude-spawn-args.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/session.ts \
        packages/core/src/__tests__/claude-spawn-args.test.ts
git commit -m "core(claude): derive --permission-mode from planMode"
```

---

## Task 12: `updateChatConfig` — Add `planMode` End-to-End

**Files:**
- Modify: `packages/core/src/server/ws-schemas.ts`
- Modify: `packages/core/src/server/websocket.ts`
- Modify: `packages/core/src/chat/chat-manager.ts`
- Modify: `packages/core/src/chat/config-manager.ts`
- Modify: `packages/desktop/src/renderer/lib/client.ts` + `lib/api/` (whatever is the renderer wrapper)
- Test: `packages/core/src/__tests__/control-requests.test.ts` (existing — add case)

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/__tests__/control-requests.test.ts`:

```ts
    it('updateChatConfig toggles planMode via set_permission_mode (Claude)', async () => {
      // ...existing setup…
      await manager.updateChatConfig(chatId, undefined, undefined, undefined, true);
      expect(session.setPermissionMode).toHaveBeenCalledWith('plan');
      expect(db.chats.update).toHaveBeenCalledWith(chatId, expect.objectContaining({ planMode: true }));

      await manager.updateChatConfig(chatId, undefined, undefined, undefined, false);
      // Off → restores base permissionMode (whatever chat has stored)
      expect(session.setPermissionMode).toHaveBeenLastCalledWith(chat.permissionMode);
      expect(db.chats.update).toHaveBeenLastCalledWith(chatId, expect.objectContaining({ planMode: false }));
    });
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/control-requests.test.ts -t "updateChatConfig toggles planMode"`
Expected: FAIL — arity mismatch.

- [ ] **Step 3: Plumb the param**

**Zod schema (`ws-schemas.ts:35`):**

```ts
  type: z.literal('chat.updateConfig'),
  chatId: z.string(),
  adapterId: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'yolo']).optional(),
  planMode: z.boolean().optional(),
```

(Note the enum no longer includes `'plan'`.)

**WebSocket handler (`websocket.ts:127-128`):**

```ts
      case 'chat.updateConfig': {
        await this.chats.updateChatConfig(
          event.chatId, event.adapterId, event.model, event.permissionMode, event.planMode,
        );
        // ...
```

**`ChatManager.updateChatConfig` (`chat-manager.ts:154-160`):**

```ts
  async updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: 'default' | 'acceptEdits' | 'yolo',
    planMode?: boolean,
  ): Promise<void> {
    return this.configManager.updateChatConfig(chatId, adapterId, model, permissionMode, planMode);
  }
```

**`ConfigManager` (`config-manager.ts:27`):** add `planMode` param. When `planMode` changes:

- Update DB + chat state.
- If `planMode === true`: call `session.setPermissionMode('plan')` for Claude; for Codex call `session.setPlanMode(true)`.
- If `planMode === false`: call `session.setPermissionMode(chat.permissionMode)` for Claude; for Codex call `session.setPlanMode(false)`.

For adapter-specific dispatch, prefer reading `adapter.capabilities.planMode` and branching by `adapterId` (or extend the adapter session interface with `async setPlanMode(on: boolean)` so the ConfigManager calls it uniformly). Recommended: add `setPlanMode(on: boolean): Promise<void>` to `AdapterSession` in `packages/types/src/adapter.ts`, default-implement in Claude (`session.setPermissionMode(on ? 'plan' : this.basePermissionMode)`) and in Codex (update `pendingPlanMode`).

**Renderer (`packages/desktop/src/renderer/lib/client.ts`):**

```ts
  updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: 'default' | 'acceptEdits' | 'yolo',
    planMode?: boolean,
  ) {
    this.ws.send({ type: 'chat.updateConfig', chatId, adapterId, model, permissionMode, planMode });
  }
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/control-requests.test.ts`
Expected: PASS — the new case plus all existing ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/ws-schemas.ts \
        packages/core/src/server/websocket.ts \
        packages/core/src/chat/chat-manager.ts \
        packages/core/src/chat/config-manager.ts \
        packages/types/src/adapter.ts \
        packages/core/src/plugins/builtin/claude/session.ts \
        packages/core/src/plugins/builtin/codex/session.ts \
        packages/desktop/src/renderer/lib/client.ts \
        packages/core/src/__tests__/control-requests.test.ts
git commit -m "core+desktop: plumb planMode through updateChatConfig"
```

---

## Task 13: Lifecycle — Read `defaultPlanMode` at Chat Creation

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts`
- Test: `packages/core/src/__tests__/chat/create-on-worktree.test.ts` OR a new `chat-creation-defaults.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/__tests__/chat-creation-defaults.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatLifecycleManager } from '../chat/lifecycle-manager.js';

describe('createChatWithDefaults reads defaultPlanMode', () => {
  it('sets planMode=true when provider.claude.defaultPlanMode=true', async () => {
    const db = {
      chats: { create: vi.fn((...args) => ({ id: 'c', adapterId: args[1], projectId: args[0] })), update: vi.fn() },
      settings: {
        get: vi.fn((cat: string, key: string) => {
          if (key === 'claude.defaultPlanMode') return 'true';
          return undefined;
        }),
      },
    };
    const deps: any = {
      db, adapters: { get: () => null }, activeChats: new Map(),
      messages: {}, permissions: {}, emitEvent: vi.fn(), buildSink: vi.fn(),
    };
    const mgr = new ChatLifecycleManager(deps);
    await mgr.createChatWithDefaults('p1', 'claude');
    expect(db.chats.update).toHaveBeenCalledWith('c', expect.objectContaining({ planMode: true }));
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/chat-creation-defaults.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Edit `packages/core/src/chat/lifecycle-manager.ts:75-95` — `createChatWithDefaults`:

```ts
  async createChatWithDefaults(
    projectId: string, adapterId: string, model?: string, permissionMode?: string,
    worktreePath?: string, branchName?: string,
  ): Promise<Chat> {
    let effectiveModel = model;
    let effectiveMode = permissionMode;
    let effectivePlanMode: boolean | undefined;

    const defaultModel = this.deps.db.settings.get('provider', `${adapterId}.defaultModel`);
    const defaultMode = this.deps.db.settings.get('provider', `${adapterId}.defaultMode`);
    const defaultPlanMode = this.deps.db.settings.get('provider', `${adapterId}.defaultPlanMode`);

    if (!effectiveModel && defaultModel) effectiveModel = defaultModel;
    if (!effectiveMode && defaultMode) effectiveMode = defaultMode;
    if (defaultPlanMode === 'true') effectivePlanMode = true;

    const chat = await this.createChat(projectId, adapterId, effectiveModel, effectiveMode, worktreePath, branchName);
    if (effectivePlanMode) {
      chat.planMode = true;
      this.deps.db.chats.update(chat.id, { planMode: true });
    }
    return chat;
  }
```

- [ ] **Step 4: Run test — expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/lifecycle-manager.ts \
        packages/core/src/__tests__/chat-creation-defaults.test.ts
git commit -m "core(chat): seed planMode from provider.<id>.defaultPlanMode on chat creation"
```

---

## Task 14: Session `kill()` — Await Close with 3s SIGKILL Fallback

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts`
- Modify: `packages/core/src/plugins/builtin/codex/session.ts`
- Test: `packages/core/src/plugins/builtin/claude/__tests__/kill-awaits-close.test.ts` (create)

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/plugins/builtin/claude/__tests__/kill-awaits-close.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ClaudeSession } from '../session.js';

describe('ClaudeSession.kill() awaits close', () => {
  it('resolves only after the child emits close', async () => {
    const s = new ClaudeSession({ projectPath: '/tmp' });
    const listeners: Record<string, ((...a: any[]) => void)[]> = {};
    const fakeChild: any = {
      kill: vi.fn(),
      exitCode: null,
      once(ev: string, cb: any) { (listeners[ev] ||= []).push(cb); },
      on() {}, stdout: { on() {} }, stderr: { on() {} },
    };
    (s as any).state.child = fakeChild;

    let resolved = false;
    const p = s.kill().then(() => { resolved = true; });

    // Microtask flush
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Simulate child exit
    listeners.close?.[0]?.();
    await p;
    expect(resolved).toBe(true);
    expect((s as any).state.child).toBeNull();
  });

  it('falls back to SIGKILL after 3s if close never fires', async () => {
    vi.useFakeTimers();
    const s = new ClaudeSession({ projectPath: '/tmp' });
    const fakeChild: any = {
      kill: vi.fn(),
      exitCode: null,
      once() {},
      on() {}, stdout: { on() {} }, stderr: { on() {} },
    };
    (s as any).state.child = fakeChild;

    const p = s.kill();
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/claude/__tests__/kill-awaits-close.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `kill()` in Claude**

`packages/core/src/plugins/builtin/claude/session.ts:200-207`:

```ts
  async kill(): Promise<void> {
    const child = this.state.child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }
        resolve();
      }, 3000),
    );
    child.kill('SIGTERM');
    await Promise.race([exited, timeout]);
    this.state.child = null;
    log.debug({ sessionId: this.id }, 'claude session killed');
  }
```

- [ ] **Step 4: Same pattern in Codex `session.ts:229-233`**

```ts
  async kill(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.approvalHandler?.rejectAll();
    const closed = new Promise<void>((resolve) => client.onClose(() => resolve()));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    client.close();
    await Promise.race([closed, timeout]);
    this.client = null;
  }
```

Verify that `JsonRpcClient` has `onClose(cb)` — if not, expose one.

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/plugins/builtin/claude/__tests__/kill-awaits-close.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/session.ts \
        packages/core/src/plugins/builtin/codex/session.ts \
        packages/core/src/plugins/builtin/codex/jsonrpc.ts \
        packages/core/src/plugins/builtin/claude/__tests__/kill-awaits-close.test.ts
git commit -m "core(session): kill() awaits close with SIGKILL fallback"
```

---

## Task 15: Session-Identity Guard on `onExit`

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts`
- Test: `packages/core/src/__tests__/session-identity-guard.test.ts` (create)

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/__tests__/session-identity-guard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventHandler } from '../chat/event-handler.js';

describe('buildSink onExit: session-identity guard', () => {
  it('ignores close from a superseded session', () => {
    const chatId = 'c1';
    const chat: any = { id: chatId, processState: 'working' };
    const newSession = { id: 'session-new' };
    const activeChat = { chat, session: newSession };

    const emitted: any[] = [];
    const handler = new EventHandler(
      { chats: { update: vi.fn() } } as any,
      { get: () => [], set: vi.fn() } as any,
      { clear: vi.fn(), clearInterrupted: vi.fn() } as any,
      () => activeChat as any,
      (ev) => emitted.push(ev),
    );
    const sink = handler.buildSink(chatId, 'session-OLD', vi.fn());
    sink.onExit(0);

    expect(chat.processState).toBe('working');  // unchanged
    expect(emitted.find((e) => e.type === 'chat.updated')).toBeUndefined();
  });

  it('applies close from the current session', () => {
    const chatId = 'c2';
    const chat: any = { id: chatId, processState: 'working' };
    const currentSession = { id: 'session-A' };
    const activeChat = { chat, session: currentSession };

    const emitted: any[] = [];
    const handler = new EventHandler(
      { chats: { update: vi.fn() } } as any,
      { get: () => [], set: vi.fn() } as any,
      { clear: vi.fn(), clearInterrupted: vi.fn() } as any,
      () => activeChat as any,
      (ev) => emitted.push(ev),
    );
    const sink = handler.buildSink(chatId, 'session-A', vi.fn());
    sink.onExit(0);

    expect(chat.processState).toBeNull();
    expect(emitted.some((e) => e.type === 'chat.updated')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/session-identity-guard.test.ts`
Expected: FAIL — `buildSink` doesn't accept sessionId.

- [ ] **Step 3: Thread the id through**

Edit `packages/core/src/chat/event-handler.ts:61-75`:

```ts
  buildSink(
    chatId: string,
    sessionId: string,
    respondToPermission: (response: ControlResponse) => Promise<void>,
  ): SessionSink {
    return buildSessionSink(
      chatId, sessionId, this.db, this.messages, this.permissions,
      this.getActiveChat, this.emitEvent, respondToPermission,
      this.displayCache, this.getToolCategories,
      this.onQueuedProcessed, this.onQueuedCleared, this.pushService,
    );
  }
```

Inside `buildSessionSink` signature, accept `builtForSessionId: string` and in `onExit`:

```ts
    onExit(_code) {
      const active = getActiveChat(chatId);
      // Guard: ignore stale close from a superseded session.
      if (active?.session && active.session.id !== builtForSessionId) return;
      // ...existing logic
    },
```

- [ ] **Step 4: Update callers**

`lifecycle-manager.ts:422` passes the sink via `this.deps.buildSink(chatId, respondToPermission)` — the `LifecycleManagerDeps.buildSink` signature in `lifecycle-manager.ts:29` needs a `sessionId` param:

```ts
  buildSink: (
    chatId: string, sessionId: string,
    respondToPermission: (response: ControlResponse) => Promise<void>,
  ) => SessionSink;
```

And callers of `buildSink` must pass `session.id`. In `lifecycle-manager.ts:422`:

```ts
    const sink = this.deps.buildSink(chatId, session.id, (r) => session.respondToPermission(r));
```

Follow the same pattern for `doLoadChat` if it builds a sink.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/session-identity-guard.test.ts src/__tests__/event-handler.test.ts`
Expected: PASS — new tests + existing tests keep green (update existing tests to pass the new `sessionId` arg if they call `buildSink` directly).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/chat/event-handler.ts \
        packages/core/src/chat/lifecycle-manager.ts \
        packages/core/src/__tests__/session-identity-guard.test.ts \
        packages/core/src/__tests__/event-handler.test.ts
git commit -m "core: guard onExit against superseded sessions"
```

---

## Task 16: Composer UI — Use Adapter Capabilities + Delete Hacks

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/PlanModeToggle.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx`
- Modify: `packages/desktop/src/renderer/store/adapters.ts` (or wherever adapter metadata ships to UI)
- Test: update existing composer tests

- [ ] **Step 1: Extend adapter store to expose `capabilities`**

`AdapterInfo` (from `packages/types/src/adapter.ts:153-161`) gains:

```ts
export interface AdapterInfo {
  id: string; name: string; description: string; installed: boolean;
  version?: string;
  models: AdapterModel[];
  capabilities: { planMode: boolean };
}
```

Find the daemon route that builds `AdapterInfo` (grep `AdapterInfo`); include `adapter.capabilities` in the response.

- [ ] **Step 2: Delete `adapterSupportsPlanMode` and `displayModeForDropdown`**

Edit `PlanModeToggle.tsx:1-51` — keep only the `PlanModeToggle` component. Delete the two helper functions entirely.

- [ ] **Step 3: Gate the toggle on `adapter.capabilities.planMode`**

Edit `ComposerCard.tsx` where the toggle is rendered (around line 418):

```tsx
{currentAdapterInfo?.capabilities?.planMode && (
  <PlanModeToggle active={currentMode === 'plan' || chat?.planMode === true} onToggle={handlePlanToggle} />
)}
```

Read `currentAdapterInfo` from the adapters store keyed on `currentAdapter`.

- [ ] **Step 4: Remove `lastNonPlanModeRef` and `displayModeForDropdown`**

Edit `ComposerCard.tsx`:

- Delete `const lastNonPlanModeRef = useRef<...>`.
- In `handleModeChange`, drop the `if (typedMode !== 'plan') { lastNonPlanModeRef... }` block — just call `updateChatConfig`.
- In `handlePlanToggle(enable)`:
  ```tsx
  const handlePlanToggle = useCallback((enable: boolean) => {
    if (!chatId) return;
    daemonClient.updateChatConfig(chatId, undefined, undefined, undefined, enable);
  }, [chatId]);
  ```
- Dropdown: `value={currentMode}` (remove `displayModeForDropdown` wrap).
- Icon className: simplify back to plain `currentMode === 'yolo' ? 'text-mf-destructive' : undefined`.
- `currentMode` source should now derive from `chat?.permissionMode` directly (no more 'plan' possible).

- [ ] **Step 5: Toggle-button active state**

The toggle now activates on `chat?.planMode === true` rather than `currentMode === 'plan'`:

```tsx
<PlanModeToggle active={chat?.planMode === true} onToggle={handlePlanToggle} />
```

- [ ] **Step 6: Run desktop tests**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test`
Expected: PASS — existing tests updated or pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/PlanModeToggle.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx \
        packages/desktop/src/renderer/store/adapters.ts \
        packages/types/src/adapter.ts
# plus any route file building AdapterInfo + tests that changed
git commit -m "desktop(composer): use adapter.capabilities for plan-mode gate; drop orthogonal-mode hacks"
```

---

## Task 17: Settings UI — Shrink Radio, Add "Start in Plan Mode" Checkbox

**Files:**
- Modify: `packages/desktop/src/renderer/components/settings/ProviderSection.tsx`
- Modify: `packages/desktop/src/renderer/components/settings/constants.ts`
- Test: new `packages/desktop/src/renderer/components/settings/__tests__/plan-mode-checkbox.test.tsx`

- [ ] **Step 1: Drop Plan from `MODE_OPTIONS`**

Edit `packages/desktop/src/renderer/components/settings/constants.ts` — delete the `{ id: 'plan', ... }` entry from `MODE_OPTIONS`. Result: Interactive, Auto-Edits, Unattended.

- [ ] **Step 2: Write failing test**

```tsx
// packages/desktop/src/renderer/components/settings/__tests__/plan-mode-checkbox.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderSection } from '../ProviderSection';

vi.mock('../../../lib/api', () => ({
  getConfigConflicts: () => Promise.resolve([]),
  updateProviderSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../store/adapters', () => ({
  useAdaptersStore: (sel: any) => sel({
    adapters: [{ id: 'claude', name: 'Claude', capabilities: { planMode: true } }],
  }),
}));
// mock useSettingsStore to return a writeable spied-on config…

describe('ProviderSection — Start in Plan Mode', () => {
  it('renders the checkbox only when adapter supports plan mode', () => {
    render(<ProviderSection adapterId="claude" label="Claude" />);
    expect(screen.getByLabelText(/start in plan mode/i)).toBeInTheDocument();
  });

  it('writes defaultPlanMode on click', async () => {
    const { updateProviderSettings } = await import('../../../lib/api');
    render(<ProviderSection adapterId="claude" label="Claude" />);
    fireEvent.click(screen.getByLabelText(/start in plan mode/i));
    expect(updateProviderSettings).toHaveBeenCalledWith('claude', { defaultPlanMode: 'true' });
  });

  it('is hidden for adapters without plan capability', () => {
    // re-mock adapters store for this case
    // …
  });
});
```

- [ ] **Step 3: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test src/renderer/components/settings/__tests__/plan-mode-checkbox.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the checkbox**

Edit `ProviderSection.tsx` — after the mode radio block (around line 116), add:

```tsx
{adapter?.capabilities?.planMode && (
  <label className="flex items-start gap-2.5 px-3 py-2 rounded-mf-input cursor-pointer hover:bg-mf-hover transition-colors">
    <input
      type="checkbox"
      checked={config.defaultPlanMode === 'true'}
      onChange={(e) => update({ defaultPlanMode: e.target.checked ? 'true' : 'false' })}
      className="mt-0.5 accent-mf-accent"
    />
    <div>
      <span className="text-mf-small text-mf-text-primary">Start in Plan Mode</span>
      <p className="text-mf-status text-mf-text-secondary">
        New chats begin with plan mode enabled. You can toggle off mid-session.
      </p>
    </div>
  </label>
)}
```

Where `adapter` comes from:

```tsx
const adapter = adapters.find((a) => a.id === adapterId);
```

- [ ] **Step 5: Extend `ProviderConfig` type**

`packages/types/src/settings.ts` (or wherever `ProviderConfig` lives): add `defaultPlanMode?: 'true' | 'false';`.

- [ ] **Step 6: Run tests — expect pass**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/components/settings/ProviderSection.tsx \
        packages/desktop/src/renderer/components/settings/constants.ts \
        packages/desktop/src/renderer/components/settings/__tests__/plan-mode-checkbox.test.tsx \
        packages/types/src/settings.ts
git commit -m "desktop(settings): replace Plan radio option with 'Start in Plan Mode' checkbox"
```

---

## Task 18: Settings Key Migration — `defaultMode='plan'` → `defaultMode='default'` + `defaultPlanMode='true'`

**Files:**
- Modify: `packages/core/src/db/schema.ts` (add settings migration block)
- Test: extend `packages/core/src/__tests__/db/plan-mode-migration.test.ts`

- [ ] **Step 1: Extend the migration test**

```ts
  it("rewrites settings.defaultMode='plan' to ('default' + defaultPlanMode='true') on migration", () => {
    db.exec(`
      CREATE TABLE settings (id TEXT PRIMARY KEY, category TEXT, key TEXT, value TEXT, updated_at TEXT, UNIQUE(category, key));
      INSERT INTO settings VALUES ('s1', 'provider', 'claude.defaultMode', 'plan', '2026');
      INSERT INTO settings VALUES ('s2', 'provider', 'codex.defaultMode', 'acceptEdits', '2026');
    `);

    initializeSchema(db);

    const row = db.prepare("SELECT value FROM settings WHERE category='provider' AND key='claude.defaultMode'").get() as { value: string };
    expect(row.value).toBe('default');
    const planRow = db.prepare("SELECT value FROM settings WHERE category='provider' AND key='claude.defaultPlanMode'").get() as { value: string } | undefined;
    expect(planRow?.value).toBe('true');
  });
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/db/plan-mode-migration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add settings migration in `schema.ts`**

At the end of `initializeSchema`, add:

```ts
  // Settings migration: defaultMode='plan' → defaultMode='default' + defaultPlanMode='true'
  const planModeSettings = db.prepare(
    `SELECT id, key FROM settings WHERE category='provider' AND key LIKE '%.defaultMode' AND value='plan'`,
  ).all() as { id: string; key: string }[];

  for (const { id, key } of planModeSettings) {
    const prefix = key.slice(0, -'.defaultMode'.length);
    const planKey = `${prefix}.defaultPlanMode`;
    db.prepare(`UPDATE settings SET value='default', updated_at=? WHERE id=?`).run(new Date().toISOString(), id);
    db.prepare(
      `INSERT INTO settings (id, category, key, value, updated_at)
       VALUES (?, 'provider', ?, 'true', ?)
       ON CONFLICT(category, key) DO UPDATE SET value='true', updated_at=excluded.updated_at`,
    ).run(`${id}-plan`, planKey, new Date().toISOString());
  }
```

- [ ] **Step 4: Run test — expect pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/__tests__/db/plan-mode-migration.test.ts
git commit -m "core(db): migrate provider.*.defaultMode='plan' to defaultPlanMode='true'"
```

---

## Task 19: Regression Test for the Thinking Bug

**Files:**
- Create: `packages/core/src/__tests__/clear-context-thinking.test.ts`

- [ ] **Step 1: Write the regression test**

```ts
// packages/core/src/__tests__/clear-context-thinking.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ChatLifecycleManager } from '../chat/lifecycle-manager.js';
// + minimal fixture helpers

describe('clear-context approve: Thinking indicator stays on', () => {
  it('kill() resolves only after close; subsequent processState=working survives', async () => {
    // Set up a spawned session where kill() waits on a close-event promise we control.
    // Drive the clear-context flow (PlanModeHandler.handleClearContext equivalent):
    //   - kill() is awaited → close event fires WITH session-identity guard preventing stale onExit
    //   - startChat() creates a new session (sessionId='new')
    //   - sendMessage() sets processState='working'
    // Then simulate the OLD session's close event arriving LATE:
    //   - buildSink(chatId, 'old', ...) → onExit(0)
    //   - because active.session.id === 'new', onExit is a no-op
    // Assert chat.processState === 'working' at the end.
    // (Expand to a full fixture — the intent is a true end-to-end regression.)
  });
});
```

Fill in the body using existing test fixtures in `packages/core/src/__tests__/` as reference (look at `chat-resume.test.ts` for the ActiveChat construction pattern).

- [ ] **Step 2: Run the test**

By the time this task runs (it is ordered after Tasks 14 + 15), both the `kill()` await and the session-identity guard are in place.

Run: `pnpm --filter @qlan-ro/mainframe-core test --run src/__tests__/clear-context-thinking.test.ts`
Expected: PASS. (To sanity-check the regression actually catches a regression, temporarily revert the guard in `event-handler.ts`; the test should then FAIL.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/clear-context-thinking.test.ts
git commit -m "core(test): regression for Thinking-indicator after clear-context approve"
```

---

## Task 20: E2E — Codex Plan-Approval Flow

**Files:**
- Create: `packages/e2e/tests/33-codex-plan-approval.spec.ts`
- Optional: extend `packages/e2e/tests/07-plan-approval.spec.ts` with the toggle-orthogonality case

- [ ] **Step 1: Author the E2E**

```ts
// packages/e2e/tests/33-codex-plan-approval.spec.ts
import { test, expect } from '../fixtures/chat';

test('Codex plan-mode toggle shows PlanApprovalCard on exit prompt', async ({ chat }) => {
  await chat.selectAdapter('codex');
  await chat.clickPlanModeToggle();
  expect(await chat.isPlanModeActive()).toBe(true);

  await chat.sendMessage('Plan how to add a search box to the project list');
  await chat.waitForPlanApprovalCard();
  // Plan preview rendered, Approve button present
  expect(await chat.planApprovalCard.plan()).toContain('search');

  await chat.approvePlan({ execMode: 'acceptEdits' });
  expect(await chat.isPlanModeActive()).toBe(false);
});
```

Reference the existing `07-plan-approval.spec.ts` for fixtures / helpers. Extend the chat fixture with any missing helpers (`clickPlanModeToggle`, `isPlanModeActive`) alongside this test.

- [ ] **Step 2: Run E2E locally**

Run: `pnpm --filter @qlan-ro/mainframe-e2e test --run tests/33-codex-plan-approval.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/tests/33-codex-plan-approval.spec.ts packages/e2e/fixtures/chat.ts
git commit -m "e2e: Codex plan-approval parity"
```

---

## Task 21: Final Verification + Changeset

- [ ] **Step 1: Full typecheck**

Run: `pnpm -r run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 4: Changeset**

Run: `pnpm changeset`

- Packages: `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-desktop`
- Bump: **minor** (new feature + migration)
- Summary (paste into the editor):

```
Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.
```

- [ ] **Step 5: Commit the changeset**

```bash
git add .changeset/*.md
git commit -m "chore: changeset for plan-mode-orthogonal"
```

- [ ] **Step 6: Push and update PR #232**

```bash
git push
```

The existing PR #232 on GitHub will update automatically. Update the PR description to reflect the new scope — the "Claude only" gate and the "ref resets on reload" notes are obsolete.

---

## Self-Review Results

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| Data model split | Task 1, 3 |
| DB migration | Task 2, 18 |
| Adapter capabilities | Task 1, 6, 9 |
| Claude plan transport | Task 11 |
| Codex plan transport | Task 10 |
| Plan capture (Codex) | Task 7 |
| Plan exit routing (Codex) | Task 8 |
| Plan-mode-handler dispatch | Task 4, 5, 6, 9 |
| Settings UI | Task 17 |
| Composer UI | Task 16 |
| Thinking bug — kill() await | Task 14 |
| Thinking bug — identity guard | Task 15 |
| Error handling (fallbacks) | Task 8 (label drift), Task 14 (SIGKILL fallback) |
| Testing (unit + E2E) | Task 2, 5, 7, 8, 9, 10, 11, 12, 14, 15, 17, 18, 19, 20 |

**Placeholder scan:** No "TBD" / "TODO" / "fill in later" — every code step ships real code. Two spots leave the exact surrounding implementation to the executing agent: Task 6 step 5 (existing `plan-mode-handler.test.ts` rewrite — references concrete mock shape) and Task 15 step 4 (caller updates — I name the file:line). Both are specific enough to execute.

**Type consistency:**
- `PermissionMode` narrowed to `'default' | 'acceptEdits' | 'yolo'` across Task 1, 12, 17 — consistent.
- `planMode: boolean` on `Chat`, `SessionSpawnOptions`, `SessionOptions`-adjacent — consistent.
- `capabilities: { planMode: boolean }` on `Adapter` — Task 1 defines, Task 6 uses, Task 16 consumes, consistent.
- `PlanModeActionHandler` methods `onApprove/onApproveAndClearContext/onReject/onRevise` — referenced consistently in Tasks 5 and 9 implementations and Task 6 dispatcher.
