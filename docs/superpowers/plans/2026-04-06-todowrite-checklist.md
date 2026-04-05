# TodoWrite Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display Claude's TodoWrite task checklist in the Context tab, giving users real-time visibility into what the agent is working on.

**Architecture:** Extract todo state from TodoWrite tool_use events in the Claude adapter, persist to SQLite, emit a dedicated `todos.updated` daemon event, and render a read-only checklist with progress bar in the Context tab's right panel.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React, Zustand, Tailwind CSS, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/types/src/chat.ts` | Modify | Add `TodoItem` interface, add `todos?` field to `Chat` |
| `packages/types/src/adapter.ts` | Modify | Add `onTodoUpdate` to `SessionSink` |
| `packages/types/src/events.ts` | Modify | Add `todos.updated` to `DaemonEvent` union |
| `packages/core/src/db/schema.ts` | Modify | Add `todos TEXT` migration |
| `packages/core/src/db/chats.ts` | Modify | Add `updateTodos()`, `getTodos()` methods, include `todos` in queries |
| `packages/core/src/plugins/builtin/claude/events.ts` | Modify | Extract todos from TodoWrite tool_use in `handleAssistantEvent` |
| `packages/core/src/chat/event-handler.ts` | Modify | Implement `onTodoUpdate` sink handler |
| `packages/core/src/chat/lifecycle-manager.ts` | Modify | Emit `todos.updated` on chat resume |
| `packages/desktop/src/renderer/store/chats.ts` | Modify | Add `todos` Map + `setTodos` action |
| `packages/desktop/src/renderer/lib/ws-event-router.ts` | Modify | Route `todos.updated` event |
| `packages/desktop/src/renderer/components/panels/TasksSection.tsx` | Create | Todo checklist UI component |
| `packages/desktop/src/renderer/components/panels/ContextTab.tsx` | Modify | Render `TasksSection` |
| `packages/core/src/db/__tests__/chats.test.ts` | Modify | Tests for `updateTodos`/`getTodos` |
| `packages/core/src/plugins/builtin/claude/__tests__/events.test.ts` | Create or modify | Tests for TodoWrite extraction |

---

### Task 1: Add TodoItem Type and Chat Field

**Files:**
- Modify: `packages/types/src/chat.ts:1-27`

- [ ] **Step 1: Add TodoItem interface and todos field to Chat**

In `packages/types/src/chat.ts`, add the `TodoItem` interface after the imports (before the `Chat` interface), and add `todos?` to `Chat`:

```typescript
// Add after the import line (line 1), before the Chat interface:

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}
```

Then add to the `Chat` interface, after the `worktreeMissing?` field (line 26):

```typescript
  todos?: TodoItem[];
```

- [ ] **Step 2: Build types package to verify**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/chat.ts
git commit -m "feat(types): add TodoItem interface and todos field to Chat"
```

---

### Task 2: Add onTodoUpdate to SessionSink and todos.updated to DaemonEvent

**Files:**
- Modify: `packages/types/src/adapter.ts:102-116`
- Modify: `packages/types/src/events.ts:7-62`

- [ ] **Step 1: Add onTodoUpdate to SessionSink**

In `packages/types/src/adapter.ts`, add to the `SessionSink` interface after `onQueuedProcessed` (line 115):

```typescript
  onTodoUpdate(todos: import('./chat.js').TodoItem[]): void;
```

- [ ] **Step 2: Add todos.updated to DaemonEvent**

In `packages/types/src/events.ts`, add to the `DaemonEvent` union. Add the import for `TodoItem` at the top and add a new variant after the `adapter.models.updated` line (line 62):

```typescript
  | { type: 'todos.updated'; chatId: string; todos: import('./chat.js').TodoItem[] }
```

- [ ] **Step 3: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/adapter.ts packages/types/src/events.ts
git commit -m "feat(types): add onTodoUpdate sink method and todos.updated event"
```

---

### Task 3: Add DB Schema Migration and Repository Methods

**Files:**
- Modify: `packages/core/src/db/schema.ts:85-88`
- Modify: `packages/core/src/db/chats.ts`
- Test: `packages/core/src/db/__tests__/chats.test.ts`

- [ ] **Step 1: Write failing tests for updateTodos and getTodos**

In `packages/core/src/db/__tests__/chats.test.ts`, add a new `describe` block after the existing `listAll` describe:

```typescript
  describe('todos', () => {
    it('returns null when no todos have been set', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      expect(chats.getTodos(chat.id)).toBeNull();
    });

    it('stores and retrieves todos', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      const todos = [
        { content: 'Write tests', status: 'completed' as const, activeForm: 'Writing tests' },
        { content: 'Implement feature', status: 'in_progress' as const, activeForm: 'Implementing feature' },
        { content: 'Review code', status: 'pending' as const, activeForm: 'Reviewing code' },
      ];
      chats.updateTodos(chat.id, todos);
      expect(chats.getTodos(chat.id)).toEqual(todos);
    });

    it('replaces todos on subsequent calls', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      chats.updateTodos(chat.id, [
        { content: 'Old task', status: 'pending' as const, activeForm: 'Old task' },
      ]);
      const newTodos = [
        { content: 'New task', status: 'in_progress' as const, activeForm: 'New task' },
      ];
      chats.updateTodos(chat.id, newTodos);
      expect(chats.getTodos(chat.id)).toEqual(newTodos);
    });

    it('includes todos in get() result', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      const todos = [
        { content: 'Task 1', status: 'pending' as const, activeForm: 'Task 1' },
      ];
      chats.updateTodos(chat.id, todos);
      const loaded = chats.get(chat.id);
      expect(loaded?.todos).toEqual(todos);
    });

    it('includes todos in list() results', () => {
      const p = projects.create('/project/todos');
      const chat = chats.create(p.id, 'claude');
      const todos = [
        { content: 'Task 1', status: 'completed' as const, activeForm: 'Task 1' },
      ];
      chats.updateTodos(chat.id, todos);
      const all = chats.list(p.id);
      expect(all[0]?.todos).toEqual(todos);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/db/__tests__/chats.test.ts`
Expected: FAIL — `chats.getTodos` is not a function.

- [ ] **Step 3: Add schema migration**

In `packages/core/src/db/schema.ts`, add after the `last_context_tokens_input` migration (after line 87):

```typescript
  if (!cols.some((c) => c.name === 'todos')) {
    db.exec('ALTER TABLE chats ADD COLUMN todos TEXT');
  }
```

- [ ] **Step 4: Add getTodos and updateTodos methods**

In `packages/core/src/db/chats.ts`, add two methods after `addSkillFile` (after line 209):

```typescript
  getTodos(chatId: string): import('@qlan-ro/mainframe-types').TodoItem[] | null {
    const stmt = this.db.prepare('SELECT todos FROM chats WHERE id = ?');
    const row = stmt.get(chatId) as { todos: string | null } | undefined;
    if (!row?.todos) return null;
    return parseJsonColumn<import('@qlan-ro/mainframe-types').TodoItem[]>(row.todos, []);
  }

  updateTodos(chatId: string, todos: import('@qlan-ro/mainframe-types').TodoItem[]): void {
    this.db.prepare('UPDATE chats SET todos = ? WHERE id = ?').run(JSON.stringify(todos), chatId);
  }
```

- [ ] **Step 5: Add todos to SELECT queries and row mapping**

The `get()`, `list()`, `listAll()`, and `findByExternalSessionId()` methods all have SELECT statements that need the `todos` column. For each method:

Add `todos` to the SELECT column list (no alias needed — column and field match).

Then in the row mapping (the `return { ...row, ... }` block), add:

```typescript
      todos: parseJsonColumn(row.todos, undefined) ?? undefined,
```

The `row` type cast on each method also needs `todos: string` added. For example in `get()` at line 85:

```typescript
    const row = stmt.get(id) as (Chat & { mentions: string; modifiedFiles: string; todos: string }) | null;
```

Apply the same pattern to `list()` (line 33), `listAll()` (line 60), and `findByExternalSessionId()` (line 235).

- [ ] **Step 6: Add TodoItem to the import**

In `packages/core/src/db/chats.ts` line 2, add `TodoItem` to the import:

```typescript
import type { Chat, SessionMention, SkillFileEntry, TodoItem } from '@qlan-ro/mainframe-types';
```

Then update the method signatures to use the imported type:

```typescript
  getTodos(chatId: string): TodoItem[] | null {
```

```typescript
  updateTodos(chatId: string, todos: TodoItem[]): void {
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/db/__tests__/chats.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/chats.ts packages/core/src/db/__tests__/chats.test.ts
git commit -m "feat(db): add todos column and repository methods"
```

---

