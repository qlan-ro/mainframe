# SDK + SessionSink Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the EventEmitter-based session→core communication with a typed `SessionSink` callback interface, remove `BaseAdapter`/`BaseSession`, rename `Permission*` → `Control*`, and make `@mainframe/types` a publishable SDK.

**Architecture:** `AdapterSession.spawn()` receives a `SessionSink` that the core builds — sessions call `sink.onMessage(...)` etc. instead of `this.emit('message', ...)`. All base classes move to test helpers. The types package becomes the SDK: no private flag, full `PluginContext` typing, no magic event strings.

**Tech Stack:** TypeScript (NodeNext), pnpm workspaces, vitest

---

## Task 1: Rename `Permission*` → `Control*` across the entire codebase

**Files:**
- Modify: `packages/types/src/adapter.ts`
- Modify: `packages/types/src/events.ts`
- Modify: `packages/types/src/chat.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/core/src/chat/chat-manager.ts`
- Modify: `packages/core/src/chat/permission-handler.ts`
- Modify: `packages/core/src/chat/permission-manager.ts`
- Modify: `packages/core/src/chat/plan-mode-handler.ts`
- Modify: `packages/core/src/plugins/builtin/claude/session.ts`
- Modify: `packages/core/src/plugins/builtin/claude/events.ts`
- Modify: `packages/core/src/__tests__/permission-flow.test.ts`
- Modify: `packages/core/src/__tests__/plan-mode-handler.test.ts`
- Modify: `packages/core/src/__tests__/adapter-events-flow.test.ts`
- Modify: `packages/core/src/__tests__/ws-inbound-flow.test.ts`
- Modify: `packages/core/src/__tests__/restore-permission.test.ts`
- Modify: `packages/desktop/src/renderer/lib/client.ts`
- Modify: `packages/desktop/src/renderer/components/chat/PermissionCard.tsx`
- Modify: `packages/desktop/src/renderer/hooks/useDaemon.ts`
- Modify: `packages/desktop/src/__tests__/components/PermissionCard.test.tsx`

**Step 1: Rename type definitions in `packages/types/src/adapter.ts`**

Using replace_all on each name:
- `PermissionBehavior` → `ControlBehavior`
- `PermissionDestination` → `ControlDestination`
- `PermissionUpdate` → `ControlUpdate`
- `PermissionRequest` → `ControlRequest`
- `PermissionResponse` → `ControlResponse`

The types are defined at lines ~73-120. After rename the file's export surface changes — the same renames must cascade everywhere.

**Step 2: Update `packages/types/src/events.ts`**

Change every `PermissionRequest` → `ControlRequest` and `PermissionResponse` → `ControlResponse` in imports and in `DaemonEvent` / `ClientEvent` union types.

**Step 3: Update `packages/types/src/chat.ts`**

Change `PermissionRequest` → `ControlRequest` in the `MessageContent` union.

**Step 4: Update `packages/types/src/index.ts`**

If it re-exports Permission* types by name, update to `Control*`.

**Step 5: Rename in all core files**

For each file listed above: change all imports and usages. No logic changes — pure rename.

```bash
# Quick sanity check after all edits:
grep -r "Permission" packages/core/src/ packages/types/src/ packages/desktop/src/ \
  --include="*.ts" --include="*.tsx" | grep -v ".md" | grep -v node_modules
```

Expected: zero matches (only docs allowed to have it).

**Step 6: Build and verify**

```bash
pnpm build 2>&1 | tail -20
```

Expected: PASS — clean build, no errors.

**Step 7: Run tests**

```bash
pnpm --filter @mainframe/core test 2>&1 | tail -20
```

Expected: 477/480 (same as before — only pre-existing title-generation failures).

**Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: rename Permission* types to Control* across codebase

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `SessionSink` to `@mainframe/types`, update `AdapterSession` interface

**Files:**
- Modify: `packages/types/src/adapter.ts`
- Modify: `packages/types/src/plugin.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/package.json`

**Step 1: Add `MessageMetadata`, `SessionResult`, `SessionSink` to `packages/types/src/adapter.ts`**

`MessageMetadata` currently lives in `packages/core/src/adapters/base-session.ts` — it moves here because `SessionSink` needs it. Add these interfaces (read the existing `base-session.ts` to confirm the exact `MessageMetadata` shape, then add):

