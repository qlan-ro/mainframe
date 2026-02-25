# Refactor: Adapter + AdapterSession Split

## Context

`ClaudeAdapter` has 5 responsibilities in one class: discovery, process registry, process I/O, configuration, and skills/agents CRUD. Every I/O method takes an `AdapterProcess` just to look up the real `ClaudeProcess` from a private Map. The `event-handler.ts` receives events keyed by `processId`, then reverse-looks up the chatId via a `processToChat` Map. There are `instanceof ClaudeAdapter` casts leaking Claude-specific details into the chat layer.

**Goal:** Split into `Adapter` (provider-level) + `AdapterSession` (session-level) to improve SRP, multi-adapter readiness, and testability.

---

## Design

### `Adapter` — Provider-level, project-scoped

```typescript
interface Adapter {
  id: string;
  name: string;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  createSession(options: SessionOptions): AdapterSession;
  killAll(): void;
  // Skills/agents CRUD (project-scoped, used by HTTP routes)
  listSkills?(projectPath: string): Promise<Skill[]>;
  createSkill?(...): Promise<Skill>;
  updateSkill?(...): Promise<Skill>;
  deleteSkill?(...): Promise<void>;
  listAgents?(...): Promise<AgentConfig[]>;
  createAgent?(...): Promise<AgentConfig>;
  updateAgent?(...): Promise<AgentConfig>;
  deleteAgent?(...): Promise<void>;
}

interface SessionOptions {
  projectPath: string;
  chatId?: string; // Claude session ID for resume
}
```

### `AdapterSession` — Session-level, extends EventEmitter

A session can exist **without being spawned**. You create it, load history from it, then optionally spawn.

```typescript
interface AdapterSession extends EventEmitter {
  readonly id: string;
  readonly adapterId: string;
  readonly projectPath: string;

  // Lifecycle
  spawn(options?: SpawnOptions): Promise<AdapterProcess>;
  kill(): Promise<void>;
  readonly isSpawned: boolean;
  getProcessInfo(): AdapterProcess | null;

  // I/O (throws if not spawned)
  sendMessage(message: string, images?: ...): Promise<void>;
  respondToPermission(response: PermissionResponse): Promise<void>;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  sendCommand(command: string, args?: string): Promise<void>;

  // Session data (works WITHOUT spawn)
  getContextFiles(): { global: ContextFile[]; project: ContextFile[] };
  loadHistory(sessionId: string): Promise<ChatMessage[]>;
  extractPlanFilePaths(sessionId: string): Promise<string[]>;
  extractSkillFilePaths(sessionId: string): Promise<SkillFileEntry[]>;
}

// Session events — no processId prefix, session IS the context
interface SessionEvents {
  init: (claudeSessionId: string, model: string, tools: string[]) => void;
  message: (content: MessageContent[], metadata?: MessageMetadata) => void;
  tool_result: (content: MessageContent[]) => void;
  permission: (request: PermissionRequest) => void;
  result: (data: { cost; tokensInput; tokensOutput; subtype?; isError?; durationMs? }) => void;
  plan_file: (filePath: string) => void;
  skill_file: (filePath: string) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

// SpawnOptions simplified — projectPath and chatId are on session
interface SpawnOptions {
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo';
}
```

### Key Eliminations

- **`processToChat` Map** — gone. Session ↔ chat mapping is direct via `ActiveChat.session`.
- **`ChatLookup` interface** — gone. `getChatIdForProcess()` and `deleteProcessMapping()` unnecessary.
- **`instanceof ClaudeAdapter`** — gone. Session exposes `extractPlanFilePaths()` / `extractSkillFilePaths()` generically.
- **`ClaudeProcess` type** — gone. Fields merge into `ClaudeSession` class.

---

## Implementation Phases

### Phase 1: Type Definitions
**`packages/types/src/adapter.ts`**
- Add `AdapterSession`, `SessionOptions`, `SessionSpawnOptions`, `SessionEvents` interfaces
- Add `createSession()` and `killAll()` to `Adapter` interface
- Keep old methods temporarily as optional (deprecated) for compilation during migration
- Export new types from `packages/types/src/index.ts`

