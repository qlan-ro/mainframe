# TODO Kanban Plugin — Design

**Date**: 2026-02-23
**Branch**: `feat/plugin-system`
**Purpose**: Validate the plugin system design with a first-party builtin plugin. Also delivers a native task management board inside the app.

---

## 1. Overview

A GitHub-style kanban board built as a builtin plugin. It lives alongside the Claude adapter plugin in `packages/core/src/plugins/builtin/todos/`. The backend follows the full plugin contract (`PluginContext` API), while the frontend is a React component compiled directly into the desktop bundle (appropriate for builtins whose UI ships with the app).

### Plugin System Observations

This build reveals one gap and one pattern:

- **Gap 1 — No attachment API in `PluginContext`**: `AttachmentStore` is chat-scoped. Plugins need generic entity-scoped storage. We add `PluginAttachmentContext` (gated on `storage`) and expose it via `ctx.attachments`.
- **Gap 2 — `createChat` unimplemented**: The `chat:create` capability is declared in types but `buildChatService` never implemented it. We implement it here: creates a chat row in DB, emits `chat.created` so the desktop picks it up automatically.
- **Pattern — Builtin UI integration**: Builtins compiled into the desktop skip the dynamic ESM panel-loading mechanism (`ui:panels`). The UI is a normal React component added to the center panel tab system. The backend still uses `ctx.router` for all API endpoints — this is the testable contract.

---

## 2. Architecture

### Backend (daemon / plugin contract)

```
packages/core/src/plugins/builtin/todos/
├── manifest.json          # capabilities: storage, chat:create
└── index.ts               # activate(ctx) → DB migrations + Express routes
```

**Capabilities declared**:
- `storage` → isolated SQLite at `~/.mainframe/plugins/todos/data.db` + attachment storage at `~/.mainframe/plugins/todos/attachments/`
- `chat:create` → "Start in Session" creates a new chat attributed to the calling project

**Routes** (all under `/api/plugins/todos/`):
| Method | Path | Description |
|--------|------|-------------|
| GET | `/todos` | List all todos (optionally `?status=open`) |
| POST | `/todos` | Create todo |
| PATCH | `/todos/:id` | Update todo fields |
| DELETE | `/todos/:id` | Delete todo |
| PATCH | `/todos/:id/move` | Change status column |
| POST | `/todos/:id/start-session` | Create a chat pre-filled with issue context |
| POST | `/todos/:id/attachments` | Upload attachment for a todo |
| GET | `/todos/:id/attachments` | List todo attachments |
| GET | `/todos/:id/attachments/:attachmentId` | Get attachment data |
| DELETE | `/todos/:id/attachments/:attachmentId` | Delete attachment |

### Frontend (desktop)

```
packages/desktop/src/renderer/components/todos/
├── TodosPanel.tsx      # Kanban board — 3 columns
├── TodoCard.tsx        # Draggable card in a column
└── TodoModal.tsx       # Create / edit modal (full GitHub fields)
```

**Entry point**: A button in `ProjectRail` (above Settings/About). Clicking it opens a `todos` tab in the CenterPanel.

**Tab system**: `CenterTab` is extended with `TodosTab = { type: 'todos'; id: 'todos'; label: 'Tasks' }`. `CenterPanel` renders `<TodosPanel />` for this tab type.

---

## 3. Data Model

### SQLite schema (plugin-isolated DB)

```sql
CREATE TABLE todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',      -- open | in_progress | done
  type         TEXT NOT NULL DEFAULT 'feature',   -- see types below
  priority     TEXT NOT NULL DEFAULT 'medium',    -- low | medium | high | critical
  labels       TEXT NOT NULL DEFAULT '[]',        -- JSON string[]
  assignees    TEXT NOT NULL DEFAULT '[]',        -- JSON string[]
  milestone    TEXT,
  order_index  REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE todo_attachments (
  id           TEXT PRIMARY KEY,
  todo_id      TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  storage_key  TEXT NOT NULL,   -- path under plugin's attachments/ dir
  created_at   TEXT NOT NULL,
  FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
);
```

### Todo types (GitHub issue labels)
`bug`, `feature`, `enhancement`, `documentation`, `question`, `wont_fix`, `duplicate`, `invalid`

### Columns
| Column | Status value | Description |
|--------|-------------|-------------|
| Open | `open` | New / backlog |
| In Progress | `in_progress` | Being worked on |
| Done | `done` | Completed |

---

## 4. Plugin System Changes Required

### 4a. `@mainframe/types/src/plugin.ts`

Add `PluginAttachmentContext`:

```typescript
export interface PluginAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PluginAttachmentContext {
  save(entityId: string, file: {
    filename: string;
    mimeType: string;
    data: string;           // base64
    sizeBytes: number;
  }): Promise<PluginAttachmentMeta>;
  get(entityId: string, id: string): Promise<{ data: string; meta: PluginAttachmentMeta } | null>;
  list(entityId: string): Promise<PluginAttachmentMeta[]>;
  delete(entityId: string, id: string): Promise<void>;
}
```

Add to `PluginContext`:

```typescript
// Requires 'storage'
readonly attachments: PluginAttachmentContext;
```

### 4b. `packages/core/src/plugins/attachment-context.ts` (new file)

Thin wrapper over `AttachmentStore` that maps `entityId` → subdirectory under the plugin's attachment dir. Stores metadata in the plugin SQLite alongside file data on disk.

### 4c. `packages/core/src/plugins/context.ts`

- Import and wire `PluginAttachmentContext` when `storage` is declared.
- Pass `emitEvent` to `buildChatService` so `createChat` can emit `chat.created`.

