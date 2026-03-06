# Plugin Developer Guide

Build plugins that extend Mainframe with new UI panels, database storage, event listeners, HTTP APIs, and even custom AI adapter integrations.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Manifest Reference](#manifest-reference)
- [Plugin Entry Point](#plugin-entry-point)
- [Plugin Context API](#plugin-context-api)
- [Database](#database)
- [HTTP Routes](#http-routes)
- [UI Panels](#ui-panels)
- [Event Bus](#event-bus)
- [Attachments](#attachments)
- [Config](#config)
- [Services](#services)
- [Adapter Plugins](#adapter-plugins)
- [File System Layout](#file-system-layout)
- [Security Model](#security-model)

---

## Overview

Mainframe plugins are Node.js modules that run inside the daemon process. Each plugin declares its capabilities in a `manifest.json` and exports an `activate()` function in `index.js`.

**What plugins can do:**

- Register UI panels in the desktop app (tabs, sidebars, fullview)
- Store data in an isolated SQLite database
- Listen to daemon lifecycle events (chat started/completed, project added/removed)
- Expose HTTP endpoints under `/api/plugins/<plugin-id>/`
- Save and retrieve file attachments
- Persist key-value configuration
- Query chats and projects through service APIs
- Register new AI CLI adapters (Claude, Gemini, etc.)

**Plugin types:**

| Type | Description | Example |
|------|-------------|---------|
| Builtin | Ships with Mainframe, loaded from TypeScript | `claude` adapter, `todos` kanban |
| External | Installed by users, loaded from `manifest.json` + `index.js` | Custom dashboards, integrations |

**Security model in brief:** Plugins declare capabilities in their manifest. The runtime enforces these declarations — calling an API without the required capability throws an error. Plugins get isolated databases, namespaced config, and sanitized event streams. They cannot read message content or inject into existing user chats without explicit capabilities.

---

## Quick Start

Create a minimal plugin that registers a UI panel.

### 1. Create the plugin directory

```
~/.mainframe/plugins/hello-world/
├── manifest.json
└── index.js
```

### 2. Write the manifest

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal example plugin",
  "capabilities": ["ui:panels"],
  "ui": {
    "zone": "right-tab",
    "label": "Hello",
    "icon": "hand"
  }
}
```

### 3. Write the entry point

```js
// index.js
exports.activate = function (ctx) {
  ctx.ui.addPanel({
    zone: 'right-tab',
    label: 'Hello',
    icon: 'hand',
  });

  ctx.router.get('/greet', (_req, res) => {
    res.json({ message: 'Hello from my plugin!' });
  });

  ctx.onUnload(() => {
    ctx.ui.removePanel();
    ctx.logger.info('Hello World plugin unloaded');
  });

  ctx.logger.info('Hello World plugin activated');
};
```

### 4. Restart Mainframe

The daemon scans plugin directories on startup and loads any valid plugin it finds.

Your plugin's API is now available at `GET /api/plugins/hello-world/greet` and a "Hello" tab appears in the right panel.

---

## Manifest Reference

Every plugin requires a `manifest.json` in its root directory. The daemon validates this against a Zod schema on load — invalid manifests are skipped with a warning.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier. Lowercase alphanumeric with hyphens, must start with a letter. Pattern: `^[a-z][a-z0-9-]*$` |
| `name` | `string` | Yes | Human-readable display name |
| `version` | `string` | Yes | Semantic version string |
| `description` | `string` | No | Short description of what the plugin does |
| `author` | `string` | No | Author name or organization |
| `license` | `string` | No | SPDX license identifier |
| `capabilities` | `string[]` | Yes | List of required capabilities (see below) |
| `ui` | `object` | No | UI panel contribution (see [UI Panels](#ui-panels)) |
| `adapter` | `object` | No | Adapter registration (see [Adapter Plugins](#adapter-plugins)) |

### Capabilities

| Capability | Grants access to |
|------------|-----------------|
| `storage` | `ctx.db` (SQLite database) and `ctx.attachments` (file storage) |
| `ui:panels` | `ctx.ui.addPanel()` and `ctx.ui.removePanel()` |
| `ui:notifications` | `ctx.ui.notify()` |
| `daemon:public-events` | `ctx.events.onDaemonEvent()` and `ctx.events.onChatEvent()` |
| `chat:read` | `ctx.services.chats.listChats()` and `ctx.services.chats.getChatById()` |
| `chat:read:content` | `ctx.services.chats.getMessages()` — access to message content |
| `chat:create` | `ctx.services.chats.createChat()` — create new chat sessions |
| `adapters` | `ctx.adapters.register()` — register a CLI adapter |
| `process:exec` | Execute external processes (reserved) |
| `http:outbound` | Make outbound HTTP requests (reserved) |

### Cross-field rules

- Declaring `adapters` capability requires the `adapter` field with `binaryName` and `displayName`.
- Declaring a `ui.zone` requires the `ui:panels` capability.

### `ui` object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `zone` | `UIZone` | Yes | Where the panel renders (see [UI Panels](#ui-panels)) |
| `label` | `string` | Yes | Tooltip for rail icons; tab text for tab zones |
| `icon` | `string` | No | [Lucide](https://lucide.dev/icons) icon name |

### `adapter` object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `binaryName` | `string` | Yes | CLI binary name (e.g., `claude`, `gemini`) |
| `displayName` | `string` | Yes | Human-readable adapter name |

### Example: full manifest

```json
{
  "id": "my-dashboard",
  "name": "Project Dashboard",
  "version": "0.1.0",
  "description": "Custom project analytics dashboard",
  "author": "Your Name",
  "license": "MIT",
  "capabilities": [
    "storage",
    "ui:panels",
    "ui:notifications",
    "daemon:public-events",
    "chat:read"
  ],
  "ui": {
    "zone": "fullview",
    "label": "Dashboard",
    "icon": "layout-dashboard"
  }
}
```

---

## Plugin Entry Point

The daemon loads `index.js` from the plugin directory using `require()` (CommonJS). Your module must export an `activate` function.

### Contract

```ts
interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
}
```

- `activate` is called once when the plugin loads.
- It receives a `PluginContext` — the plugin's entire API surface.
- It may be synchronous or return a Promise.
- Register cleanup logic via `ctx.onUnload()`.

### `onUnload(fn)`

Register a callback that runs when the daemon shuts down or the plugin is unloaded. Use it to remove UI panels, close connections, or release resources.

```js
exports.activate = function (ctx) {
  const interval = setInterval(() => {
    ctx.logger.debug('heartbeat');
  }, 60000);

  ctx.onUnload(() => {
    clearInterval(interval);
    ctx.ui.removePanel();
  });
};
```

Multiple `onUnload` callbacks are supported — they run in registration order.

---

## Plugin Context API

The `PluginContext` object is the plugin's gateway to Mainframe. Some properties are always available; others require specific capabilities.

```ts
interface PluginContext {
  // Always available
  readonly manifest: PluginManifest;
  readonly logger: Logger;            // pino Logger
  readonly router: Router;            // Express Router
  readonly config: PluginConfig;
  readonly services: {
    chats: ChatServiceAPI;
    projects: ProjectServiceAPI;
  };
  onUnload(fn: () => void): void;

  // Requires 'storage'
  readonly db: PluginDatabaseContext;
  readonly attachments: PluginAttachmentContext;

  // Requires 'daemon:public-events'
  readonly events: PluginEventBus;

  // Requires 'ui:panels' or 'ui:notifications'
  readonly ui: PluginUIContext;

  // Requires 'adapters'
  readonly adapters?: AdapterRegistrationAPI;
}
```

Accessing a capability-gated property without the required capability throws:

```
Error: Plugin capability 'storage' is required but not declared in manifest
```

### `manifest`

The parsed manifest object. Read-only.

### `logger`

A [pino](https://getpino.io/) child logger namespaced to `plugin:<id>`. Use it instead of `console.log`.

```js
ctx.logger.info('Plugin started');
ctx.logger.debug({ key: 'value' }, 'Debug context');
ctx.logger.warn({ err }, 'Something went wrong');
```

---

## Database

**Capability required:** `storage`

Each plugin gets its own SQLite database at `<plugin-dir>/data.db`, isolated from Mainframe's internal database and from other plugins.

### `db.runMigration(sql)`

Execute raw SQL statements. Use this in `activate()` to create tables.

```js
ctx.db.runMigration(`
  CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    recorded_at TEXT NOT NULL
  )
`);
```

The database uses WAL journal mode and has foreign keys enabled.

### `db.prepare<T>(sql)`

Prepare a SQL statement. Returns an object with `run()`, `get()`, and `all()` methods.

```ts
interface PluginDatabaseStatement<T> {
  run(...params: unknown[]): void;
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}
```

```js
// Insert
ctx.db.prepare(
  'INSERT INTO metrics (id, name, value, recorded_at) VALUES (?, ?, ?, ?)'
).run(id, 'response_time', 1.23, new Date().toISOString());

// Query one
const row = ctx.db.prepare('SELECT * FROM metrics WHERE id = ?').get(id);

// Query many
const rows = ctx.db.prepare(
  'SELECT * FROM metrics WHERE name = ? ORDER BY recorded_at DESC'
).all('response_time');
```

### `db.transaction(fn)`

Run multiple operations atomically. If `fn` throws, the transaction rolls back.

```js
ctx.db.transaction(() => {
  ctx.db.prepare('DELETE FROM metrics WHERE name = ?').run('old_metric');
  ctx.db.prepare(
    'INSERT INTO metrics (id, name, value, recorded_at) VALUES (?, ?, ?, ?)'
  ).run(newId, 'new_metric', 42, now);
});
```

### Migration patterns

Run migrations in `activate()`. For incremental changes, check existing schema first:

```js
exports.activate = function (ctx) {
  // Initial table
  ctx.db.runMigration(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Add column if missing
  const cols = ctx.db.prepare('PRAGMA table_info(items)').all();
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('priority')) {
    ctx.db.runMigration(
      "ALTER TABLE items ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'"
    );
  }
};
```

---

## HTTP Routes

**Always available** — no capability required.

Each plugin gets an Express `Router` scoped to `/api/plugins/<plugin-id>/`. Define routes on `ctx.router`.

```js
// GET /api/plugins/my-plugin/status
ctx.router.get('/status', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// POST /api/plugins/my-plugin/items
ctx.router.post('/items', (req, res) => {
  const { title } = req.body;
  // ... create item
  res.status(201).json({ item });
});

// PATCH /api/plugins/my-plugin/items/:id
ctx.router.patch('/items/:id', (req, res) => {
  const { id } = req.params;
  // ... update item
  res.json({ item });
});

// DELETE /api/plugins/my-plugin/items/:id
ctx.router.delete('/items/:id', (req, res) => {
  // ... delete item
  res.status(204).send();
});
```

Validate input with Zod or manual checks — the router does not validate request bodies for you.

The daemon also exposes listing routes automatically:

- `GET /api/plugins/` — list all loaded plugins
- `GET /api/plugins/:id` — get a single plugin's metadata

---

## UI Panels

**Capability required:** `ui:panels`

Plugins contribute UI to the desktop app by registering panels in specific zones.

### Zones

| Zone | Behavior |
|------|----------|
| `fullview` | Replaces left + center + right panels. Trigger appears in the title bar. |
| `left-panel` | Replaces the entire left panel. Trigger icon in the left rail. |
| `right-panel` | Replaces the entire right panel. Trigger icon in the right rail. |
| `left-tab` | Tab appended to the left panel's tab strip. |
| `right-tab` | Tab appended to the right panel's tab strip. |

### `ui.addPanel(opts)`

Register a panel. Call this in `activate()`.

```js
ctx.ui.addPanel({
  zone: 'left-tab',
  label: 'Analytics',
  icon: 'bar-chart-2',
});
```

- `zone` — one of the zones above
- `label` — tooltip text (for rail icons) or tab label (for tab zones)
- `icon` — a [Lucide](https://lucide.dev/icons) icon name (optional)

### `ui.removePanel()`

Unregister the panel. Call this in your `onUnload` callback.

```js
ctx.onUnload(() => ctx.ui.removePanel());
```

### `ui.notify(options)`

**Capability required:** `ui:notifications`

Show a desktop notification.

```js
ctx.ui.notify({
  title: 'Build Complete',
  body: 'All 42 tests passed.',
  level: 'info', // 'info' | 'warning' | 'error'
});
```

### Desktop rendering

The desktop app renders plugin panels in an iframe or webview pointed at the plugin's HTTP routes. Your plugin serves its own HTML/JS/CSS through `ctx.router`:

```js
ctx.router.get('/ui', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><body>
      <h1>My Plugin Panel</h1>
      <script>
        fetch('/api/plugins/my-plugin/data')
          .then(r => r.json())
          .then(console.log);
      </script>
    </body></html>
  `);
});
```

---

## Event Bus

**Capability required:** `daemon:public-events`

The event bus lets plugins react to daemon lifecycle events and emit their own internal events.

### Plugin-internal events

Communicate between parts of your plugin:

```js
// Emit
ctx.events.emit('item-created', { id: '123', title: 'New item' });

// Listen
ctx.events.on('item-created', (payload) => {
  ctx.logger.info({ payload }, 'Item created');
});
```

Events are namespaced per plugin — you cannot hear other plugins' internal events.

### Daemon events

Listen to public daemon lifecycle events. These are sanitized and never contain message content.

```js
ctx.events.onDaemonEvent('chat.started', (event) => {
  // event: { type, chatId, projectId, adapterId }
  ctx.logger.info({ chatId: event.chatId }, 'Chat started');
});

ctx.events.onDaemonEvent('chat.completed', (event) => {
  // event: { type, chatId, projectId, cost, durationMs }
  ctx.logger.info({ cost: event.cost }, 'Chat completed');
});
```

**Available daemon events:**

| Event | Payload fields |
|-------|---------------|
| `chat.started` | `chatId`, `projectId`, `adapterId` |
| `chat.completed` | `chatId`, `projectId`, `cost`, `durationMs` |
| `chat.error` | `chatId`, `projectId`, `errorMessage` |
| `project.added` | `projectId`, `path` |
| `project.removed` | `projectId` |

### Chat events

Listen to chat-level events (requires `chat:read` capability on top of `daemon:public-events`):

```js
ctx.events.onChatEvent('message.added', (event) => {
  // event: { type, chatId, message }
});

ctx.events.onChatEvent('tool.called', (event) => {
  // event: { type, chatId, toolName, args }
});
```

**Available chat events:**

| Event | Payload fields |
|-------|---------------|
| `message.added` | `chatId`, `message` |
| `message.streaming` | `chatId`, `messageId`, `delta` |
| `tool.called` | `chatId`, `toolName`, `args` |
| `tool.result` | `chatId`, `toolUseId`, `content` |

---

## Attachments

**Capability required:** `storage`

Store and retrieve binary files scoped to an entity (e.g., a todo item, a project). Files are stored on disk under `<plugin-dir>/attachments/`.

### `attachments.save(entityId, file)`

Save a file. Data is base64-encoded.

```js
const meta = await ctx.attachments.save('todo-123', {
  filename: 'screenshot.png',
  mimeType: 'image/png',
  data: base64String,
  sizeBytes: 45200,
});
// meta: { id, filename, mimeType, sizeBytes, createdAt }
```

### `attachments.get(entityId, id)`

Retrieve a file by ID. Returns `null` if not found.

```js
const result = await ctx.attachments.get('todo-123', attachmentId);
if (result) {
  // result.data — base64-encoded file content
  // result.meta — { id, filename, mimeType, sizeBytes, createdAt }
}
```

### `attachments.list(entityId)`

List all attachment metadata for an entity.

```js
const metas = await ctx.attachments.list('todo-123');
// metas: Array<{ id, filename, mimeType, sizeBytes, createdAt }>
```

### `attachments.delete(entityId, id)`

Delete a file.

```js
await ctx.attachments.delete('todo-123', attachmentId);
```

### File layout on disk

```
<plugin-dir>/attachments/
  <entityId>/
    <nanoid>.json          # metadata
    <nanoid>-filename.ext  # file data
```

---

## Config

**Always available** — no capability required.

Persist key-value configuration scoped to your plugin. Values are JSON-serialized and stored in Mainframe's settings database.

### `config.get(key)`

```js
const theme = ctx.config.get('theme'); // unknown | undefined
```

### `config.set(key, value)`

```js
ctx.config.set('theme', 'dark');
ctx.config.set('maxResults', 50);
ctx.config.set('columns', ['status', 'title', 'assignee']);
```

### `config.getAll()`

Returns all keys this plugin has written during the current session.

```js
const all = ctx.config.getAll();
// { theme: 'dark', maxResults: 50, columns: [...] }
```

Keys are automatically namespaced as `plugin:<plugin-id>:<key>` in the settings database — no risk of collision with other plugins.

---

## Services

**Always available** — specific methods require additional capabilities.

### `services.chats`

Query chat metadata. `listChats` and `getChatById` are always available.

```js
const chats = await ctx.services.chats.listChats(projectId);
// Each chat: { id, title, projectId, adapterId, createdAt, totalCost }

const chat = await ctx.services.chats.getChatById(chatId);
```

**With `chat:read:content` capability:**

```js
const messages = await ctx.services.chats.getMessages(chatId);
```

**With `chat:create` capability:**

```js
const { chatId } = await ctx.services.chats.createChat({
  projectId: 'proj-abc',
  adapterId: 'claude',      // optional, defaults to 'claude'
  model: 'claude-sonnet-4-6', // optional
});
```

Plugins can only create new chats — they cannot send messages into existing user chats. This prevents prompt injection.

### `services.projects`

Query project metadata. Always available.

```js
const projects = await ctx.services.projects.listProjects();
// Each project: { id, name, path }

const project = await ctx.services.projects.getProjectById(id);
```

---

## Adapter Plugins

Adapter plugins register new AI CLI tool integrations. The builtin Claude adapter is itself implemented as a plugin.

### Requirements

- Declare `adapters` capability in the manifest
- Include an `adapter` field with `binaryName` and `displayName`

### Manifest

```json
{
  "id": "my-adapter",
  "name": "My AI Adapter",
  "version": "1.0.0",
  "capabilities": ["adapters"],
  "adapter": {
    "binaryName": "my-ai-cli",
    "displayName": "My AI"
  }
}
```

### Entry point

Your adapter class must implement the `Adapter` interface from `@mainframe/types`. Register it via `ctx.adapters.register()`.

```js
// index.js
const { MyAdapter } = require('./adapter');

exports.activate = function (ctx) {
  const adapter = new MyAdapter();
  ctx.adapters.register(adapter);
  ctx.onUnload(() => adapter.killAll());
  ctx.logger.info('My AI adapter registered');
};
```

### Reference implementation

The Claude adapter (`packages/core/src/plugins/builtin/claude/`) is the canonical reference. It implements:

- Process spawning with stdio communication
- NDJSON event stream parsing
- Session resume with `--resume` flags
- Permission request handling (`control_request` / `control_response`)
- Graceful shutdown via `killAll()`

See `packages/types/src/adapter.ts` for the full `Adapter` interface.

---

## File System Layout

Mainframe looks for plugins in these directories:

### User-installed plugins

```
~/.mainframe/plugins/
  my-plugin/
    manifest.json
    index.js
    package.json      # optional
```

### Project-local plugins

Plugins can also live in a project's `.mainframe/plugins/` directory, scoped to that project.

### Builtin plugins

Ship with Mainframe in the source tree:

```
packages/core/src/plugins/builtin/
  claude/             # AI CLI adapter
    index.ts
    adapter.ts
  todos/              # Kanban board
    index.ts
```

Builtin plugins are loaded directly from TypeScript — they skip the file-system manifest reading and are always trusted.

### Plugin data directory

Each external plugin stores its data alongside its code:

```
~/.mainframe/plugins/my-plugin/
  manifest.json
  index.js
  data.db             # SQLite database (created on first use)
  attachments/         # File attachments (created on first use)
```

---

## Security Model

### Capability gating

Every sensitive API on `PluginContext` is guarded by capability checks. The `buildPluginContext()` factory uses `Proxy` objects that throw on any method call if the required capability is missing. There is no way to bypass this at runtime.

### Manifest validation

The daemon validates every manifest against a Zod schema before loading. Invalid manifests are rejected with a warning log. The schema enforces:

- `id` must match `^[a-z][a-z0-9-]*$`
- `capabilities` must only contain recognized values
- Cross-field rules (e.g., `adapters` capability requires `adapter` field)

### Database isolation

Each plugin gets its own SQLite file. Plugins cannot access Mainframe's internal database or other plugins' databases.

### Config namespacing

All config keys are prefixed with `plugin:<plugin-id>:` — plugins cannot read or overwrite each other's configuration.

### Event sanitization

Plugins subscribe to `PublicDaemonEvent` — a sanitized subset of daemon events that never includes raw message content. Access to message content requires the explicit `chat:read:content` capability.

### Chat creation restriction

Plugins with `chat:create` can only create new chat sessions. They cannot inject messages into existing user conversations, preventing prompt injection attacks.

### Builtin plugin trust

Builtin plugins (shipped with Mainframe) skip the consent flow and file-system manifest reading. They are loaded directly from TypeScript and are always trusted.
