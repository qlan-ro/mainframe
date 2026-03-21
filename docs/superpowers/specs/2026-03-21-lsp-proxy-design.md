# LSP Proxy Design

Daemon-hosted LSP proxy that spawns language servers as child processes and forwards JSON-RPC over WebSocket to Monaco in the desktop app.

## Requirements

- Support TypeScript, Python, and Java (extensible to more languages)
- Bundle `typescript-language-server` and `pyright` as npm dependencies; expect `jdtls` pre-installed
- Lazy-start LSP servers on first need, auto-kill after 10 minutes idle
- Dedicated WebSocket endpoint per (project, language) — no mixing with chat traffic
- Thin proxy: daemon forwards bytes, desktop owns LSP client logic
- Enable Monaco features: go-to-definition, find-references, hover, completions, rename
- Expose `workspace/symbol` for project-wide symbol search (Cmd+P style)

## Architecture

```
Monaco ←→ monaco-languageclient ←→ WebSocket ←→ Daemon LSP proxy ←→ LSP server (stdio)
```

```mermaid
graph LR
    Monaco[Monaco Editor] -->|JSON-RPC over WS| Proxy[Daemon LSP Proxy]
    SymSearch[Symbol Search UI] -->|sendRequest| LspClient[LspClientManager]
    LspClient -->|JSON-RPC over WS| Proxy
    Proxy -->|stdin/stdout| TSServer[typescript-language-server]
    Proxy -->|stdin/stdout| Pyright[pyright]
    Proxy -->|stdin/stdout| JDTLS[jdtls]
```

## Daemon: `packages/core/src/lsp/`

### `lsp-registry.ts` — Language → server config mapping

```ts
interface LspServerConfig {
  id: string;                    // 'typescript', 'python', 'java'
  languages: string[];           // file extensions: ['.ts', '.tsx', '.js', '.jsx']
  command: string;               // 'typescript-language-server' or resolved path
  args: string[];                // ['--stdio']
  bundled: boolean;              // true = resolve from node_modules
}
```

Three entries:

| Language | Server | Bundled | Command |
|----------|--------|---------|---------|
| TypeScript/JS | `typescript-language-server` | Yes | `node <resolved-path> --stdio` |
| Python | `pyright` | Yes | `node <resolved-path> --stdio` |
| Java | `jdtls` | No | `jdtls` (PATH lookup) |

Bundled servers resolve their entry point via `require.resolve()`. External servers are located via `which`/`command -v`.

### `lsp-manager.ts` — Lifecycle management

`LspManager` class responsibilities:

- Maintains `Map<string, LspServerHandle>` keyed by `${projectId}:${language}`
- `getOrSpawn(projectId, language, projectPath): Promise<LspServerHandle>` — returns existing or spawns new
- `shutdown(projectId, language)` — kills a specific server
- `shutdownAll()` — called on daemon shutdown
- `handleUpgrade(projectId, language, request, socket, head)` — handles WS upgrade for LSP connections
- `getAvailableLanguages()` — returns which LSP servers are installed

`LspServerHandle` holds:

```ts
interface LspServerHandle {
  process: ChildProcess;
  language: string;
  projectPath: string;
  connectedClients: Set<WebSocket>;
  idleTimer: NodeJS.Timeout | null;
}
```

**Spawn race prevention:** Uses `Map<string, Promise<LspServerHandle>>` for in-flight spawns. Second concurrent caller awaits the same promise.

**Idle timeout:** 10-minute timer starts when last WS client disconnects. Any new connection cancels the timer. On timeout, the process is killed and the handle removed.

### `lsp-proxy.ts` — WebSocket ↔ stdio forwarding

Bidirectional JSON-RPC forwarding:

- **WS → stdin:** Reads JSON-RPC messages from WebSocket, wraps with `Content-Length` header, writes to process stdin
- **stdout → WS:** Parses `Content-Length`-framed messages from process stdout, forwards raw JSON to WebSocket
- **stderr:** Logged via pino, not forwarded

On WS close: decrements client count on the handle. If zero clients remain, starts the idle timer.

On process exit/error: closes all connected WebSockets, removes handle from manager, logs crash details.

### WebSocket routing

Changes to `websocket.ts` `setupUpgradeAuth`:

- After auth validation, inspect `request.url`
- If path matches `/lsp/:projectId/:language` → `lspManager.handleUpgrade(projectId, language, request, socket, head)`
- Otherwise → existing `this.wss.handleUpgrade(...)` for chat traffic

LSP WebSocket connections are completely separate from chat WebSocket — different instances, no shared message parsing.

### REST endpoint

`GET /api/lsp/languages?projectId=xxx`

Returns:

```json
{
  "languages": [
    { "id": "typescript", "installed": true, "active": true },
    { "id": "python", "installed": true, "active": false },
    { "id": "java", "installed": false, "active": false }
  ]
}
```

Desktop uses this to show language availability and can hint users to install missing servers.

### Server initialization and shutdown

- `LspManager` is created in `createServerManager` alongside `WebSocketManager`
- Passed to `WebSocketManager` constructor for upgrade routing
- `createServerManager.stop()` calls `lspManager.shutdownAll()` alongside existing cleanup