```typescript
export interface MessageMetadata {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface SessionResult {
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

export interface SessionSink {
  onInit(claudeSessionId: string): void;
  onMessage(content: MessageContent[], metadata?: MessageMetadata): void;
  onToolResult(content: MessageContent[]): void;
  onPermission(request: ControlRequest): void;
  onResult(data: SessionResult): void;
  onExit(code: number | null): void;
  onError(error: Error): void;
  onCompact(): void;
  onPlanFile(filePath: string): void;
  onSkillFile(entry: import('./context.js').SkillFileEntry): void;
}
```

`MessageContent` already exists in `packages/types/src/chat.ts` — use the same import pattern as other cross-references in adapter.ts (check how `ChatMessage` is referenced to follow the same pattern).

**Step 2: Update `AdapterSession` in `packages/types/src/adapter.ts`**

Remove these four lines from the `AdapterSession` interface:
```typescript
on(event: string, listener: (...args: any[]) => void): this;
off(event: string, listener: (...args: any[]) => void): this;
removeAllListeners(event?: string): this;
emit(event: string, ...args: any[]): boolean;
```

Change the `spawn` signature:
```typescript
// BEFORE
spawn(options?: SessionSpawnOptions): Promise<AdapterProcess>;

// AFTER
spawn(options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess>;
```

`sink` is optional so tests that don't need events can call `session.spawn(options)` without providing one.

**Step 3: Add `ChatEventName`, `ChatEvent`, tighten `PluginEventBus` in `packages/types/src/plugin.ts`**

Add these types (they were missing from the design doc implementation):

```typescript
export type ChatEventName =
  | 'message.added'
  | 'message.streaming'
  | 'tool.called'
  | 'tool.result';

export type ChatEvent =
  | { type: 'message.added'; chatId: string; message: ChatMessage }
  | { type: 'message.streaming'; chatId: string; messageId: string; delta: string }
  | { type: 'tool.called'; chatId: string; toolName: string; args: unknown }
  | { type: 'tool.result'; chatId: string; toolUseId: string; content: unknown };
```

Import `ChatMessage` from `'./chat.js'`. Then update `PluginEventBus.onChatEvent`:

```typescript
// BEFORE
onChatEvent(event: string, handler: (e: unknown) => void): void;

// AFTER
onChatEvent<E extends ChatEventName>(
  event: E,
  handler: (e: Extract<ChatEvent, { type: E }>) => void
): void;
```

**Step 4: Export new types from `packages/types/src/index.ts`**

Add to the exports:
- `MessageMetadata`, `SessionResult`, `SessionSink` (from adapter.ts)
- `ChatEventName`, `ChatEvent` (from plugin.ts)

**Step 5: Remove `"private": true` from `packages/types/package.json` if present**

```bash
grep '"private"' packages/types/package.json
```

If found, remove the line.

**Step 6: Verify build (expected failures are OK)**

```bash
pnpm --filter @mainframe/types build 2>&1 | tail -10
```

Expected: PASS for types package.

```bash
pnpm --filter @mainframe/core build 2>&1 | grep "error TS" | head -20
```

Expected: TypeScript errors in `ClaudeSession` (still extends BaseSession which has `on/off/emit`), `event-handler.ts` (calls `session.on()`), and test files (mock sessions extend BaseSession). These are fixed in subsequent tasks.

**Step 7: Commit**

```bash
git add packages/types/
git commit -m "$(cat <<'EOF'
feat: add SessionSink, ChatEventName/ChatEvent to types SDK; remove EventEmitter API from AdapterSession

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rewrite `ClaudeSession` and `events.ts` to use `SessionSink`

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts`
- Modify: `packages/core/src/plugins/builtin/claude/events.ts`

**Step 1: Read both files completely before touching anything**

```bash
# Understand the full structure before editing
wc -l packages/core/src/plugins/builtin/claude/session.ts
wc -l packages/core/src/plugins/builtin/claude/events.ts
```

**Step 2: Update `events.ts` — all event handler functions receive `sink` instead of `session`**

Read `events.ts` in full. Every function that currently takes `session: AdapterSession` (or similar) and calls `session.emit(...)` must be updated to take `sink: SessionSink` and call `sink.*()`.