### Task 4: Extract Todos from TodoWrite Tool Use in Claude Adapter

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/events.ts:69-89`

- [ ] **Step 1: Write failing test for TodoWrite extraction**

Find or create the test file for claude events. Check if `packages/core/src/plugins/builtin/claude/__tests__/events.test.ts` exists. If not, create it:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { handleStdout } from '../events.js';
import type { ClaudeSession } from '../session.js';

function createMockSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
  };
}

function createMockSession(overrides?: Partial<ClaudeSession>): ClaudeSession {
  return {
    id: 'test-session',
    state: {
      buffer: '',
      chatId: null,
      status: 'ready',
      lastAssistantUsage: undefined,
      activeTasks: new Map(),
      pendingCancelCallbacks: new Map(),
    },
    clearInterruptTimer: vi.fn(),
    requestContextUsage: vi.fn(),
    ...overrides,
  } as unknown as ClaudeSession;
}

describe('handleStdout', () => {
  describe('TodoWrite extraction', () => {
    it('calls sink.onTodoUpdate when assistant event contains TodoWrite tool_use', () => {
      const sink = createMockSink();
      const session = createMockSession();

      const todos = [
        { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
        { content: 'Implement feature', status: 'pending', activeForm: 'Implementing feature' },
      ];

      const event = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'TodoWrite', input: { todos } },
          ],
        },
      };

      handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

      expect(sink.onTodoUpdate).toHaveBeenCalledWith(todos);
      expect(sink.onMessage).toHaveBeenCalled();
    });

    it('does not call onTodoUpdate for non-TodoWrite tool_use', () => {
      const sink = createMockSink();
      const session = createMockSession();

      const event = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/foo.ts' } },
          ],
        },
      };

      handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

      expect(sink.onTodoUpdate).not.toHaveBeenCalled();
      expect(sink.onMessage).toHaveBeenCalled();
    });

    it('extracts todos even when mixed with other tool_use blocks', () => {
      const sink = createMockSink();
      const session = createMockSession();

      const todos = [
        { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
      ];

      const event = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Working on it...' },
            { type: 'tool_use', id: 'tu_1', name: 'TodoWrite', input: { todos } },
            { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: '/bar.ts' } },
          ],
        },
      };

      handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

      expect(sink.onTodoUpdate).toHaveBeenCalledWith(todos);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/events.test.ts`