## Desktop: `packages/desktop/src/renderer/lib/lsp/`

### `lsp-client.ts` — LSP client manager

`LspClientManager` class:

- Maintains `Map<string, MonacoLanguageClient>` keyed by `${projectId}:${language}`
- `ensureClient(projectId, language): Promise<MonacoLanguageClient>`:
  1. Returns existing client if connected
  2. Opens WebSocket to `ws://localhost:${DAEMON_PORT}/lsp/${projectId}/${language}`
  3. Wraps with `toSocket()` → `WebSocketMessageReader`/`WebSocketMessageWriter` (from `vscode-ws-jsonrpc`)
  4. Creates `MonacoLanguageClient` with reader/writer
  5. Client sends LSP `initialize` with `rootUri` set to project path
  6. Registers language feature providers with Monaco
- `disposeClient(projectId, language)` — tears down connection and deregisters providers
- `disposeAll()` — cleanup on app unmount

On WS close/error: removes client from map silently. Next Monaco interaction triggers lazy re-creation.

### `language-detection.ts` — File extension → LSP language mapping

Consolidates the existing extension → language mapping from `EditorTab.tsx`. Adds reverse lookup: given a file path, returns which LSP server ID to request.

```ts
function getLspLanguage(filePath: string): string | null
// '.ts' → 'typescript', '.py' → 'python', '.java' → 'java', '.rs' → null
```

### Monaco integration

`MonacoEditor.tsx` changes:

- On mount or when `filePath` changes, calls `lspClientManager.ensureClient(projectId, detectedLanguage)` for supported languages
- `monaco-languageclient` automatically registers providers (completion, hover, definition, references, rename, etc.)
- The existing custom `navigation.ts` definition provider becomes a fallback for languages without LSP support

### Symbol search

New hook or component for project-wide symbol search:

- Calls `client.sendRequest('workspace/symbol', { query })` on all active LSP clients for the current project
- Aggregates results across languages
- Renders in a command palette / picker UI
- Triggered by keyboard shortcut (Cmd+P or similar)

## Package dependencies

### `packages/core/package.json`

New dependencies:
- `typescript-language-server` — bundled LSP server for TS/JS
- `typescript` — peer dependency of the above (may already exist in monorepo)
- `pyright` — bundled LSP server for Python

### `packages/desktop/package.json`

New dependencies:
- `monaco-languageclient` — connects Monaco editor to LSP
- `vscode-ws-jsonrpc` — WebSocket ↔ JSON-RPC message framing

## Error handling

### LSP server crashes

- `lsp-proxy.ts` listens for `exit`/`error` on the child process
- On crash: closes all connected WebSockets with error close code, removes handle from `LspManager`
- Logged with pino (`logger.error`) including exit code and stderr tail
- Next interaction from Monaco triggers fresh `ensureClient` → new WS → daemon re-spawns

### Project path validation

- `LspManager.handleUpgrade` validates `projectId` against DB, rejects with 404 if unknown
- Validates project path exists on disk before spawning
- Uses `resolveAndValidatePath()` per existing code rules

### Concurrent spawn race

- Two tabs opening `.ts` files simultaneously for the same project
- `getOrSpawn` uses in-flight promise map — second caller awaits same promise, no double-spawn

### Desktop reconnection

- Daemon restart drops all LSP WebSocket connections
- `LspClientManager` detects WS close, removes client from map
- Next Monaco interaction triggers `ensureClient` again — fully lazy, no reconnect loop

### Missing LSP server (jdtls)

- `GET /api/lsp/languages` reports Java as `installed: false`
- Desktop can show a hint to the user
- Opening `.java` files works normally, just without LSP features — no error, no broken UI

## New files

| File | Package | Purpose |
|------|---------|---------|
| `src/lsp/lsp-registry.ts` | core | Language → server config mapping |
| `src/lsp/lsp-manager.ts` | core | LSP server lifecycle (spawn, cache, idle kill) |
| `src/lsp/lsp-proxy.ts` | core | WebSocket ↔ stdio JSON-RPC forwarding |
| `src/lsp/index.ts` | core | Public exports |
| `src/server/routes/lsp-routes.ts` | core | `GET /api/lsp/languages` endpoint |
| `src/renderer/lib/lsp/lsp-client.ts` | desktop | MonacoLanguageClient manager |
| `src/renderer/lib/lsp/language-detection.ts` | desktop | File extension → LSP language mapping |
| `src/renderer/lib/lsp/index.ts` | desktop | Public exports |

## Modified files

| File | Change |
|------|--------|
| `packages/core/src/server/websocket.ts` | Route `/lsp/` upgrades to LspManager |
| `packages/core/src/server/index.ts` | Create LspManager, wire to WebSocketManager, shutdown |
| `packages/core/src/server/http.ts` | Mount lsp-routes |
| `packages/core/package.json` | Add typescript-language-server, typescript, pyright |
| `packages/desktop/package.json` | Add monaco-languageclient, vscode-ws-jsonrpc |
| `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx` | Call ensureClient on file open |
| `packages/desktop/src/renderer/components/editor/navigation.ts` | Fallback-only for non-LSP languages |