Mapping of emit calls to sink calls:
| Old `session.emit(...)` | New `sink.*()` |
|---|---|
| `session.emit('error', error)` | `sink.onError(error)` |
| `session.emit('exit', code)` | `sink.onExit(code)` |
| `session.emit('init', claudeSessionId)` | `sink.onInit(claudeSessionId)` |
| `session.emit('compact')` | `sink.onCompact()` |
| `session.emit('message', content, metadata)` | `sink.onMessage(content, metadata)` |
| `session.emit('tool_result', content)` | `sink.onToolResult(content)` |
| `session.emit('plan_file', filePath)` | `sink.onPlanFile(filePath)` |
| `session.emit('skill_file', entry)` | `sink.onSkillFile(entry)` |
| `session.emit('permission', request)` | `sink.onPermission(request)` |
| `session.emit('result', data)` | `sink.onResult(data)` |

Update function signatures in events.ts:
```typescript
// BEFORE
export function handleStdout(line: string, session: AdapterSession): void

// AFTER
export function handleStdout(line: string, sink: SessionSink): void
```

Apply same pattern to `handleStderr`, `handleSystemEvent`, `handleAssistantEvent`, `handleUserEvent`, `handleControlRequestEvent` (was `handlePermissionRequestEvent`), `handleResultEvent`.

Import `SessionSink` from `'@mainframe/types'` instead of the old session type.

**Step 3: Rewrite `ClaudeSession` in `session.ts`**

`ClaudeSession` currently `extends BaseSession`. Change it to `extends EventEmitter implements AdapterSession`.

Key changes:
1. Remove `import { BaseSession } from '../../../adapters/base-session.js'`
2. Add `import { EventEmitter } from 'node:events'`
3. Change class declaration: `export class ClaudeSession extends EventEmitter implements AdapterSession`
4. Add all methods that `BaseSession` provided as no-ops directly on `ClaudeSession`:
   - `getContextFiles()` → `return { global: [], project: [] }` (unless overridden — check if ClaudeSession overrides it)
   - Any method previously inherited from BaseSession that ClaudeSession doesn't override needs to be added explicitly
5. Add `getToolCategories()` method (currently inherited from BaseSession) — bring it inline
6. Change `spawn()` signature:
   ```typescript
   async spawn(options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> {
   ```
7. Inside `spawn()`, pass `sink` to the event handlers instead of `this`:
   ```typescript
   child.stdout.on('data', (chunk: Buffer) => {
     for (const line of chunk.toString().split('\n')) {
       if (line.trim()) handleStdout(line, sink ?? nullSink);
     }
   });
   child.stderr.on('data', (chunk: Buffer) => {
     handleStderr(chunk.toString(), sink ?? nullSink);
   });
   child.on('error', (error: Error) => {
     sink?.onError(error);
   });
   child.on('close', (code: number | null) => {
     sink?.onExit(code);
   });
   ```
   Where `nullSink` is a local constant with no-op implementations (for when spawn is called without a sink, e.g. for history loading):
   ```typescript
   const nullSink: SessionSink = {
     onInit: () => {},
     onMessage: () => {},
     onToolResult: () => {},
     onPermission: () => {},
     onResult: () => {},
     onExit: () => {},
     onError: () => {},
     onCompact: () => {},
     onPlanFile: () => {},
     onSkillFile: () => {},
   };
   ```
8. Remove any `this.emit(...)` calls — all event emission now goes through `sink`
9. Import `SessionSink` from `'@mainframe/types'`

**Step 4: Build the plugin to verify**

```bash
pnpm --filter @mainframe/core build 2>&1 | grep "builtin/claude" | head -10
```

Expected: No errors in the claude plugin files. Remaining errors should be in `event-handler.ts` only (still calls `session.on()`).

**Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/
git commit -m "$(cat <<'EOF'
refactor: rewrite ClaudeSession and events.ts to use SessionSink instead of EventEmitter

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewrite `event-handler.ts` — `buildSink()` replaces `attachSession()`

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts`

**Step 1: Read the file completely**

The file has an `EventHandler` class with `attachSession(chatId, session)` and an inner function `attachClaudeSessionListeners(chatId, session, db, messages, permissions, getActiveChat, emitEvent)` that calls `session.on(event, ...)` for every event type.

**Step 2: Replace `attachSession()` with `buildSink()`**

The class keeps all the same constructor dependencies. The method changes from attaching listeners on a session to building and returning a `SessionSink`:

```typescript
import type { SessionSink } from '@mainframe/types';