### 4d. `packages/core/src/plugins/services/chat-service.ts`

Implement `createChat` when `chat:create` is declared:

```typescript
async createChat({ projectId, adapterId, initialMessage }) {
  const chat = db.chats.create(projectId, adapterId ?? 'claude');
  emitEvent({ type: 'chat.created', chat });
  // initialMessage is stored for the frontend to pre-fill the composer
  return { chatId: chat.id, initialMessage };
}
```

---

## 5. UI Design

### Kanban Board Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Tasks                                              [+ New]  │
├────────────────┬────────────────┬───────────────────────────┤
│  Open (3)      │  In Progress(2)│  Done (5)                 │
├────────────────┼────────────────┼───────────────────────────┤
│ ┌────────────┐ │ ┌────────────┐ │ ┌────────────┐            │
│ │ bug        │ │ │ feature    │ │ │ enhancement│            │
│ │ Title here │ │ │ Title here │ │ │ Title here │            │
│ │ P: high    │ │ │ P: medium  │ │ │ P: low     │            │
│ │ #tag1      │ │ │ [▶ Session]│ │ │            │            │
│ └────────────┘ │ └────────────┘ │ └────────────┘            │
│ ┌────────────┐ │                │                           │
│ │ feature    │ │ ┌────────────┐ │                           │
│ │ Title here │ │ │ bug        │ │                           │
│ │ P: medium  │ │ │ Title here │ │                           │
│ └────────────┘ │ │ P: critical│ │                           │
│                │ │ [▶ Session]│ │                           │
│                │ └────────────┘ │                           │
└────────────────┴────────────────┴───────────────────────────┘
```

### Todo Card

Each card shows: type badge (coloured), title, priority indicator, label chips.

Cards in **In Progress** show a "▶ Start Session" button that calls `/todos/:id/start-session` → creates a new chat → desktop navigates to it.

### Todo Modal (Create / Edit)

Fields matching GitHub issues:
- Title (text, required)
- Type (select: Bug / Feature / Enhancement / Documentation / Question / Won't Fix / Duplicate / Invalid)
- Status (select: Open / In Progress / Done)
- Priority (select: Low / Medium / High / Critical)
- Description (textarea, markdown)
- Labels (tag input — comma-separated custom tags)
- Assignees (tag input — free text until user system exists)
- Milestone (text input)
- Attachments (file upload area — shows previews for images)

### "Start in Session" Flow

1. User clicks "▶ Start Session" on an In Progress card.
2. UI calls `POST /api/plugins/todos/todos/:id/start-session` with `{ projectId }`.
3. Daemon creates a chat via `ctx.services.chats.createChat(...)`, emits `chat.created`.
4. Returns `{ chatId, initialMessage }`.
5. The `chat.created` WS event causes the desktop to open a new chat tab automatically.
6. The frontend stores the `initialMessage` in the composer store so it's pre-filled when the chat opens.

### ProjectRail Button

Above the Settings (⚙) and Help (?) buttons, add a Tasks (✓ or SquareCheck) icon button that calls `useTabsStore.getState().openTodosTab()`.

---

## 6. Attachment Storage

Attachments are stored at:
```
~/.mainframe/plugins/todos/attachments/{todoId}/{attachmentId}-{filename}
```

Metadata lives in `todo_attachments` table (plugin SQLite). The `PluginAttachmentContext` exposed on `ctx.attachments` handles all I/O. This is gated on `storage` — the same capability that grants DB access.

---

## 7. What This Tests in the Plugin System

| Contract | Tested? | Notes |
|----------|---------|-------|
| `ctx.router` (Express routes) | ✅ | All CRUD via plugin routes |
| `ctx.db` (isolated SQLite) | ✅ | Full schema with migrations |
| `ctx.attachments` (new) | ✅ | File upload/download per entity |
| `ctx.services.chats.createChat` | ✅ | "Start in Session" flow |
| `ctx.logger` | ✅ | Structured logs throughout |
| `ctx.onUnload` | ✅ | Cleanup registered |
| `ctx.ui.addPanel` (ESM loading) | ❌ | Builtin UI — compiled directly |
| `ctx.events` (daemon events) | ❌ | Not needed for this plugin |
| `ctx.adapters` | ❌ | Not applicable |

The ESM panel loading is tested by the user-installable external plugin flow. Builtins compiled into the desktop use direct React integration.

---

## 8. Files Changed / Created

### New files
- `packages/core/src/plugins/attachment-context.ts`
- `packages/core/src/plugins/builtin/todos/manifest.json`
- `packages/core/src/plugins/builtin/todos/index.ts`
- `packages/desktop/src/renderer/components/todos/TodosPanel.tsx`
- `packages/desktop/src/renderer/components/todos/TodoCard.tsx`
- `packages/desktop/src/renderer/components/todos/TodoModal.tsx`

### Modified files
- `packages/types/src/plugin.ts` — add `PluginAttachmentContext`, update `PluginContext`
- `packages/core/src/plugins/context.ts` — wire attachments + pass emitEvent to chat service
- `packages/core/src/plugins/services/chat-service.ts` — implement `createChat`
- `packages/core/src/index.ts` — register todos builtin
- `packages/desktop/src/renderer/store/tabs.ts` — add `TodosTab` + `openTodosTab()`
- `packages/desktop/src/renderer/components/center/CenterPanel.tsx` — render `TodosPanel` for todos tab
- `packages/desktop/src/renderer/components/ProjectRail.tsx` — add Tasks button

### Tests
- `packages/core/src/__tests__/plugins/builtin/todos.test.ts`
