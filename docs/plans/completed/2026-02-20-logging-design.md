# Logging System Design

**Date:** 2026-02-20
**Status:** Approved

## Goals

1. Persist logs to disk so they survive restarts and can be shared for support.
2. Consistent structured logging across daemon, Electron main, and renderer.
3. INFO level for all user actions; DEBUG level for verbose internals (no tight-loop noise).
4. Dev profile runs daemon at `debug` level automatically.
5. Logs discoverable at a known path: `~/.mainframe/logs/`.

## Architecture

Three separate log files, all under `~/.mainframe/logs/`, with daily rotation and 7-day retention via `pino-roll`:

```
~/.mainframe/logs/
  daemon.2026-02-20.log     ← pino NDJSON, @mainframe/core daemon process
  main.2026-02-20.log       ← pino NDJSON, Electron main process
  renderer.2026-02-20.log   ← pino NDJSON, forwarded from renderer via IPC
```

### Daemon (`@mainframe/core`)

Extend the existing `pino` logger in `packages/core/src/logger.ts` with a `pino-roll` file transport. The logger always writes to file (both dev and prod). In dev, also pretty-prints to stdout at `debug` level. In prod, writes NDJSON to stdout + file at `info` level.

`pino-roll` config:
- `file`: `~/.mainframe/logs/daemon.log`
- `frequency`: `'daily'`
- `limit`: `{ count: 7 }`
- `mkdir`: `true`

Dev script updated to set `LOG_LEVEL=debug`:
```
"dev": "LOG_LEVEL=debug tsx watch src/index.ts"
```

`LOG_LEVEL` env var continues to override the level for any deployment.

### Electron Main Process

New file: `packages/desktop/src/main/logger.ts`

A fresh `pino` instance with its own `pino-roll` transport pointing to `~/.mainframe/logs/main.log`. Same daily rotation, 7-day retention. Replaces all `console.*` calls in `packages/desktop/src/main/index.ts`.

Dependencies added to `@mainframe/desktop`: `pino`, `pino-roll`.

### Renderer (IPC Bridge)

**Preload** (`packages/desktop/src/preload/index.ts`): expose a new `log` method:
```ts
log: (level: string, module: string, message: string, data?: unknown) =>
  ipcRenderer.send('log', level, module, message, data)
```

**Renderer logger** (`packages/desktop/src/renderer/lib/logger.ts`): new file, exports `createLogger(module)` returning `{ info, warn, error, debug }`. Each method calls both `console.*` (visible in DevTools) and `window.mainframe.log(...)` (forwarded to file).

**Main process**: `ipcMain.on('log', ...)` handler receives renderer events and writes them to a pino-roll instance pointing to `~/.mainframe/logs/renderer.log`. Same daily rotation, 7-day retention.

**Global type** (`packages/desktop/src/renderer/types/global.d.ts`): add `log` to `MainframeAPI`.

## Log Coverage

### INFO — User Actions (Daemon)

| File | Method | Message |
|---|---|---|
| `chat/lifecycle-manager.ts` | `createChat` | `'chat created'` with `{ chatId, projectId, adapterId }` |
| `chat/lifecycle-manager.ts` | `doStartChat` | `'chat started'` with `{ chatId }` |
| `chat/lifecycle-manager.ts` | `archiveChat` | `'chat archived'` with `{ chatId }` |
| `chat/chat-manager.ts` | `sendMessage` | `'user message sent'` with `{ chatId }` |
| `chat/chat-manager.ts` | `respondToPermission` | `'permission answered'` with `{ chatId, behavior, toolName }` |
| `chat/chat-manager.ts` | `removeProject` | `'project removed'` with `{ projectId }` |
| `server/routes/projects.ts` | `POST /` | `'project added'` with `{ projectId, path }` |
| `server/routes/projects.ts` | `DELETE /:id` | `'project deleted'` with `{ projectId }` |

### DEBUG — Verbose Internals (Daemon)

| File | Event |
|---|---|
| `adapters/claude.ts` | Adapter process spawned (args, chatId) |
| `adapters/claude.ts` | Adapter process killed |
| `chat/event-handler.ts` | Event received from adapter (type, chatId) |
| `server/websocket.ts` | WebSocket event dispatched to client (type, chatId) |

### Electron Main (INFO, replaces `console.*`)

- App ready
- Window created
- Daemon process started / exited with code
- IPC handler errors (blocked path reads, etc.)

### Renderer (INFO/WARN, replaces `console.*`)

- `hooks/useDaemon.ts`: permission received, daemon error events, adapter fetch failures
- `hooks/useDaemon.ts` (useChat): permission responded, message/permission fetch failures

## Files Changed

### New Files
- `packages/desktop/src/main/logger.ts` — Electron main process pino logger
- `packages/desktop/src/renderer/lib/logger.ts` — renderer logger (console + IPC bridge)

### Modified Files
- `packages/core/src/logger.ts` — add pino-roll file transport
- `packages/core/package.json` — add `pino-roll` dependency; update dev script
- `packages/desktop/package.json` — add `pino`, `pino-roll` dependencies
- `packages/desktop/src/main/index.ts` — replace `console.*`, add `ipcMain.on('log')` renderer handler
- `packages/desktop/src/preload/index.ts` — expose `log` IPC call
- `packages/desktop/src/renderer/types/global.d.ts` — add `log` to `MainframeAPI`
- `packages/core/src/chat/chat-manager.ts` — add INFO logs for user actions
- `packages/core/src/chat/lifecycle-manager.ts` — add INFO logs for lifecycle events
- `packages/core/src/server/routes/projects.ts` — add INFO logs for project CRUD
- `packages/core/src/adapters/claude.ts` — add DEBUG logs for process spawn/kill
- `packages/core/src/chat/event-handler.ts` — add DEBUG logs for adapter events
- `packages/core/src/server/websocket.ts` — add DEBUG logs for WS dispatch

## Constraints

- No tight-loop DEBUG logs (no per-iteration logging without a meaningful timeout between steps).
- No `console.log` / `console.error` in `@mainframe/core` — use pino child loggers only.
- `console.warn` with a tag is acceptable in renderer/desktop code where pino is unavailable.
- `pino-roll` uses worker threads — verify it builds correctly through electron-vite's rollup for the main process. If not, fall back to a simple async `fs.appendFile` writer for the main logger.