// BEFORE
attachSession(chatId: string, session: AdapterSession): void {
  attachClaudeSessionListeners(chatId, session, ...);
}

// AFTER
buildSink(chatId: string): SessionSink {
  return buildSessionSink(
    chatId,
    this.db,
    this.messages,
    this.permissions,
    this.getActiveChat,
    this.emitEvent,
  );
}
```

**Step 3: Replace the inner function**

Rename `attachClaudeSessionListeners` → `buildSessionSink`. Change its return type from `void` to `SessionSink`. Instead of `session.on(event, handler)`, build and return an object:

```typescript
function buildSessionSink(
  chatId: string,
  db: DatabaseManager,
  messages: MessageCache,
  permissions: PermissionManager,
  getActiveChat: (chatId: string) => ActiveChat | undefined,
  emitEvent: (event: DaemonEvent) => void,
): SessionSink {
  return {
    onInit(claudeSessionId: string) {
      // move body of session.on('init', ...) here
    },
    onMessage(content, metadata) {
      // move body of session.on('message', ...) here
    },
    onToolResult(content) {
      // move body of session.on('tool_result', ...) here
    },
    onPermission(request) {
      // move body of session.on('permission', ...) here
    },
    onResult(data) {
      // move body of session.on('result', ...) here
    },
    onExit(code) {
      // move body of session.on('exit', ...) here
    },
    onError(error) {
      // move body of session.on('error', ...) here
    },
    onCompact() {
      // move body of session.on('compact', ...) here
    },
    onPlanFile(filePath) {
      // move body of session.on('plan_file', ...) here
    },
    onSkillFile(entry) {
      // move body of session.on('skill_file', ...) here
    },
  };
}
```

The handler bodies are identical to what's currently in the `session.on(...)` callbacks — just move them, don't rewrite them.

**Step 4: Remove the `session: AdapterSession` import if it becomes unused**

After this change, `event-handler.ts` no longer needs `AdapterSession` (it doesn't receive sessions anymore, just builds sinks). Remove unused imports.

**Step 5: Build to verify**

```bash
pnpm --filter @mainframe/core build 2>&1 | grep "error TS" | head -20
```

Expected: Errors only in `lifecycle-manager.ts` (calls `eventHandler.attachSession()` which no longer exists). All other source files should be clean.

**Step 6: Commit**

```bash
git add packages/core/src/chat/event-handler.ts
git commit -m "$(cat <<'EOF'
refactor: replace EventHandler.attachSession() with buildSink() returning SessionSink

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `lifecycle-manager.ts` — wire sink through spawn

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts`

**Step 1: Read the file — find both `createSession` + `spawn` call sites**

There are two places that call `createSession()` and one that calls `spawn()`:
- `doLoadChat()` at ~line 216: creates session, calls `attachSession(chatId, session)` immediately after
- `doStartChat()` at ~line 272: creates session, calls `attachSession(chatId, session)`, then `session.spawn()`

**Step 2: Update `doLoadChat()`**

If `doLoadChat` calls `attachSession` on a session that won't be spawned (resume path), check whether it still needs a sink. The resume path may call `session.spawn()` later — if so, the sink should be built and stored on the session. Read the code carefully.

If `doLoadChat` calls `attachSession` just to prepare listeners before a spawn, change to:
```typescript
// BEFORE
const session = adapter.createSession({ ... });
this.eventHandler.attachSession(chatId, session);

// AFTER
const session = adapter.createSession({ ... });
// sink is passed at spawn time — see doStartChat / resume path
```

The `doLoadChat` path sets up a session for resume. The spawn happens later when the chat is actually started. The sink gets built and passed at that point.

**Step 3: Update `doStartChat()`**

```typescript
// BEFORE
const session = adapter.createSession({ ... });
this.eventHandler.attachSession(chatId, session);
const processInfo = await session.spawn({ model, permissionMode });

