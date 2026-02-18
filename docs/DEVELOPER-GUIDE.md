# Mainframe Developer Guide

> Getting started, development workflow, and contribution guidelines

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ (22 recommended) | Runtime |
| pnpm | 8+ | Package manager |
| Git | 2.x | Version control |
| Claude CLI | Latest | Required adapter |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/qlan-ro/mainframe.git
cd mainframe

# Install dependencies
pnpm install

# Build all packages (types must build first)
pnpm build

# Start development (daemon + desktop)
pnpm dev
```

The `pnpm dev` command starts the daemon first, waits 2 seconds, then launches the Electron desktop app.

### Running Individually

```bash
# Terminal 1: Start daemon only
pnpm dev:core

# Terminal 2: Start desktop only (assumes daemon is running)
pnpm dev:desktop
```

## Monorepo Structure

```
mainframe/
├── packages/
│   ├── types/      # @mainframe/types — shared TypeScript definitions
│   ├── core/       # @mainframe/core  — Node.js daemon server
│   └── desktop/    # @mainframe/desktop — Electron + React app
├── docs/           # Documentation
├── package.json    # Root workspace config
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Dependency Graph

```
@mainframe/desktop → @mainframe/types
@mainframe/core    → @mainframe/types
```

Both `core` and `desktop` depend on `types`. They do **not** depend on each other — communication happens over HTTP/WebSocket at runtime.

## Package Details

### @mainframe/types

Pure TypeScript type definitions. Zero runtime dependencies.

```bash
pnpm --filter @mainframe/types build    # Compile types
```

**When to modify**: Adding new API endpoints, changing data models, adding adapter capabilities.

**Key files**:
- `src/adapter.ts` — Adapter interface, process types, permission types
- `src/chat.ts` — Chat, Project, ChatMessage, MessageContent
- `src/events.ts` — DaemonEvent (server→client), ClientEvent (client→server)
- `src/api.ts` — REST API response types
- `src/skill.ts` — Skill and Agent configuration types
- `src/context.ts` — Session context, mentions, attachments
- `src/settings.ts` — Permission modes, provider config

### @mainframe/core

Node.js daemon that manages CLI adapters and serves the API.

```bash
pnpm --filter @mainframe/core build    # Compile
pnpm --filter @mainframe/core dev      # Watch mode (tsx)
pnpm --filter @mainframe/core test     # Run tests (vitest)
```

**Key files**:
- `src/index.ts` — Entry point, starts HTTP + WebSocket servers
- `src/config.ts` — Port and data directory configuration
- `src/chat/chat-manager.ts` — Core orchestrator, manages chat lifecycle
- `src/chat/permission-manager.ts` — Permission queue (FIFO)
- `src/chat/event-handler.ts` — Adapter event wiring
- `src/chat/message-cache.ts` — In-memory message store
- `src/adapters/claude.ts` — Claude CLI adapter (spawn, stdin/stdout)
- `src/adapters/claude-events.ts` — JSONL stdout/stderr parser
- `src/server/http.ts` — Express app + CORS + error middleware
- `src/server/routes/` — 10 route modules (files, git, chats, skills, etc.)
- `src/server/websocket.ts` — WebSocket event handler + broadcast

**Data directory**: `~/.mainframe/` (SQLite DB, attachments, config)

### @mainframe/desktop

Electron application with React frontend.

```bash
pnpm --filter @mainframe/desktop build     # Build for production
pnpm --filter @mainframe/desktop dev       # Development mode
pnpm --filter @mainframe/desktop package   # Create distributable
```

**Key files**:
- `src/main/index.ts` — Electron main process
- `src/preload/index.ts` — Preload script (IPC bridge)
- `src/renderer/App.tsx` — Root React component
- `src/renderer/lib/client.ts` — DaemonClient (WebSocket + REST)
- `src/renderer/hooks/useDaemon.ts` — Daemon connection management
- `src/renderer/store/` — Zustand state stores

