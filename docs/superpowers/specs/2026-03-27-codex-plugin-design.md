# Codex Builtin Plugin Design

Builtin adapter plugin for the OpenAI Codex CLI, using the `codex app-server` JSON-RPC 2.0 protocol over stdio.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Integration mode | `codex app-server` (child process, JSON-RPC over stdio) | Interactive approvals, streaming deltas, full thread management. Well-documented protocol with generated type schemas. |
| Type strategy | Hand-written subset | Only ~20 types needed for v1 scope. Generated types can replace later if surface area grows. |
| Plugin type | Builtin (like Claude) | First-party provider, loaded via `pluginManager.loadBuiltin()`. |
| Model listing | Spawn temporary app-server, call `model/list` | No hardcoded fallback. Always returns the real model list from the running binary. |
| Approval flow | Server-initiated JSON-RPC requests → `sink.onPermission` → `respondToPermission` → JSON-RPC response | Maps cleanly to Mainframe's existing permission queue UX. |
| `setModel()` | Store and apply on next turn | App-server has no live model switch on a running thread. |

## Scope

### Must have (v1)

- Spawn `codex app-server`, JSON-RPC handshake (`initialize` → `initialized`)
- Send messages via `thread/start` + `turn/start` (first message) and `turn/start` (follow-ups)
- Resume sessions via `thread/resume`
- Streaming events: text (`agentMessage`), thinking (`reasoning`), tool use + results (`commandExecution`, `fileChange`, `mcpToolCall`)
- Interactive approvals (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`)
- Kill and interrupt (`turn/interrupt`)
- Model listing via `model/list`
- External session discovery via `thread/list`
- History loading via `thread/read`
- Permission mode mapping (Mainframe → Codex)

### Deferred (with TODO comments in code)

- `getContextFiles` — Codex equivalent of CLAUDE.md/AGENTS.md reading
- `listSkills`, `createSkill`, `updateSkill`, `deleteSkill`
- `listAgents`, `createAgent`, `updateAgent`, `deleteAgent`
- `listCommands`
- `extractPlanFiles`, `extractSkillFiles`
- `thread/fork`
- `thread/compact/start` (trigger compaction)
- `turn/diff/updated` — cumulative git diff of changes per turn. Related to our file change tracking / `context.updated` event. Could power a "changes this turn" diff view.
- `turn/plan/updated` — structured plan/todo data from the agent. Related to our Plans panel. Could feed structured plan state directly.
- `sendCommand()` — needs investigation into Codex skills/apps as potential equivalents to Claude slash commands

`thread/compacted` is wired to `sink.onCompact()` since we already support it.

## Architecture

### File structure

```
packages/core/src/plugins/builtin/codex/
├── manifest.json          # { id: "codex", capabilities: ["adapters", "process:exec"] }
├── index.ts               # activate(ctx) — register adapter + onUnload cleanup
├── adapter.ts             # CodexAdapter implements Adapter
├── session.ts             # CodexSession implements AdapterSession
├── jsonrpc.ts             # JsonRpcClient — JSONL framing, request tracking, dispatch
├── event-mapper.ts        # App-server notifications → SessionSink callbacks
├── approval-handler.ts    # Server-initiated approval requests → sink.onPermission
├── types.ts               # Hand-written JSON-RPC + app-server type subset
└── history.ts             # thread/read results → ChatMessage[]
```

### Data flow

```
codex app-server (child process)
    ↕ JSON-RPC 2.0 over stdio (JSONL)
JsonRpcClient
    ↓ dispatches by message shape
event-mapper.ts  ←  notifications (no id: item/*, turn/*, thread/*)
approval-handler.ts  ←  server requests (has id: item/*/requestApproval)
    ↓ both call
SessionSink callbacks (onMessage, onPermission, onResult, etc.)
```

## Components

### `manifest.json`

```json
{
  "id": "codex",
  "name": "Codex",
  "version": "1.0.0",
  "description": "OpenAI Codex adapter via app-server protocol",
  "capabilities": ["adapters", "process:exec"],
  "adapter": {
    "binaryName": "codex",
    "displayName": "Codex"
  }
}
```

### `index.ts`

```ts
export function activate(ctx: PluginContext): void {
  const adapter = new CodexAdapter();
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
}
```

### `CodexAdapter` (`adapter.ts`)

Implements `Adapter` interface.

- `id = 'codex'`, `name = 'Codex'`
- `isInstalled()` — `execFile('codex', ['--version'])`, returns `true` on exit 0
- `getVersion()` — parses semver from `codex --version` stdout
- `listModels()` — spawns a temporary app-server, handshake, `model/list`, close
- `createSession(options)` — instantiates `CodexSession`, tracks in `Set<CodexSession>`
- `killAll()` — kills all tracked sessions
- `getToolCategories()` — `{ explore: new Set(), hidden: new Set(), progress: new Set(['todo_list']), subagent: new Set() }`
- `listExternalSessions(projectPath)` — spawns temporary app-server, `thread/list` filtered by `cwd`, maps to `ExternalSession[]`, closes server

Not implemented (v1) — each with `// TODO: implement` comment:
- `getContextFiles`
- `listSkills`, `createSkill`, `updateSkill`, `deleteSkill`
- `listAgents`, `createAgent`, `updateAgent`, `deleteAgent`
- `listCommands`

### `CodexSession` (`session.ts`)

Implements `AdapterSession` interface.

**State:**

```ts
interface CodexSessionState {
  threadId: string | null;     // set after thread/start or thread/resume
  currentTurnId: string | null; // set on turn/start, cleared on turn/completed
  model: string | undefined;   // pending model, applied on next turn
  permissionMode: string;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
}
```

**Lifecycle:**

1. `spawn(options, sink)` — starts `codex app-server` child process, creates `JsonRpcClient`, performs `initialize` → `initialized` handshake. Stores options. Creates `ApprovalHandler` with the sink. Status becomes `'ready'`.

2. `sendMessage(content, images?)` — three paths:
   - **First message, new chat:** `thread/start` (with model, cwd, approvalPolicy, sandbox) → store threadId → `turn/start` with user input
   - **First message, resumed chat:** `thread/resume` (with stored chatId as threadId) → store threadId → `turn/start` with user input
   - **Follow-up message:** `turn/start` on existing thread

3. `kill()` — calls `approvalHandler.rejectAll()`, then `client.close()`

4. `interrupt()` — sends `turn/interrupt` with current threadId and turnId

5. `respondToPermission(response)` — delegates to `approvalHandler.resolve(response)`

6. `setModel(model)` — stores model, applied on next `turn/start`

7. `setPermissionMode(mode)` — stores mode, applied on next `turn/start` (the `approvalPolicy` and `sandboxPolicy` fields on `turn/start` override for that turn and all subsequent turns)

8. `loadHistory()` — spawns temporary app-server, `thread/read` with `includeTurns: true`, converts via `history.ts`, closes server

9. `sendCommand()` — no-op for v1 (needs investigation — Codex may have equivalent functionality via skills or apps)

**Process env:**

```ts
{
  FORCE_COLOR: '0',
  NO_COLOR: '1',
}
```

Authentication is handled by the Codex CLI itself (`~/.codex/config.toml` or `codex login`). The app-server inherits the CLI's auth config — Mainframe does not manage API keys.

**Permission mode mapping:**

| Mainframe | `approvalPolicy` | `sandbox` | `collaborationMode` |
|-----------|-------------------|-----------|---------------------|
| `default` | `on-request` | `workspace-write` | `{ mode: 'default', settings: { ... } }` |
| `plan` | `on-request` | `workspace-write` | `{ mode: 'plan', settings: { ... } }` |
| `yolo` | `never` | `danger-full-access` | `{ mode: 'default', settings: { ... } }` |

Note: `plan` is a session/collaboration mode, not a permission mode. In Codex it maps to a separate `collaborationMode` field on `TurnStartParams` (orthogonal to `approvalPolicy` and `sandbox`). The `collaborationMode` is passed on `turn/start` and is sticky for subsequent turns. Setting `developer_instructions: null` in the settings uses Codex's built-in plan mode system prompt.

**Plan mode transition:** Unlike Claude (which sends an `ExitPlanMode` control_request for the user to approve), Codex plan mode produces a plan via `turn/plan/updated` notifications and completes the turn. The user then decides to proceed by sending a follow-up message. The adapter handles the mode transition by switching `collaborationMode` to `{ mode: 'default' }` on the next `turn/start` when the permission mode changes from `plan` to `default`. The existing `PlanModeHandler` in Mainframe is Claude-specific and does not apply to Codex sessions.

### `JsonRpcClient` (`jsonrpc.ts`)

Thin JSON-RPC 2.0 client over a child process stdio.

```ts
class JsonRpcClient {
  constructor(process: ChildProcess, handlers: {
    onNotification: (method: string, params: unknown) => void;
    onRequest: (method: string, params: unknown, id: RequestId) => void;
    onError: (error: string) => void;
    onExit: (code: number | null) => void;
  });

  request<T>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  respond(id: RequestId, result: unknown): void;
  close(): void;
}
```

- Line-buffered JSONL parsing on stdout (same approach as Claude adapter's `handleStdout`)
- Auto-incrementing integer `id` for outgoing requests
- Pending requests tracked in `Map<RequestId, { resolve, reject, timer }>`
- Incoming messages dispatched by shape:
  - Has `id` + has `method` → server-initiated request → `onRequest`
  - Has `id` + has `result`/`error` → response to our request → resolve/reject pending
  - Has `method` + no `id` → notification → `onNotification`
- Request timeout: 30s default, rejects with timeout error
- `close()` — kills child process, rejects all pending requests
- Stderr: filter Rust runtime warnings, forward rest to `onError`
- JSON parse errors: `log.warn`, skip the line
- Handshake timeout: 10s, kills process and calls `onError`

### Event Mapper (`event-mapper.ts`)

Maps app-server notifications to `SessionSink` callbacks.

```ts
function handleNotification(method: string, params: unknown, sink: SessionSink, state: CodexSessionState): void
```

| Notification | Action |
|---|---|
| `thread/started` | `sink.onInit(params.thread.id)`, store `state.threadId` |
| `item/completed` → `agentMessage` | `sink.onMessage([{ type: 'text', text: item.text }])` |
| `item/completed` → `reasoning` | `sink.onMessage([{ type: 'thinking', thinking: item.text }])` |
| `item/completed` → `commandExecution` | `sink.onMessage([{ type: 'tool_use', id, name: 'command_execution', input: { command } }])` then `sink.onToolResult([{ type: 'tool_result', toolUseId: id, content: aggregated_output, isError: exit_code !== 0 }])` |
| `item/completed` → `fileChange` | `sink.onMessage([{ type: 'tool_use', id, name: 'file_change', input: { changes } }])` then `sink.onToolResult([{ type: 'tool_result', toolUseId: id, content: 'applied', isError: status === 'failed' }])` |
| `item/completed` → `mcpToolCall` | `sink.onMessage([{ type: 'tool_use', id, name: item.tool, input: item.arguments }])` then `sink.onToolResult([{ type: 'tool_result', toolUseId: id, content: item.result, isError: !!item.error }])` |
| `item/agentMessage/delta` | Accumulate in per-item buffer. Do NOT call `sink.onMessage` per delta — `onMessage` creates a `ChatMessage` each call, so deltas would create duplicates. The full text is emitted from `item/completed`. |
| `turn/completed` | `sink.onResult({ total_cost_usd: 0, usage: params.turn.usage, subtype: statusToSubtype(params.turn.status) })`, clear `state.currentTurnId` |
| `turn/failed` | `sink.onResult({ subtype: 'error_during_execution', is_error: true })` |
| `turn/started` | Store `state.currentTurnId` |
| `thread/compacted` | `sink.onCompact()` |
| `thread/closed` | no-op (process exit handles cleanup) |
| `turn/diff/updated` | `// TODO: future — map to file change tracking / context.updated` |
| `turn/plan/updated` | `// TODO: future — map to Plans panel structured plan state` |

### Approval Handler (`approval-handler.ts`)

Maps server-initiated approval requests to Mainframe's permission flow.

```ts
class ApprovalHandler {
  constructor(sink: SessionSink);

  handleRequest(method: string, params: unknown, requestId: RequestId, respond: RespondFn): void;
  resolve(response: ControlResponse): void;
  rejectAll(): void;
}
```

**Inbound (server → Mainframe):**

Server sends `item/commandExecution/requestApproval` or `item/fileChange/requestApproval`. Handler:
1. Generates a Mainframe `requestId` (nanoid)
2. Builds a `ControlRequest` with `subtype: 'can_use_tool'`
   - For command execution: `toolName = 'command_execution'`, `input = { command, cwd }`
   - For file change: `toolName = 'file_change'`, `input = { reason }`
3. Stores `{ mainframeRequestId, jsonRpcId, respond }` in pending map
4. Calls `sink.onPermission(request)`

**Outbound (Mainframe → server):**

`resolve(response)` looks up pending entry by `response.requestId`, maps to Codex decision:

| `ControlResponse.behavior` | Codex `decision` |
|---|---|
| `'allow'` | `'accept'` |
| `'allowAlways'` | `'acceptForSession'` |
| `'deny'` | `'decline'` |

Calls `respond(jsonRpcId, { decision })` to send the JSON-RPC response.

`rejectAll()` sends `'decline'` for all pending approvals. Called during `kill()`.

### History (`history.ts`)

Converts `thread/read` results to `ChatMessage[]`.

```ts
function convertThreadItems(items: ThreadItem[], chatId: string): ChatMessage[]
```

| Item type | ChatMessage |
|---|---|
| `agentMessage` | `{ type: 'assistant', content: [{ type: 'text', text }] }` |
| `reasoning` | `{ type: 'assistant', content: [{ type: 'thinking', thinking }] }` |
| `commandExecution` | `{ type: 'assistant', content: [{ type: 'tool_use', ... }] }` + `{ type: 'tool_result', ... }` |
| `fileChange` | Same pattern as command execution |
| `mcpToolCall` | Same pattern as command execution |
| `userMessage` | `{ type: 'user', content: [{ type: 'text', text }] }` |

### Types (`types.ts`)

Hand-written subset:

**JSON-RPC framing:**
- `RequestId = string | number`
- `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`, `JsonRpcNotification`
- `JsonRpcMessage` — discriminated union of all four

**Initialize:**
- `InitializeParams` — `{ clientInfo: { name, title, version }, capabilities?: { experimentalApi? } }`
- `InitializeResult` — `{ userAgent, codexHome }`

**Thread:**
- `ThreadStartParams` — `{ model?, cwd?, approvalPolicy?, sandbox? }`
- `ThreadStartResult` — `{ thread: { id } }`
- `ThreadResumeParams` — `{ threadId, model?, cwd? }`
- `ThreadResumeResult` — `{ thread: { id } }`
- `ThreadReadParams` — `{ threadId, includeTurns? }`
- `ThreadReadResult` — `{ thread: { id, turns?: Turn[] } }`
- `ThreadListParams` — `{ cwd?, archived? }`
- `ThreadListResult` — `{ threads: ThreadSummary[] }`

**Turn:**
- `TurnStartParams` — `{ threadId, input: UserInput[] }`
- `TurnStartResult` — `{ turn: { id, status } }`
- `TurnInterruptParams` — `{ threadId, turnId }`
- `TurnStatus = 'running' | 'completed' | 'interrupted' | 'failed'`

**Items:**
- `ThreadItem` — discriminated union on `type`:
  - `AgentMessageItem` — `{ id, type: 'agentMessage', text }`
  - `ReasoningItem` — `{ id, type: 'reasoning', text }`
  - `CommandExecutionItem` — `{ id, type: 'commandExecution', command, aggregated_output, exit_code?, status }`
  - `FileChangeItem` — `{ id, type: 'fileChange', changes: { path, kind }[], status }`
  - `McpToolCallItem` — `{ id, type: 'mcpToolCall', server, tool, arguments, result?, error?, status }`
  - `WebSearchItem` — `{ id, type: 'webSearch', query }`
  - `TodoListItem` — `{ id, type: 'todoList', items: { text, completed }[] }`
  - `UserMessageItem` — `{ id, type: 'userMessage', text }`

**Approvals:**
- `CommandExecutionApprovalParams` — `{ threadId, turnId, itemId, command?, cwd?, reason? }`
- `FileChangeApprovalParams` — `{ threadId, turnId, itemId, reason? }`
- `ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'`

**Events:**
- `ThreadStartedParams` — `{ thread: { id } }`
- `ItemStartedParams` — `{ threadId, turnId, item: ThreadItem }`
- `ItemCompletedParams` — `{ threadId, turnId, item: ThreadItem }`
- `AgentMessageDeltaParams` — `{ threadId, turnId, itemId, delta: string }`
- `TurnCompletedParams` — `{ threadId, turn: { id, status, items, usage? } }`
- `TurnFailedParams` — `{ threadId, turn: { id, error: { message } } }`

**Config:**
- `ApprovalPolicy = 'never' | 'on-request' | 'untrusted'`
- `SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`
- `CollaborationMode = { mode: 'plan' | 'default', settings: CollaborationModeSettings }`
- `CollaborationModeSettings = { model: string, reasoning_effort?: string | null, developer_instructions?: string | null }`
- `ModelInfo = { id: string, name?: string }`
- `ModelListResult = { models: ModelInfo[] }`

**User input:**
- `UserInput = TextInput | LocalImageInput`
- `TextInput = { type: 'text', text: string }`
- `LocalImageInput = { type: 'localImage', path: string }`

**Usage:**
- `Usage = { input_tokens: number, cached_input_tokens?: number, output_tokens: number }`

## Registration

In `packages/core/src/index.ts`:

```ts
import codexManifest from './plugins/builtin/codex/manifest.json' with { type: 'json' };
import { activate as activateCodex } from './plugins/builtin/codex/index.js';

await pluginManager.loadBuiltin(codexManifest as PluginManifest, activateCodex);
```

## Error Handling

| Scenario | Behavior |
|---|---|
| JSON parse error on stdout | `log.warn`, skip line |
| JSON-RPC error response | Reject pending request promise with typed error |
| Child process exit | `sink.onExit(code)`, reject all pending requests |
| Stderr output | Filter Rust runtime warnings, log rest via `log.warn` |
| Handshake timeout (10s) | Kill process, `sink.onError('handshake timeout')` |
| Request timeout (30s) | Reject with timeout error |
| Approval for killed session | `rejectAll()` sends `'decline'` for all pending |

## Modified Files

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Add codex manifest import + `loadBuiltin` call |

No changes to shared types — `Adapter`, `AdapterSession`, `SessionSink` interfaces are sufficient as-is.