// AFTER
const session = adapter.createSession({ ... });
const sink = this.eventHandler.buildSink(chatId);
const processInfo = await session.spawn({ model, permissionMode }, sink);
```

**Step 4: Remove all remaining `attachSession` calls**

```bash
grep -n "attachSession" packages/core/src/chat/lifecycle-manager.ts
```

Expected: zero matches after your edits.

**Step 5: Build to verify source files are clean**

```bash
pnpm --filter @mainframe/core build 2>&1 | grep "error TS"
```

Expected: Zero errors in source files. Only test file errors remain (they still import BaseAdapter/BaseSession and call session.emit()).

**Step 6: Commit**

```bash
git add packages/core/src/chat/lifecycle-manager.ts
git commit -m "$(cat <<'EOF'
refactor: wire SessionSink through lifecycle-manager spawn call

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Delete `BaseAdapter` / `BaseSession`, create test helpers, update `ClaudeAdapter`

**Files:**
- Delete: `packages/core/src/adapters/base.ts`
- Delete: `packages/core/src/adapters/base-session.ts`
- Modify: `packages/core/src/adapters/index.ts`
- Modify: `packages/core/src/plugins/builtin/claude/adapter.ts`
- Create: `packages/core/src/__tests__/helpers/mock-adapter.ts`
- Create: `packages/core/src/__tests__/helpers/mock-session.ts`

**Step 1: Update `ClaudeAdapter` to `implements Adapter` directly**

Read `packages/core/src/plugins/builtin/claude/adapter.ts`. Change:
```typescript
// BEFORE
import { BaseAdapter } from '../../../adapters/base.js';
export class ClaudeAdapter extends BaseAdapter { ... }

// AFTER
import type { Adapter, AdapterSession, AdapterModel, SessionOptions } from '@mainframe/types';
export class ClaudeAdapter implements Adapter { ... }
```

Add all methods that `BaseAdapter` provided as defaults and `ClaudeAdapter` didn't override. Check which methods were inherited vs overridden:
- `listModels()` → if not overridden, add: `async listModels(): Promise<AdapterModel[]> { return []; }`
- `killAll()` → if not overridden, add: `killAll(): void {}`
- `getToolCategories()` → this was on `BaseAdapter` but NOT on the `Adapter` interface — move it directly to `ClaudeAdapter` as a concrete method (it's fine to keep it there; the core that calls it knows it's working with a `ClaudeAdapter`)
- All skill/agent methods → copy the implementations from `ClaudeAdapter` (it already overrides them); if any were inherited from `BaseAdapter` as throws, add them explicitly

**Step 2: Remove re-exports from `packages/core/src/adapters/index.ts`**

Remove:
```typescript
export { BaseAdapter } from './base.js';
export { BaseSession } from './base-session.js';
```