## Build Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm build:types` | Build types only |
| `pnpm build:core` | Build core only |
| `pnpm build:desktop` | Build desktop only |
| `pnpm dev` | Start daemon + desktop in dev mode |
| `pnpm dev:core` | Start daemon in watch mode |
| `pnpm dev:desktop` | Start desktop in dev mode |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm clean` | Clean build artifacts |
| `pnpm package` | Build + package Electron app |

## Development Workflow

### Adding a New REST Endpoint

1. **Define types** in `packages/types/src/api.ts` (or relevant type file)
2. **Build types**: `pnpm build:types`
3. **Add route** in `packages/core/src/server/routes/<resource>.ts` (or create a new route module)
4. **Register route** in `packages/core/src/server/routes/index.ts` and `packages/core/src/server/http.ts`
5. **Add client method** in `packages/desktop/src/renderer/lib/client.ts`
6. **Wire up UI** in the relevant React component

### Adding a New WebSocket Event

1. **Add event type** to `DaemonEvent` or `ClientEvent` in `packages/types/src/events.ts`
2. **Build types**: `pnpm build:types`
3. **Emit event** from `ChatManager` in `packages/core/src/chat/chat-manager.ts`
4. **Handle event** in `WebSocketManager` (`packages/core/src/server/websocket.ts`)
5. **Process event** in `useDaemon` hook (`packages/desktop/src/renderer/hooks/useDaemon.ts`)

### Adding a New Adapter

1. Create `packages/core/src/adapters/<name>.ts` extending `BaseAdapter`
2. Implement the `Adapter` interface from `@mainframe/types`
3. Register in `AdapterRegistry` (`packages/core/src/adapters/index.ts`)
4. Add adapter info to the UI display utilities

### Adding a New Zustand Store

1. Create `packages/desktop/src/renderer/store/<name>.ts`
2. Export from `packages/desktop/src/renderer/store/index.ts`
3. Initialize in `useDaemon.ts` if it needs daemon event synchronization

## Architecture Decisions

### Why No Message Persistence?

Each CLI agent (Claude, Gemini, etc.) persists its own conversation history. Mainframe stores only metadata (session IDs, costs, timestamps) in SQLite. When resuming a chat, the CLI's `--resume` flag replays stored messages. This avoids duplicating storage and keeps the source of truth in the CLI tools.

### Why WebSocket + REST?

- **WebSocket**: Real-time streaming of chat messages, permission requests, and process events
- **REST**: CRUD operations (projects, chats, files, settings) where request-response is sufficient

### Why Zustand Over Redux?

Lightweight, minimal boilerplate, and scales well for the app's complexity. Each domain has its own store (projects, chats, ui, tabs, settings) without the ceremony of Redux actions/reducers.

### Why assistant-ui?

The `@assistant-ui/react` library provides headless chat primitives that work with external message stores. This lets Mainframe control the full rendering pipeline (custom tool cards, thinking blocks, etc.) while getting scroll management, streaming UX, and composer behavior for free.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 31415 | Daemon HTTP + WebSocket server port |
| `LOG_LEVEL` | info | Logging verbosity |
| `NODE_ENV` | — | `development` enables dev tools, assumes daemon running separately |

## Testing

Tests use [Vitest](https://vitest.dev/) and live in `packages/core/src/__tests__/`.

```bash
# Run all tests
pnpm test

# Run core tests only
pnpm --filter @mainframe/core test

# Watch mode
pnpm --filter @mainframe/core test -- --watch
```

## Debugging

### Daemon Logs

The daemon logs to stdout. In dev mode (`pnpm dev:core`), all output is visible in the terminal.

### Electron DevTools

In development, the Electron window opens with DevTools enabled and remote debugging on port 9222.

### SQLite Database

The database is at `~/.mainframe/mainframe.db`. Inspect with any SQLite client:

```bash
sqlite3 ~/.mainframe/mainframe.db ".tables"
sqlite3 ~/.mainframe/mainframe.db "SELECT * FROM chats ORDER BY updatedAt DESC LIMIT 5;"
```

## Code Conventions

- **TypeScript strict mode** with `NodeNext` module resolution
- **No comments for absent code** — don't explain what doesn't exist
- **Tailwind CSS** for all styling (desktop renderer)
- **No `/opacity` modifier** on CSS variable colors — use `opacity-*` utility instead
- **File size limit**: 300 lines per file (split if larger)
- **Function size limit**: 50 lines per function