### Phase 2: Adapter Layer
**NEW: `packages/core/src/adapters/base-session.ts`** (~80 lines)
- `BaseSession extends EventEmitter implements AdapterSession`
- Typed `emit()`/`on()` using `SessionEvents`
- Default no-op implementations for data methods

**NEW: `packages/core/src/adapters/claude-session.ts`** (~200 lines)
- Extracts from `ClaudeAdapter`: process spawn, I/O methods, buffer, event emission
- Owns `child: ChildProcess | null`, `buffer`, `lastAssistantUsage`
- `getContextFiles()` reads CLAUDE.md/AGENTS.md using `this.projectPath`
- `loadHistory()` / `extractPlanFilePaths()` / `extractSkillFilePaths()` delegate to `claude-history.ts`

**MODIFY: `packages/core/src/adapters/claude-events.ts`**
- `handleStdout(processId, chunk, processes, adapter)` → `handleStdout(session: ClaudeSession, chunk: Buffer)`
- `handleStderr(processId, chunk, adapter)` → `handleStderr(session: ClaudeSession, chunk: Buffer)`
- All internal handlers: `session.emit('message', content, metadata)` instead of `emitter.emit('message', processId, content, metadata)`

**MODIFY: `packages/core/src/adapters/base.ts`**
- Remove `EventEmitter` extension. `BaseAdapter` no longer emits events.
- Remove process I/O abstract methods. Keep: `id`, `name`, `isInstalled()`, `getVersion()`, `createSession()`, `killAll()`, skills/agents CRUD defaults.

**MODIFY: `packages/core/src/adapters/claude.ts`** (slim down to ~80 lines)
- Remove `processes` Map, all I/O methods, `spawn()`, `kill()`
- Keep: `isInstalled()`, `getVersion()`, `createSession()`, `killAll()`, skills/agents CRUD delegation
- `createSession()` creates `ClaudeSession`, adds to `sessions` Set, returns it
- `killAll()` iterates sessions

**DELETE: `packages/core/src/adapters/claude-types.ts`**
- `ClaudeProcess` merged into `ClaudeSession`

**MODIFY: `packages/core/src/adapters/index.ts`**
- Add `killAll()` to `AdapterRegistry` (iterates all adapters)
- Export `BaseSession`, `ClaudeSession`

### Phase 3: Chat Layer Types
**`packages/core/src/chat/types.ts`**
- `ActiveChat { chat, session: AdapterSession | null }` (replaces `process: AdapterProcess | null`)

### Phase 4: Consumer Migration (biggest phase)

**REWRITE: `packages/core/src/chat/event-handler.ts`**
- Remove `ChatLookup` interface
- Replace `setup()` with `attachSession(chatId: string, session: AdapterSession): void`
- Subscribe to session events with chatId in closure — no processId lookup
- `session.on('permission', ...)` auto-allows in yolo mode via `session.respondToPermission()`
- `session.on('exit', ...)` sets `active.session = null` (no processToChat cleanup)

**MODIFY: `packages/core/src/chat/lifecycle-manager.ts`**
- Remove `processToChat` from deps
- Remove `ClaudeAdapter` import (no more `instanceof` cast)
- `doLoadChat()`: create session via `adapter.createSession(...)`, call session methods for history/plans/skills
- `doStartChat()`: call `eventHandler.attachSession()` then `session.spawn()`
- `interruptChat()`: `session.interrupt()` directly
- `archiveChat()`/`endChat()`: `session.kill()` directly

**MODIFY: `packages/core/src/chat/chat-manager.ts`**
- Remove `processToChat` Map
- Remove `ChatLookup` methods (`getChatIdForProcess`, `deleteProcessMapping`)
- `sendMessage()`: `active.session.sendMessage(...)` instead of `adapter.sendMessage(active.process, ...)`
- `isChatRunning()`: `active.session?.isSpawned === true`
- EventHandler constructed differently (no ChatLookup)

**MODIFY: `packages/core/src/chat/permission-handler.ts`**
- Remove `processToChat` from deps
- `session.respondToPermission(response)` instead of `adapter.respondToPermission(process, response)`