Also remove `MessageMetadata` re-export if it was there (it's now in `@mainframe/types`).

**Step 3: Delete the base files**

```bash
rm packages/core/src/adapters/base.ts
rm packages/core/src/adapters/base-session.ts
```

**Step 4: Create `packages/core/src/__tests__/helpers/mock-adapter.ts`**

```typescript
import type { Adapter, AdapterSession, AdapterModel, SessionOptions } from '@mainframe/types';

export class MockBaseAdapter implements Adapter {
  id = 'mock';
  name = 'Mock Adapter';

  private readonly sessionFactory?: (options: SessionOptions) => AdapterSession;

  constructor(sessionFactory?: (options: SessionOptions) => AdapterSession) {
    this.sessionFactory = sessionFactory;
  }

  async isInstalled(): Promise<boolean> { return true; }
  async getVersion(): Promise<string | null> { return '1.0.0'; }
  async listModels(): Promise<AdapterModel[]> { return []; }
  killAll(): void {}

  createSession(options: SessionOptions): AdapterSession {
    return this.sessionFactory?.(options) ?? new MockBaseSession();
  }
}

// Avoid circular import — MockBaseSession is also exported here for convenience
export { MockBaseSession } from './mock-session.js';
```

**Step 5: Create `packages/core/src/__tests__/helpers/mock-session.ts`**

```typescript
import type {
  AdapterSession,
  AdapterProcess,
  SessionSpawnOptions,
  SessionSink,
  ControlResponse,
  SkillFileEntry,
  ContextFile,
  ChatMessage,
} from '@mainframe/types';

export class MockBaseSession implements AdapterSession {
  readonly id: string;
  readonly adapterId: string;
  readonly projectPath: string;
  protected sink: SessionSink | undefined;
  private spawned = false;

  constructor(
    id = 'mock-session',
    adapterId = 'mock',
    projectPath = '/mock/project',
  ) {
    this.id = id;
    this.adapterId = adapterId;
    this.projectPath = projectPath;
  }

  get isSpawned(): boolean { return this.spawned; }

  async spawn(_options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> {
    this.spawned = true;
    this.sink = sink;
    return { pid: 1234 };
  }

  async kill(): Promise<void> { this.spawned = false; }
  getProcessInfo(): AdapterProcess | null { return this.spawned ? { pid: 1234 } : null; }

  async sendMessage(): Promise<void> {}
  async respondToPermission(_response: ControlResponse): Promise<void> {}
  async interrupt(): Promise<void> {}
  async setModel(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  async sendCommand(): Promise<void> {}

  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    return { global: [], project: [] };
  }
  async loadHistory(): Promise<ChatMessage[]> { return []; }
  async extractPlanFiles(): Promise<string[]> { return []; }
  async extractSkillFiles(): Promise<SkillFileEntry[]> { return []; }

  // ── Test simulation helpers ───────────────────────────────────────────────
  // Call these in tests to simulate events the CLI would have emitted

  simulateInit(claudeSessionId: string): void { this.sink?.onInit(claudeSessionId); }
  simulateMessage(content: unknown[], metadata?: unknown): void {
    this.sink?.onMessage(content as never, metadata as never);
  }
  simulateToolResult(content: unknown[]): void {
    this.sink?.onToolResult(content as never);
  }
  simulatePermission(request: unknown): void {
    this.sink?.onPermission(request as never);
  }
  simulateResult(data: unknown): void { this.sink?.onResult(data as never); }
  simulateExit(code: number | null): void { this.sink?.onExit(code); }
  simulateError(error: Error): void { this.sink?.onError(error); }
  simulateCompact(): void { this.sink?.onCompact(); }
  simulatePlanFile(filePath: string): void { this.sink?.onPlanFile(filePath); }
  simulateSkillFile(entry: SkillFileEntry): void { this.sink?.onSkillFile(entry); }
}
```

**Step 6: Verify source build is still clean**

```bash
pnpm --filter @mainframe/core build 2>&1 | grep "error TS"
```

Expected: Only test file errors (they still import from deleted base files).

**Step 7: Commit**

```bash
git add packages/core/src/adapters/ packages/core/src/plugins/builtin/claude/adapter.ts packages/core/src/__tests__/helpers/
git commit -m "$(cat <<'EOF'
refactor: delete BaseAdapter/BaseSession, add MockBaseAdapter/MockBaseSession test helpers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update all test files — use helpers and sink-based simulation

**Files (9 test files):**
- Modify: `packages/core/src/__tests__/adapter-events-flow.test.ts`
- Modify: `packages/core/src/__tests__/ws-inbound-flow.test.ts`
- Modify: `packages/core/src/__tests__/send-message-flow.test.ts`
- Modify: `packages/core/src/__tests__/daemon-restart-messages.test.ts`
- Modify: `packages/core/src/__tests__/title-generation.test.ts`
- Modify: `packages/core/src/__tests__/file-edit-flow.test.ts`
- Modify: `packages/core/src/__tests__/permission-flow.test.ts`
- Modify: `packages/core/src/__tests__/restore-permission.test.ts`
- Modify: `packages/core/src/__tests__/control-requests.test.ts`

**For each test file, do the following:**

**Step 1: Replace `BaseAdapter` / `BaseSession` imports**

```typescript
// BEFORE
import { BaseAdapter } from '../adapters/base.js';
import { BaseSession } from '../adapters/base-session.js';

// AFTER
import { MockBaseAdapter, MockBaseSession } from './helpers/mock-adapter.js';
```

**Step 2: Replace `class MockAdapter extends BaseAdapter` with `class TestAdapter extends MockBaseAdapter`**

If the test class only overrides `createSession()`, simplify it completely:

```typescript
// BEFORE
class MockAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Claude CLI';
  async isInstalled() { return true; }
  async getVersion() { return '1.0.0'; }
  createSession(options: SessionOptions): AdapterSession {
    return new MockSession(options.chatId ?? '');
  }
}

