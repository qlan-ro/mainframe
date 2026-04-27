# TodoWrite Checklist in UI

Display Claude's TodoWrite task checklist in the Mainframe UI, giving users visibility into what the agent is working on and its progress through a multi-step task.

Issue: #65

## Context

Claude has a built-in `TodoWrite` tool that manages a session-scoped task checklist. It stores todos in memory and writes the full list on every invocation. The tool_use input contains the complete todo state:

```json
{ "todos": [{ "content": "string", "status": "string", "activeForm": "string" }] }
```

Currently, TodoWrite is in the hidden tools list — tool_use/tool_result pairs flow through the message pipeline but are suppressed from display. The todo data is discarded.

## Design Decisions

- **Location:** New "Tasks" section in the Context tab of the right panel, rendered above Global/Project/Session sections.
- **Visibility:** Section only appears after the first TodoWrite event in a session. No empty state.
- **State model:** Show only the latest state. Each TodoWrite fully replaces the previous list.
- **Persistence:** Stored in SQLite on the `chats` table so state survives daemon restart.
- **Event isolation:** Dedicated `todos.updated` daemon event. Does not piggyback on `chat.updated` to avoid unnecessary re-renders in unrelated listeners.
- **Scope exclusions:** task_notification events (subagent completion), inline chat rendering, todo history/versioning.

## Data Model

### TodoItem Type

```typescript
// packages/types/src/chat.ts

export interface TodoItem {
  content: string;      // imperative form: "Add error handling"
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;   // present continuous: "Adding error handling"
}
```

### Database

Add nullable `todos TEXT` column to the `chats` table. Stored as JSON-serialized `TodoItem[]`. `null` means TodoWrite has not been used in this session.

### Daemon Event

```typescript
// packages/types/src/events.ts — added to DaemonEvent union

| { type: 'todos.updated'; chatId: string; todos: TodoItem[] }
```

### SessionSink

```typescript
// packages/types/src/adapter.ts — added to SessionSink interface

onTodoUpdate(todos: TodoItem[]): void;
```

## Event Flow

```
CLI stdout
  → handleAssistantEvent() in events.ts
    → detects tool_use block with name === "TodoWrite"
    → extracts input.todos as TodoItem[]
    → calls sink.onTodoUpdate(todos)

sink.onTodoUpdate(todos)  in event-handler.ts
  → db.chats.updateTodos(chatId, todos)        // persist to SQLite
  → emitEvent({ type: 'todos.updated', chatId, todos })  // to desktop

Desktop
  → daemonClient.onEvent listener catches 'todos.updated'
  → updates zustand: todos.set(chatId, event.todos)
  → ContextTab re-renders TasksSection
```

**Why extract from assistant event (tool_use), not user event (tool_result)?** The tool_use input contains the full todo list with statuses. The tool_result just says "Todos have been modified successfully" — no useful data. Extracting from tool_use gives the update as early as possible.

TodoWrite remains in the hidden tools list. The Context tab section replaces it visually.

## Files to Modify

### packages/types/

| File | Change |
|------|--------|
| `src/chat.ts` | Add `TodoItem` interface. Add optional `todos?: TodoItem[]` to `Chat` type. |
| `src/adapter.ts` | Add `onTodoUpdate(todos: TodoItem[]): void` to `SessionSink`. |
| `src/events.ts` | Add `todos.updated` variant to `DaemonEvent` union. |

### packages/core/

| File | Change |
|------|--------|
| `src/plugins/builtin/claude/events.ts` | In `handleAssistantEvent`, detect `tool_use` blocks with `name === "TodoWrite"`, parse `input.todos`, call `sink.onTodoUpdate()`. |
| `src/chat/event-handler.ts` | Implement `onTodoUpdate` in `buildSessionSink`: persist to DB, emit `todos.updated` event. |
| `src/db/chats.ts` | Add `todos TEXT` column migration. Add `updateTodos(chatId, todos)` and `getTodos(chatId)` methods. |
| `src/db/schema.ts` | Add `todos TEXT` column to chats table schema. |

### packages/desktop/

| File | Change |
|------|--------|
| `src/renderer/store/chats.ts` | Add `todos: Map<string, TodoItem[]>` to store. Add `todos.updated` event handler. |
| `src/renderer/components/panels/ContextTab.tsx` | Render `TasksSection` above Global section when todos exist for active chat. |
| `src/renderer/components/panels/TasksSection.tsx` | New component (see UI section). |

## UI Component

### TasksSection

Rendered at the top of `ContextTab`, only when todos exist for the active chat.

```
TasksSection
├── ContextSection (icon=CheckSquare, title="Tasks", count=todos.length, defaultOpen=true)
│   ├── Progress bar (3px, green fill proportional to completed/total)
│   └── TodoItemRow[] (one per item, read-only)
│       ├── Status icon
│       │   ├── completed: green check-circle
│       │   ├── in_progress: blue clock-circle
│       │   └── pending: gray empty circle
│       └── Label text
│           ├── completed: content text, strikethrough, dimmed (text-mf-text-secondary)
│           ├── in_progress: activeForm text, blue highlight (text-blue-400)
│           └── pending: content text, dimmed (text-mf-text-secondary opacity-60)
```

### Badge

The `ContextSection` count badge shows `todos.length`. A custom fraction display (e.g., "3/5") is rendered inside the section header alongside or replacing the default count badge.

### Progress Bar

- 3px height, inside the section below the header
- Track: `bg-mf-hover`
- Fill: green (`#22c55e`), width proportional to `completed / total`
- Smooth transition on width changes

### Styling

- No interactivity — the checklist is read-only, the agent controls state
- Completed items use `line-through` and dimmed color
- In-progress items use `activeForm` text and blue accent
- Pending items use `content` text and reduced opacity

## Chat Resume / History

When a chat is loaded (via resume or browsing history), the `todos` column is read from the DB and emitted as `todos.updated` so the Context tab shows the last known state. This happens in the existing chat-load flow — no separate fetch endpoint needed.