**MODIFY: `packages/core/src/chat/config-manager.ts`**
- Remove `processToChat` from deps
- `session.setModel(model)` / `session.setPermissionMode(mode)` / `session.kill()`

**MODIFY: `packages/core/src/chat/plan-mode-handler.ts`**
- `session.respondToPermission(...)` / `session.kill()` / `session.setPermissionMode(...)`

### Phase 5: Entry Point
**`packages/core/src/index.ts`**
- `adapters.killAll()` instead of `(adapters.get('claude') as ClaudeAdapter)?.killAll()`
- Remove `ClaudeAdapter` import

### Phase 6: Context Tracker
**`packages/core/src/chat/context-tracker.ts`**
- `getSessionContext()` currently takes `adapters: AdapterRegistry` and calls `adapter.getContextFiles(projectPath)`. Change to accept the session or use adapter (since skills HTTP routes still use adapter).

### Phase 7: Tests
- `__tests__/claude-events.test.ts` — mock `ClaudeSession` instead of `ClaudeProcess` + adapter emitter
- `__tests__/event-handler.test.ts` — use `attachSession()` instead of `setup()`, emit on session
- `__tests__/control-requests.test.ts` — call methods on `ClaudeSession` directly
- `__tests__/chat-manager-is-running.test.ts` — check `session.isSpawned` instead of `process`
- `__tests__/set-model-integration.test.ts` — inject mock child into session

### Phase 8: Cleanup
- Remove deprecated methods from `Adapter` interface
- Remove old `AdapterEvents` interface from `base.ts`
- Remove `MessageMetadata` export from `base.ts` (move to `base-session.ts`)

---

## Critical Ordering Constraints

1. `attachSession()` must be called BEFORE `session.spawn()` so `init` event isn't missed
2. On process exit, session stays on `ActiveChat` (not null'd) but `isSpawned` becomes false — allows re-spawn
3. When creating a NEW session for a re-started chat, call `session.removeAllListeners()` on the old one to prevent leaks
4. `DaemonEvent` types (`process.started`, `process.ready`, `process.stopped`) keep using `processId` / `AdapterProcess` DTO — desktop is unaffected

---

## Files Summary

| Action | File |
|--------|------|
| MODIFY | `packages/types/src/adapter.ts` |
| NEW | `packages/core/src/adapters/base-session.ts` |
| NEW | `packages/core/src/adapters/claude-session.ts` |
| MODIFY | `packages/core/src/adapters/claude-events.ts` |
| MODIFY | `packages/core/src/adapters/base.ts` |
| MODIFY | `packages/core/src/adapters/claude.ts` |
| DELETE | `packages/core/src/adapters/claude-types.ts` |
| MODIFY | `packages/core/src/adapters/index.ts` |
| MODIFY | `packages/core/src/chat/types.ts` |
| REWRITE | `packages/core/src/chat/event-handler.ts` |
| MODIFY | `packages/core/src/chat/lifecycle-manager.ts` |
| MODIFY | `packages/core/src/chat/chat-manager.ts` |
| MODIFY | `packages/core/src/chat/permission-handler.ts` |
| MODIFY | `packages/core/src/chat/config-manager.ts` |
| MODIFY | `packages/core/src/chat/plan-mode-handler.ts` |
| MODIFY | `packages/core/src/index.ts` |
| MODIFY | `packages/core/src/chat/context-tracker.ts` |
| MODIFY | `packages/core/src/__tests__/claude-events.test.ts` |
| MODIFY | `packages/core/src/__tests__/event-handler.test.ts` |
| MODIFY | `packages/core/src/__tests__/control-requests.test.ts` |
| MODIFY | `packages/core/src/__tests__/chat-manager-is-running.test.ts` |
| MODIFY | `packages/core/src/__tests__/set-model-integration.test.ts` |

---

## Verification

1. `pnpm --filter @mainframe/types build` — types compile
2. `pnpm --filter @mainframe/core build` — core compiles
3. `pnpm --filter @mainframe/core test` — all tests pass
4. `pnpm build` — full monorepo builds
5. Manual: start daemon, create a chat, send a message, verify events flow correctly
6. Manual: resume a chat (tests session re-creation + history loading without spawn)
7. Manual: permission flow (verify permission request → response works through session)