// AFTER
// Just use MockBaseAdapter directly with a factory:
const mockSession = new MockBaseSession('test-session', 'claude', projectPath);
const adapter = new MockBaseAdapter(() => mockSession);
```

If the test class overrides more (e.g. `listModels`, skills), extend `MockBaseAdapter`:

```typescript
class TestAdapter extends MockBaseAdapter {
  override async listModels() { return [{ id: 'claude-3', name: 'Claude 3' }]; }
}
```

**Step 3: Replace `class MockSession extends BaseSession` with `class TestSession extends MockBaseSession`**

If the test class only implements the abstract methods, replace with `MockBaseSession` directly:

```typescript
// BEFORE
class MockSession extends BaseSession {
  readonly id = 'session-1';
  readonly adapterId = 'claude';
  readonly projectPath = '/project';
  get isSpawned() { return true; }
  async spawn() { return { pid: 1 }; }
  async kill() {}
  getProcessInfo() { return { pid: 1 }; }
  async respondToPermission(r: PermissionResponse) { /* ... */ }
}

// AFTER
const mockSession = new MockBaseSession('session-1', 'claude', '/project');
// Override respondToPermission if the test inspects it:
mockSession.respondToPermission = vi.fn();
```

If the mock needs to capture calls (vi.fn()), assign them after construction.

**Step 4: Replace `session.emit(event, ...)` with `session.simulate*(...)` calls**

```typescript
// BEFORE
session.emit('message', [{ type: 'text', text: 'Hello' }], { model: 'claude-3' });
session.emit('permission', { requestId: '1', toolName: 'bash' });
session.emit('result', { subtype: 'success', total_cost_usd: 0.001 });

// AFTER
session.simulateMessage([{ type: 'text', text: 'Hello' }], { model: 'claude-3' });
session.simulatePermission({ requestId: '1', toolName: 'bash' });
session.simulateResult({ subtype: 'success', total_cost_usd: 0.001 });
```

**Step 5: IMPORTANT — in tests that manually call `session.spawn()`**

If a test calls `session.spawn()` explicitly (not via `ChatManager`), the sink won't be set automatically. In that case, build a minimal test sink and pass it:

```typescript
const receivedMessages: unknown[] = [];
const testSink: SessionSink = {
  onInit: () => {},
  onMessage: (content, metadata) => { receivedMessages.push({ content, metadata }); },
  onToolResult: () => {},
  onPermission: () => {},
  onResult: () => {},
  onExit: () => {},
  onError: () => {},
  onCompact: () => {},
  onPlanFile: () => {},
  onSkillFile: () => {},
};
await session.spawn({}, testSink);
```

**Step 6: Run each test file individually as you go**

```bash
pnpm --filter @mainframe/core exec vitest run src/__tests__/adapter-events-flow.test.ts 2>&1 | tail -15
```

Fix any failures before moving to the next file.

**Step 7: Run all core tests**

```bash
pnpm --filter @mainframe/core test 2>&1 | tail -20
```

Expected: 477/480 (same pre-existing failures only).

**Step 8: Commit**

```bash
git add packages/core/src/__tests__/
git commit -m "$(cat <<'EOF'
refactor: update all test files to use MockBaseAdapter/MockBaseSession helpers and SessionSink simulation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full build + full test run + verify SDK exports

**Step 1: Full monorepo build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: PASS — zero errors across all packages.

**Step 2: Full core test run**

```bash
pnpm --filter @mainframe/core test 2>&1 | tail -20
```

Expected: 477/480 (pre-existing title-generation failures only).

**Step 3: Verify SDK surface**

```bash
# Verify PermissionRequest is truly gone
grep -r "PermissionRequest\|PermissionResponse\|PermissionBehavior\|PermissionUpdate\|PermissionDestination" \
  packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v ".md"
```

Expected: zero matches.

```bash
# Verify SessionSink is exported from types
grep "SessionSink" packages/types/dist/index.d.ts
```

Expected: shows the exported interface.

```bash
# Verify no BaseAdapter/BaseSession in production code
grep -r "BaseAdapter\|BaseSession" packages/core/src/ --include="*.ts" \
  | grep -v "__tests__"
```

Expected: zero matches (only test helpers should reference them).

**Step 4: Commit (if any cleanup was needed in steps 1-3)**

If everything was clean from previous commits, no new commit needed. Otherwise:

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: final cleanup — verify SDK exports and remove any remaining Permission* references

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