Expected: FAIL — `onTodoUpdate` is not called (or test file doesn't exist yet).

- [ ] **Step 3: Add TodoWrite extraction to handleAssistantEvent**

In `packages/core/src/plugins/builtin/claude/events.ts`, modify `handleAssistantEvent` (lines 69-89). Add todo extraction after the existing message content check and before calling `sink.onMessage`:

```typescript
function handleAssistantEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  const message = event.message as {
    model?: string;
    content: MessageContent[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  if (message?.usage) {
    session.state.lastAssistantUsage = message.usage;
  }
  if (message?.content) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.name === 'TodoWrite') {
        const input = block.input as { todos?: unknown[] };
        if (Array.isArray(input?.todos)) {
          sink.onTodoUpdate(input.todos as import('@qlan-ro/mainframe-types').TodoItem[]);
        }
      }
    }

    sink.onMessage(message.content, {
      model: message.model,
      usage: message.usage,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/events.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/events.ts packages/core/src/plugins/builtin/claude/__tests__/events.test.ts
git commit -m "feat(claude): extract todos from TodoWrite tool_use events"
```

---

### Task 5: Implement onTodoUpdate in Event Handler

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts:88-343`

- [ ] **Step 1: Add onTodoUpdate handler to buildSessionSink**

In `packages/core/src/chat/event-handler.ts`, add the `onTodoUpdate` method to the returned sink object. Place it after `onSkillFile` (after line 337, before `onError`):

```typescript
    onTodoUpdate(todos: import('@qlan-ro/mainframe-types').TodoItem[]) {
      db.chats.updateTodos(chatId, todos);
      emitEvent({ type: 'todos.updated', chatId, todos });
    },
```

- [ ] **Step 2: Build core package to verify**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Clean build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/chat/event-handler.ts
git commit -m "feat(core): implement onTodoUpdate sink handler"
```

---

### Task 6: Emit Todos on Chat Resume

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts:82-99`

- [ ] **Step 1: Emit todos.updated in resumeChat**

In `packages/core/src/chat/lifecycle-manager.ts`, in the `resumeChat` method (line 82), add a `todos.updated` emit after the existing `chat.updated` emit (line 98). Only emit if the chat has todos stored:

```typescript
  async resumeChat(chatId: string): Promise<void> {
    await this.loadChat(chatId);

    const chat = this.deps.activeChats.get(chatId)?.chat ?? this.deps.db.chats.get(chatId);
    if (!chat) return;

    if (chat.processState === 'working') {
      if (chat.permissionMode === 'yolo') {
        await this.startChat(chatId);
      } else if (!this.deps.permissions.hasPending(chatId)) {
        await this.startChat(chatId);
      }
    }

    // Always push current state to the just-(re)subscribed client so it can
    // recover displayStatus/isRunning after a project switch.
    this.deps.emitEvent({ type: 'chat.updated', chat });

    // Restore todo checklist state for the UI
    const todos = this.deps.db.chats.getTodos(chatId);
    if (todos) {
      this.deps.emitEvent({ type: 'todos.updated', chatId, todos });
    }
  }
```

- [ ] **Step 2: Build core package**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/chat/lifecycle-manager.ts
git commit -m "feat(core): emit todos on chat resume"
```

---

### Task 7: Add Todos to Desktop Store and Event Router

**Files:**
- Modify: `packages/desktop/src/renderer/store/chats.ts`
- Modify: `packages/desktop/src/renderer/lib/ws-event-router.ts`

- [ ] **Step 1: Add todos state and setTodos action to store**

In `packages/desktop/src/renderer/store/chats.ts`:

Add `TodoItem` to the import on line 2:

```typescript
import type { Chat, DisplayMessage, ControlRequest, AdapterProcess, QueuedMessageRef, TodoItem } from '@qlan-ro/mainframe-types';
```

Add to the `ChatsState` interface (after `unreadChatIds` on line 22):

```typescript
  todos: Map<string, TodoItem[]>;
```

Add the action (after `setContextUsage` on line 44):

```typescript
  setTodos: (chatId: string, todos: TodoItem[]) => void;
```

Add initial state (after `unreadChatIds` initialization on line 57):

```typescript
  todos: new Map(),
```

Add the action implementation (after `setContextUsage` implementation, before the closing `})`):

```typescript
  setTodos: (chatId, todos) =>
    set((state) => {
      const next = new Map(state.todos);
      next.set(chatId, todos);
      return { todos: next };
    }),
```

- [ ] **Step 2: Route todos.updated in ws-event-router**

In `packages/desktop/src/renderer/lib/ws-event-router.ts`, add a case for `todos.updated` after the `chat.contextUsage` case (after line 146):

```typescript
    case 'todos.updated':
      log.debug('event:todos.updated', { chatId: event.chatId, count: event.todos.length });
      chats.setTodos(event.chatId, event.todos);
      break;
```

- [ ] **Step 3: Build desktop package**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/store/chats.ts packages/desktop/src/renderer/lib/ws-event-router.ts
git commit -m "feat(desktop): add todos store state and event routing"
```

---

### Task 8: Create TasksSection Component

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/TasksSection.tsx`

- [ ] **Step 1: Create the TasksSection component**

Create `packages/desktop/src/renderer/components/panels/TasksSection.tsx`:

```tsx
import React from 'react';
import { CheckSquare, CheckCircle, Clock, Circle } from 'lucide-react';
import type { TodoItem } from '@qlan-ro/mainframe-types';

interface TasksSectionProps {
  todos: TodoItem[];
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={13} className="text-green-500 shrink-0" />;
    case 'in_progress':
      return <Clock size={13} className="text-blue-400 shrink-0" />;
    default:
      return <Circle size={13} className="text-mf-text-secondary opacity-60 shrink-0" />;
  }
}

export function TasksSection({ todos }: TasksSectionProps): React.ReactElement {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const pct = total > 0 ? (completed / total) * 100 : 0;

  return (
    <details open className="group">
      <summary className="flex items-center gap-2 px-2 py-1.5 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-body text-mf-text-primary select-none">
        <CheckSquare size={14} className="text-mf-text-secondary shrink-0" />
        <span className="flex-1">Tasks</span>
        <span className="text-mf-status text-mf-text-secondary bg-mf-hover rounded-full px-1.5 min-w-[20px] text-center">
          {completed}/{total}
        </span>
      </summary>
      <div className="pl-2 mt-1">
        <div className="mx-2 mb-2">
          <div className="h-[3px] bg-mf-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="space-y-0.5">
          {todos.map((todo, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-0.5 text-mf-small">
              <StatusIcon status={todo.status} />
              <span
                className={
                  todo.status === 'completed'
                    ? 'text-mf-text-secondary line-through'
                    : todo.status === 'in_progress'
                      ? 'text-blue-400'
                      : 'text-mf-text-secondary opacity-60'
                }
              >
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Verify no lint/type errors**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/TasksSection.tsx
git commit -m "feat(desktop): add TasksSection component for todo checklist"
```

---

### Task 9: Render TasksSection in ContextTab

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/ContextTab.tsx`

- [ ] **Step 1: Import and render TasksSection**

In `packages/desktop/src/renderer/components/panels/ContextTab.tsx`:

Add imports at the top (after existing imports):

```typescript
import { TasksSection } from './TasksSection';
```

Inside the `ContextTab` component, add a selector for todos (after the `activeChatId` selector):

```typescript
  const todos = useChatsStore((s) => (s.activeChatId ? s.todos.get(s.activeChatId) : undefined));
```

In the JSX return, render `TasksSection` above the first `ContextSection` (Global). Add it as the first child of the `<div className="space-y-2">`:

```tsx
      {todos && todos.length > 0 && <TasksSection todos={todos} />}
```

- [ ] **Step 2: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ContextTab.tsx
git commit -m "feat(desktop): render TasksSection in ContextTab"
```

---

### Task 10: Full Build and Type Check

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Create changeset**

Run: `pnpm changeset`
Pick affected packages: `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-desktop`
Bump type: minor
Summary: "Show Claude's TodoWrite task checklist in the Context tab"

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for todowrite checklist feature"
```
