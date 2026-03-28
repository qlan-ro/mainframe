# Codex Builtin Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a builtin adapter plugin for the OpenAI Codex CLI, using the `codex app-server` JSON-RPC 2.0 protocol over stdio for interactive approvals and streaming events.

**Architecture:** Spawn `codex app-server` as a child process, speak JSON-RPC 2.0 (JSONL) over stdin/stdout. A `JsonRpcClient` handles framing and request tracking. Notifications are dispatched to an event mapper (→ `SessionSink`), server-initiated requests to an approval handler (→ `sink.onPermission`). The plugin registers as a builtin adapter alongside the existing Claude adapter.

**Tech Stack:** TypeScript, Node.js child_process, JSON-RPC 2.0, vitest

**Spec:** `docs/superpowers/specs/2026-03-27-codex-plugin-design.md`

---

## File Structure

All new files live under `packages/core/src/plugins/builtin/codex/`:

| File | Responsibility |
|---|---|
| `manifest.json` | Plugin identity, capabilities declaration |
| `index.ts` | `activate(ctx)` — register adapter, wire cleanup |
| `types.ts` | Hand-written JSON-RPC + Codex app-server type subset |
| `jsonrpc.ts` | `JsonRpcClient` — JSONL framing, request/response tracking, dispatch |
| `event-mapper.ts` | Map app-server notifications → `SessionSink` callbacks |
| `approval-handler.ts` | Map server-initiated approval requests → `sink.onPermission`, resolve responses |
| `session.ts` | `CodexSession implements AdapterSession` — spawn, send, kill, approve |
| `adapter.ts` | `CodexAdapter implements Adapter` — model list, install check, session factory |
| `history.ts` | Convert `thread/read` items → `ChatMessage[]` |

Modified:
| File | Change |
|---|---|
| `packages/core/src/index.ts` | Import + `loadBuiltin` for codex plugin |

Test files:
| File | Tests for |
|---|---|
| `packages/core/src/__tests__/codex-types.test.ts` | Type guard functions |
| `packages/core/src/__tests__/codex-jsonrpc.test.ts` | JsonRpcClient framing, dispatch, timeouts |
| `packages/core/src/__tests__/codex-event-mapper.test.ts` | Notification → SessionSink mapping |
| `packages/core/src/__tests__/codex-approval-handler.test.ts` | Approval request/response flow |
| `packages/core/src/__tests__/codex-session.test.ts` | Session lifecycle, message sending, permission mode |
| `packages/core/src/__tests__/codex-adapter.test.ts` | Adapter registration, isInstalled, createSession |
| `packages/core/src/__tests__/codex-history.test.ts` | Thread item → ChatMessage conversion |

---

### Task 1: Types (`types.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/types.ts`
- Test: `packages/core/src/__tests__/codex-types.test.ts`

- [ ] **Step 1: Write the type guard tests**

```ts
// packages/core/src/__tests__/codex-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  isJsonRpcResponse,
  isJsonRpcError,
  isJsonRpcNotification,
  isJsonRpcServerRequest,
} from '../plugins/builtin/codex/types.js';

describe('JSON-RPC message type guards', () => {
  it('identifies a response (has id + result)', () => {
    expect(isJsonRpcResponse({ id: 1, result: { thread: { id: 'thr_1' } } })).toBe(true);
  });

  it('identifies an error (has id + error)', () => {
    expect(isJsonRpcError({ id: 1, error: { code: -32600, message: 'Invalid' } })).toBe(true);
  });

  it('identifies a notification (has method, no id)', () => {
    expect(isJsonRpcNotification({ method: 'thread/started', params: {} })).toBe(true);
  });

  it('identifies a server request (has method + id)', () => {
    expect(isJsonRpcServerRequest({ id: 5, method: 'item/commandExecution/requestApproval', params: {} })).toBe(true);
  });

  it('does not confuse response with server request', () => {
    expect(isJsonRpcServerRequest({ id: 1, result: {} })).toBe(false);
  });

  it('does not confuse notification with response', () => {
    expect(isJsonRpcResponse({ method: 'turn/started', params: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write types.ts**

```ts
// packages/core/src/plugins/builtin/codex/types.ts

// --- JSON-RPC 2.0 framing ---

export type RequestId = string | number;

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: RequestId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  id: RequestId;
  error: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcServerRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcErrorResponse | JsonRpcNotification | JsonRpcServerRequest;

export function isJsonRpcResponse(msg: Record<string, unknown>): msg is JsonRpcResponse {
  return 'id' in msg && 'result' in msg;
}

export function isJsonRpcError(msg: Record<string, unknown>): msg is JsonRpcErrorResponse {
  return 'id' in msg && 'error' in msg;
}

export function isJsonRpcNotification(msg: Record<string, unknown>): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

export function isJsonRpcServerRequest(msg: Record<string, unknown>): msg is JsonRpcServerRequest {
  return 'method' in msg && 'id' in msg;
}

// --- Initialize ---

export interface InitializeParams {
  clientInfo: { name: string; title: string; version: string };
  capabilities?: { experimentalApi?: boolean };
}

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
}

// --- Thread ---

export interface ThreadStartParams {
  model?: string;
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxMode;
}

export interface ThreadStartResult {
  thread: { id: string };
}

export interface ThreadResumeParams {
  threadId: string;
  model?: string;
  cwd?: string;
}

export interface ThreadResumeResult {
  thread: { id: string };
}

export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface ThreadReadResult {
  thread: {
    id: string;
    turns?: Array<{ id: string; status: TurnStatus; items: ThreadItem[] }>;
  };
}

export interface ThreadListParams {
  cwd?: string;
  archived?: boolean;
}

export interface ThreadSummary {
  id: string;
  name?: string;
  cwd?: string;
  model?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface ThreadListResult {
  threads: ThreadSummary[];
}

// --- Turn ---

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  approvalPolicy?: ApprovalPolicy;
  sandboxPolicy?: SandboxPolicy;
  collaborationMode?: CollaborationMode;
  model?: string;
}

export interface TurnStartResult {
  turn: { id: string; status: TurnStatus };
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type TurnStatus = 'running' | 'completed' | 'interrupted' | 'failed';

// --- Items ---

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | UserMessageItem;

export interface AgentMessageItem {
  id: string;
  type: 'agentMessage';
  text: string;
}

export interface ReasoningItem {
  id: string;
  type: 'reasoning';
  text: string;
}

export interface CommandExecutionItem {
  id: string;
  type: 'commandExecution';
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: 'in_progress' | 'completed' | 'failed';
}

export interface FileChangeItem {
  id: string;
  type: 'fileChange';
  changes: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>;
  status: 'completed' | 'failed';
}

export interface McpToolCallItem {
  id: string;
  type: 'mcpToolCall';
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  status: 'in_progress' | 'completed' | 'failed';
}

export interface WebSearchItem {
  id: string;
  type: 'webSearch';
  query: string;
}

export interface TodoListItem {
  id: string;
  type: 'todoList';
  items: Array<{ text: string; completed: boolean }>;
}

export interface UserMessageItem {
  id: string;
  type: 'userMessage';
  text: string;
}

// --- Approvals ---

export interface CommandExecutionApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string;
  cwd?: string;
  reason?: string;
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string;
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

// --- Event notification params ---

export interface ThreadStartedParams {
  thread: { id: string };
}

export interface ItemStartedParams {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface ItemCompletedParams {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface AgentMessageDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface TurnStartedParams {
  threadId: string;
  turn: { id: string };
}

export interface TurnCompletedParams {
  threadId: string;
  turn: {
    id: string;
    status: TurnStatus;
    items: ThreadItem[];
    usage?: Usage;
  };
}

export interface TurnFailedParams {
  threadId: string;
  turn: { id: string; error: { message: string } };
}

// --- Config ---

export type ApprovalPolicy = 'never' | 'on-request' | 'untrusted';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type SandboxPolicy =
  | { type: 'readOnly' }
  | { type: 'workspaceWrite' }
  | { type: 'dangerFullAccess' };

export interface CollaborationMode {
  mode: 'plan' | 'default';
  settings: CollaborationModeSettings;
}

export interface CollaborationModeSettings {
  model: string;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface ModelListResult {
  models: ModelInfo[];
}

// --- User input ---

export type UserInput = TextInput | LocalImageInput;

export interface TextInput {
  type: 'text';
  text: string;
  text_elements?: never[];
}

export interface LocalImageInput {
  type: 'localImage';
  path: string;
}

// --- Usage ---

export interface Usage {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/types.ts packages/core/src/__tests__/codex-types.test.ts
git commit -m "feat(codex): add hand-written JSON-RPC and app-server types"
```

---

### Task 2: Manifest and plugin entry (`manifest.json`, `index.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/manifest.json`
- Create: `packages/core/src/plugins/builtin/codex/index.ts`

- [ ] **Step 1: Create manifest.json**

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

- [ ] **Step 2: Create index.ts**

```ts
// packages/core/src/plugins/builtin/codex/index.ts
import type { PluginContext } from '@qlan-ro/mainframe-types';
import { CodexAdapter } from './adapter.js';

export function activate(ctx: PluginContext): void {
  const adapter = new CodexAdapter();
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
}
```

Note: This won't compile yet — `CodexAdapter` doesn't exist. That's fine; it's created in Task 7. Don't run the build here.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/manifest.json packages/core/src/plugins/builtin/codex/index.ts
git commit -m "feat(codex): add plugin manifest and entry point"
```

---

### Task 3: JsonRpcClient (`jsonrpc.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/jsonrpc.ts`
- Test: `packages/core/src/__tests__/codex-jsonrpc.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/__tests__/codex-jsonrpc.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'node:stream';
import { JsonRpcClient } from '../plugins/builtin/codex/jsonrpc.js';
import type { ChildProcess } from 'node:child_process';

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  Object.assign(proc, { stdin, stdout, stderr, pid: 1234, killed: false });
  proc.kill = vi.fn(() => {
    proc.emit('close', 0);
    return true;
  });
  return proc;
}

function createClient(proc: ChildProcess, overrides: Partial<Parameters<typeof JsonRpcClient['prototype']['constructor']>[1]> = {}) {
  return new JsonRpcClient(proc, {
    onNotification: vi.fn(),
    onRequest: vi.fn(),
    onError: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  });
}

describe('JsonRpcClient', () => {
  it('sends a request and resolves on response', async () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    const promise = client.request<{ thread: { id: string } }>('thread/start', { cwd: '/tmp' });

    // Parse what was written to stdin
    const sent = JSON.parse(written[0]!.trim());
    expect(sent.method).toBe('thread/start');
    expect(sent.params).toEqual({ cwd: '/tmp' });
    expect(typeof sent.id).toBe('number');

    // Simulate server response
    const response = JSON.stringify({ id: sent.id, result: { thread: { id: 'thr_1' } } }) + '\n';
    proc.stdout!.push(response);

    const result = await promise;
    expect(result).toEqual({ thread: { id: 'thr_1' } });
  });

  it('rejects on JSON-RPC error response', async () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    const promise = client.request('model/list');

    const sent = JSON.parse(written[0]!.trim());
    proc.stdout!.push(JSON.stringify({ id: sent.id, error: { code: -32600, message: 'Bad request' } }) + '\n');

    await expect(promise).rejects.toThrow('Bad request');
  });

  it('dispatches notifications to handler', () => {
    const onNotification = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onNotification });

    proc.stdout!.push(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thr_1' } } }) + '\n');

    expect(onNotification).toHaveBeenCalledWith('thread/started', { thread: { id: 'thr_1' } });
  });

  it('dispatches server-initiated requests to handler', () => {
    const onRequest = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onRequest });

    proc.stdout!.push(JSON.stringify({
      id: 99,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'rm -rf /' },
    }) + '\n');

    expect(onRequest).toHaveBeenCalledWith(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'rm -rf /' },
      99,
    );
  });

  it('sends respond() as JSON-RPC response', () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    client.respond(99, { decision: 'accept' });

    const sent = JSON.parse(written[0]!.trim());
    expect(sent).toEqual({ id: 99, result: { decision: 'accept' } });
  });

  it('handles partial chunks by buffering', () => {
    const onNotification = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onNotification });

    const full = JSON.stringify({ method: 'turn/started', params: { threadId: 't1', turn: { id: 'turn1' } } });
    proc.stdout!.push(full.slice(0, 20));
    expect(onNotification).not.toHaveBeenCalled();

    proc.stdout!.push(full.slice(20) + '\n');
    expect(onNotification).toHaveBeenCalledOnce();
  });

  it('rejects all pending requests on close()', async () => {
    const proc = createMockProcess();
    const written: string[] = [];
    proc.stdin!.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    }) as unknown as typeof proc.stdin.write;

    const client = createClient(proc);
    const promise = client.request('thread/start');

    client.close();

    await expect(promise).rejects.toThrow();
  });

  it('skips malformed JSON lines', () => {
    const onNotification = vi.fn();
    const onError = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onNotification, onError });

    proc.stdout!.push('not valid json\n');
    proc.stdout!.push(JSON.stringify({ method: 'turn/started', params: {} }) + '\n');

    expect(onNotification).toHaveBeenCalledOnce();
  });

  it('calls onExit when process closes', () => {
    const onExit = vi.fn();
    const proc = createMockProcess();
    createClient(proc, { onExit });

    proc.emit('close', 1);
    expect(onExit).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-jsonrpc.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write jsonrpc.ts**

```ts
// packages/core/src/plugins/builtin/codex/jsonrpc.ts
import type { ChildProcess } from 'node:child_process';
import {
  isJsonRpcResponse,
  isJsonRpcError,
  isJsonRpcNotification,
  isJsonRpcServerRequest,
} from './types.js';
import type { RequestId } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:jsonrpc');

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface JsonRpcHandlers {
  onNotification: (method: string, params: unknown) => void;
  onRequest: (method: string, params: unknown, id: RequestId) => void;
  onError: (error: string) => void;
  onExit: (code: number | null) => void;
}

export class JsonRpcClient {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<RequestId, PendingRequest>();
  private closed = false;

  constructor(
    private readonly process: ChildProcess,
    private readonly handlers: JsonRpcHandlers,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    process.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    process.stderr?.on('data', (chunk: Buffer) => this.handleStderr(chunk));
    process.on('close', (code: number | null) => {
      this.rejectAllPending(new Error(`Process exited with code ${code}`));
      this.handlers.onExit(code);
    });
    process.on('error', (err: Error) => {
      this.handlers.onError(err.message);
    });
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Client closed'));

    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method };
    if (params !== undefined) msg.params = params;
    this.write(msg);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const msg: Record<string, unknown> = { method };
    if (params !== undefined) msg.params = params;
    this.write(msg);
  }

  respond(id: RequestId, result: unknown): void {
    if (this.closed) return;
    this.write({ id, result });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error('Client closed'));
    try {
      this.process.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  }

  private write(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg) + '\n';
    log.trace({ msg }, 'jsonrpc write');
    this.process.stdin?.write(json);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      log.trace({ line }, 'jsonrpc recv');
      try {
        const msg = JSON.parse(line.trim()) as Record<string, unknown>;
        this.dispatch(msg);
      } catch {
        log.warn({ line: line.slice(0, 200) }, 'jsonrpc: malformed JSON line');
      }
    }
  }

  private static readonly STDERR_NOISE = [
    /^Debugger/i,
    /^Warning:/i,
    /^DeprecationWarning/i,
    /^ExperimentalWarning/i,
    /^\(node:\d+\)/,
    /^thread '.*' panicked/,
  ];

  private handleStderr(chunk: Buffer): void {
    const message = chunk.toString().trim();
    if (!message) return;
    if (JsonRpcClient.STDERR_NOISE.some((p) => p.test(message))) return;
    log.warn({ stderr: message }, 'codex stderr');
    this.handlers.onError(message);
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (isJsonRpcResponse(msg)) {
      const entry = this.pending.get(msg.id as RequestId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id as RequestId);
        entry.resolve(msg.result);
      }
      return;
    }

    if (isJsonRpcError(msg)) {
      const entry = this.pending.get(msg.id as RequestId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id as RequestId);
        entry.reject(new Error((msg.error as { message: string }).message));
      }
      return;
    }

    if (isJsonRpcServerRequest(msg)) {
      this.handlers.onRequest(msg.method as string, msg.params, msg.id as RequestId);
      return;
    }

    if (isJsonRpcNotification(msg)) {
      this.handlers.onNotification(msg.method as string, msg.params);
      return;
    }

    log.warn({ msg }, 'jsonrpc: unrecognized message shape');
  }

  private rejectAllPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-jsonrpc.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/jsonrpc.ts packages/core/src/__tests__/codex-jsonrpc.test.ts
git commit -m "feat(codex): add JSON-RPC 2.0 client over child process stdio"
```

---

### Task 4: Event Mapper (`event-mapper.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/event-mapper.ts`
- Test: `packages/core/src/__tests__/codex-event-mapper.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/__tests__/codex-event-mapper.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleNotification } from '../plugins/builtin/codex/event-mapper.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type { CodexSessionState } from '../plugins/builtin/codex/event-mapper.js';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
  };
}

function createState(): CodexSessionState {
  return { threadId: null, currentTurnId: null };
}

describe('handleNotification', () => {
  it('thread/started sets threadId and calls onInit', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('thread/started', { thread: { id: 'thr_abc' } }, sink, state);
    expect(sink.onInit).toHaveBeenCalledWith('thr_abc');
    expect(state.threadId).toBe('thr_abc');
  });

  it('turn/started stores currentTurnId', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('turn/started', { threadId: 't1', turn: { id: 'turn_1' } }, sink, state);
    expect(state.currentTurnId).toBe('turn_1');
  });

  it('item/completed agentMessage calls onMessage with text', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('item/completed', {
      threadId: 't1', turnId: 'turn_1',
      item: { id: 'item_1', type: 'agentMessage', text: 'Hello world' },
    }, sink, state);
    expect(sink.onMessage).toHaveBeenCalledWith([{ type: 'text', text: 'Hello world' }]);
  });

  it('item/completed reasoning calls onMessage with thinking', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('item/completed', {
      threadId: 't1', turnId: 'turn_1',
      item: { id: 'item_1', type: 'reasoning', text: 'Let me think...' },
    }, sink, state);
    expect(sink.onMessage).toHaveBeenCalledWith([{ type: 'thinking', thinking: 'Let me think...' }]);
  });

  it('item/completed commandExecution calls onMessage then onToolResult', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('item/completed', {
      threadId: 't1', turnId: 'turn_1',
      item: {
        id: 'item_1', type: 'commandExecution',
        command: 'ls -la', aggregated_output: 'file.txt\n', exit_code: 0, status: 'completed',
      },
    }, sink, state);
    expect(sink.onMessage).toHaveBeenCalledWith([{
      type: 'tool_use', id: 'item_1', name: 'command_execution',
      input: { command: 'ls -la' },
    }]);
    expect(sink.onToolResult).toHaveBeenCalledWith([{
      type: 'tool_result', toolUseId: 'item_1',
      content: 'file.txt\n', isError: false,
    }]);
  });

  it('item/completed commandExecution with non-zero exit_code sets isError true', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('item/completed', {
      threadId: 't1', turnId: 'turn_1',
      item: {
        id: 'item_1', type: 'commandExecution',
        command: 'false', aggregated_output: '', exit_code: 1, status: 'failed',
      },
    }, sink, state);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      expect.objectContaining({ isError: true }),
    ]);
  });

  it('item/completed fileChange calls onMessage then onToolResult', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('item/completed', {
      threadId: 't1', turnId: 'turn_1',
      item: {
        id: 'item_2', type: 'fileChange',
        changes: [{ path: 'src/main.ts', kind: 'update' }], status: 'completed',
      },
    }, sink, state);
    expect(sink.onMessage).toHaveBeenCalledWith([{
      type: 'tool_use', id: 'item_2', name: 'file_change',
      input: { changes: [{ path: 'src/main.ts', kind: 'update' }] },
    }]);
    expect(sink.onToolResult).toHaveBeenCalledWith([{
      type: 'tool_result', toolUseId: 'item_2',
      content: 'applied', isError: false,
    }]);
  });

  it('item/completed mcpToolCall calls onMessage then onToolResult', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('item/completed', {
      threadId: 't1', turnId: 'turn_1',
      item: {
        id: 'item_3', type: 'mcpToolCall',
        server: 'my-mcp', tool: 'search', arguments: { query: 'foo' },
        result: '{"found": true}', status: 'completed',
      },
    }, sink, state);
    expect(sink.onMessage).toHaveBeenCalledWith([{
      type: 'tool_use', id: 'item_3', name: 'search',
      input: { query: 'foo' },
    }]);
    expect(sink.onToolResult).toHaveBeenCalledWith([{
      type: 'tool_result', toolUseId: 'item_3',
      content: '{"found": true}', isError: false,
    }]);
  });

  it('turn/completed calls onResult and clears currentTurnId', () => {
    const sink = createSink();
    const state = createState();
    state.currentTurnId = 'turn_1';
    handleNotification('turn/completed', {
      threadId: 't1',
      turn: { id: 'turn_1', status: 'completed', items: [], usage: { input_tokens: 100, output_tokens: 50 } },
    }, sink, state);
    expect(sink.onResult).toHaveBeenCalledWith({
      total_cost_usd: 0,
      usage: { input_tokens: 100, output_tokens: 50 },
      subtype: undefined,
      is_error: false,
    });
    expect(state.currentTurnId).toBeNull();
  });

  it('turn/completed with failed status sets is_error', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('turn/completed', {
      threadId: 't1',
      turn: { id: 'turn_1', status: 'failed', items: [] },
    }, sink, state);
    expect(sink.onResult).toHaveBeenCalledWith(expect.objectContaining({
      subtype: 'error_during_execution',
      is_error: true,
    }));
  });

  it('thread/compacted calls onCompact', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('thread/compacted', {}, sink, state);
    expect(sink.onCompact).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-event-mapper.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write event-mapper.ts**

```ts
// packages/core/src/plugins/builtin/codex/event-mapper.ts
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type {
  ItemCompletedParams,
  TurnCompletedParams,
  TurnStartedParams,
  ThreadStartedParams,
} from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:events');

export interface CodexSessionState {
  threadId: string | null;
  currentTurnId: string | null;
}

export function handleNotification(
  method: string,
  params: unknown,
  sink: SessionSink,
  state: CodexSessionState,
): void {
  log.debug({ method }, 'codex notification: %s', method);

  switch (method) {
    case 'thread/started':
      return handleThreadStarted(params as ThreadStartedParams, sink, state);
    case 'turn/started':
      return handleTurnStarted(params as TurnStartedParams, state);
    case 'item/completed':
      return handleItemCompleted(params as ItemCompletedParams, sink);
    case 'turn/completed':
      return handleTurnCompleted(params as TurnCompletedParams, sink, state);
    case 'thread/compacted':
      sink.onCompact();
      return;
    // TODO: future — map turn/diff/updated to file change tracking / context.updated
    // TODO: future — map turn/plan/updated to Plans panel structured plan state
    case 'turn/diff/updated':
    case 'turn/plan/updated':
    case 'thread/closed':
    case 'thread/status/changed':
    case 'item/started':
    case 'item/agentMessage/delta':
    case 'item/commandExecution/outputDelta':
    case 'item/fileChange/outputDelta':
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
    case 'item/plan/delta':
      return; // silently ignore known-but-unhandled notifications
    default:
      log.debug({ method }, 'codex: unhandled notification');
  }
}

function handleThreadStarted(params: ThreadStartedParams, sink: SessionSink, state: CodexSessionState): void {
  state.threadId = params.thread.id;
  sink.onInit(params.thread.id);
}

function handleTurnStarted(params: TurnStartedParams, state: CodexSessionState): void {
  state.currentTurnId = params.turn.id;
}

function handleItemCompleted(params: ItemCompletedParams, sink: SessionSink): void {
  const { item } = params;

  switch (item.type) {
    case 'agentMessage':
      sink.onMessage([{ type: 'text', text: item.text }]);
      return;

    case 'reasoning':
      sink.onMessage([{ type: 'thinking', thinking: item.text }]);
      return;

    case 'commandExecution':
      sink.onMessage([{
        type: 'tool_use',
        id: item.id,
        name: 'command_execution',
        input: { command: item.command },
      }]);
      sink.onToolResult([{
        type: 'tool_result',
        toolUseId: item.id,
        content: item.aggregated_output,
        isError: (item.exit_code ?? 0) !== 0,
      }]);
      return;

    case 'fileChange':
      sink.onMessage([{
        type: 'tool_use',
        id: item.id,
        name: 'file_change',
        input: { changes: item.changes },
      }]);
      sink.onToolResult([{
        type: 'tool_result',
        toolUseId: item.id,
        content: 'applied',
        isError: item.status === 'failed',
      }]);
      return;

    case 'mcpToolCall':
      sink.onMessage([{
        type: 'tool_use',
        id: item.id,
        name: item.tool,
        input: item.arguments,
      }]);
      sink.onToolResult([{
        type: 'tool_result',
        toolUseId: item.id,
        content: item.result ?? item.error ?? '',
        isError: !!item.error,
      }]);
      return;

    default:
      log.debug({ type: (item as { type: string }).type }, 'codex: unhandled item type');
  }
}

function handleTurnCompleted(params: TurnCompletedParams, sink: SessionSink, state: CodexSessionState): void {
  state.currentTurnId = null;
  const { turn } = params;
  const isError = turn.status === 'failed' || turn.status === 'interrupted';

  sink.onResult({
    total_cost_usd: 0,
    usage: turn.usage ? {
      input_tokens: turn.usage.input_tokens,
      output_tokens: turn.usage.output_tokens,
      cache_read_input_tokens: turn.usage.cached_input_tokens,
    } : undefined,
    subtype: isError ? 'error_during_execution' : undefined,
    is_error: isError,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-event-mapper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/event-mapper.ts packages/core/src/__tests__/codex-event-mapper.test.ts
git commit -m "feat(codex): add event mapper — app-server notifications to SessionSink"
```

---

### Task 5: Approval Handler (`approval-handler.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/approval-handler.ts`
- Test: `packages/core/src/__tests__/codex-approval-handler.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/__tests__/codex-approval-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalHandler } from '../plugins/builtin/codex/approval-handler.js';
import type { SessionSink, ControlResponse } from '@qlan-ro/mainframe-types';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
  };
}

describe('ApprovalHandler', () => {
  it('maps commandExecution approval to sink.onPermission', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'rm -rf /', cwd: '/home' },
      42,
      respond,
    );

    expect(sink.onPermission).toHaveBeenCalledOnce();
    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(request.toolName).toBe('command_execution');
    expect(request.input).toEqual({ command: 'rm -rf /', cwd: '/home' });
    expect(request.toolUseId).toBe('i1');
  });

  it('maps fileChange approval to sink.onPermission', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/fileChange/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i2', reason: 'Write access needed' },
      43,
      respond,
    );

    expect(sink.onPermission).toHaveBeenCalledOnce();
    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(request.toolName).toBe('file_change');
    expect(request.input).toEqual({ reason: 'Write access needed' });
  });

  it('resolve with allow sends accept decision', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'ls' },
      42,
      respond,
    );

    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const response: ControlResponse = {
      requestId: request.requestId,
      toolUseId: 'i1',
      behavior: 'allow',
    };
    handler.resolve(response);

    expect(respond).toHaveBeenCalledWith(42, { decision: 'accept' });
  });

  it('resolve with deny sends decline decision', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'ls' },
      42,
      respond,
    );

    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    handler.resolve({
      requestId: request.requestId,
      toolUseId: 'i1',
      behavior: 'deny',
    });

    expect(respond).toHaveBeenCalledWith(42, { decision: 'decline' });
  });

  it('rejectAll declines all pending approvals', () => {
    const sink = createSink();
    const respond1 = vi.fn();
    const respond2 = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest('item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'a' }, 1, respond1);
    handler.handleRequest('item/fileChange/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i2' }, 2, respond2);

    handler.rejectAll();

    expect(respond1).toHaveBeenCalledWith(1, { decision: 'decline' });
    expect(respond2).toHaveBeenCalledWith(2, { decision: 'decline' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-approval-handler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write approval-handler.ts**

```ts
// packages/core/src/plugins/builtin/codex/approval-handler.ts
import { nanoid } from 'nanoid';
import type { ControlRequest, ControlResponse, SessionSink } from '@qlan-ro/mainframe-types';
import type { RequestId, CommandExecutionApprovalParams, FileChangeApprovalParams, ApprovalDecision } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:approvals');

export type RespondFn = (id: RequestId, result: unknown) => void;

interface PendingApproval {
  mainframeRequestId: string;
  jsonRpcId: RequestId;
  respond: RespondFn;
}

export class ApprovalHandler {
  private pending = new Map<string, PendingApproval>();

  constructor(private readonly sink: SessionSink) {}

  handleRequest(method: string, params: unknown, jsonRpcId: RequestId, respond: RespondFn): void {
    const mainframeRequestId = nanoid();

    let toolName: string;
    let toolUseId: string;
    let input: Record<string, unknown>;

    if (method === 'item/commandExecution/requestApproval') {
      const p = params as CommandExecutionApprovalParams;
      toolName = 'command_execution';
      toolUseId = p.itemId;
      input = { command: p.command, cwd: p.cwd };
    } else if (method === 'item/fileChange/requestApproval') {
      const p = params as FileChangeApprovalParams;
      toolName = 'file_change';
      toolUseId = p.itemId;
      input = { reason: p.reason };
    } else {
      log.warn({ method }, 'codex: unknown approval method');
      respond(jsonRpcId, { decision: 'decline' as ApprovalDecision });
      return;
    }

    const request: ControlRequest = {
      requestId: mainframeRequestId,
      toolName,
      toolUseId,
      input,
      suggestions: [],
    };

    this.pending.set(mainframeRequestId, { mainframeRequestId, jsonRpcId, respond });

    log.info({ mainframeRequestId, jsonRpcId, toolName, toolUseId }, 'codex approval request');
    this.sink.onPermission(request);
  }

  resolve(response: ControlResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) {
      log.warn({ requestId: response.requestId }, 'codex: no pending approval for requestId');
      return;
    }

    this.pending.delete(response.requestId);

    let decision: ApprovalDecision;
    if (response.behavior === 'allow') {
      decision = 'accept';
    } else {
      decision = 'decline';
    }

    log.info({ requestId: response.requestId, decision }, 'codex approval resolved');
    entry.respond(entry.jsonRpcId, { decision });
  }

  rejectAll(): void {
    for (const [id, entry] of this.pending) {
      entry.respond(entry.jsonRpcId, { decision: 'decline' as ApprovalDecision });
      this.pending.delete(id);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-approval-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/approval-handler.ts packages/core/src/__tests__/codex-approval-handler.test.ts
git commit -m "feat(codex): add approval handler — server requests to permission flow"
```

---

### Task 6: History (`history.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/history.ts`
- Test: `packages/core/src/__tests__/codex-history.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/__tests__/codex-history.test.ts
import { describe, it, expect } from 'vitest';
import { convertThreadItems } from '../plugins/builtin/codex/history.js';

describe('convertThreadItems', () => {
  it('converts agentMessage to assistant text', () => {
    const messages = convertThreadItems(
      [{ id: 'i1', type: 'agentMessage', text: 'Hello' }],
      'chat-1',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('assistant');
    expect(messages[0]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('converts reasoning to assistant thinking', () => {
    const messages = convertThreadItems(
      [{ id: 'i1', type: 'reasoning', text: 'Let me think...' }],
      'chat-1',
    );
    expect(messages[0]!.content).toEqual([{ type: 'thinking', thinking: 'Let me think...' }]);
  });

  it('converts commandExecution to tool_use + tool_result pair', () => {
    const messages = convertThreadItems(
      [{
        id: 'i1', type: 'commandExecution',
        command: 'ls', aggregated_output: 'file.txt', exit_code: 0, status: 'completed' as const,
      }],
      'chat-1',
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]!.type).toBe('assistant');
    expect(messages[0]!.content[0]!.type).toBe('tool_use');
    expect(messages[1]!.type).toBe('tool_result');
    expect(messages[1]!.content[0]).toEqual(
      expect.objectContaining({ type: 'tool_result', toolUseId: 'i1', isError: false }),
    );
  });

  it('converts userMessage to user text', () => {
    const messages = convertThreadItems(
      [{ id: 'i1', type: 'userMessage', text: 'Fix the bug' }],
      'chat-1',
    );
    expect(messages[0]!.type).toBe('user');
    expect(messages[0]!.content).toEqual([{ type: 'text', text: 'Fix the bug' }]);
  });

  it('converts fileChange to tool_use + tool_result', () => {
    const messages = convertThreadItems(
      [{
        id: 'i2', type: 'fileChange',
        changes: [{ path: 'a.ts', kind: 'update' as const }], status: 'completed' as const,
      }],
      'chat-1',
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content[0]).toEqual(expect.objectContaining({ name: 'file_change' }));
  });

  it('converts mcpToolCall to tool_use + tool_result', () => {
    const messages = convertThreadItems(
      [{
        id: 'i3', type: 'mcpToolCall',
        server: 'mcp', tool: 'search', arguments: { q: 'foo' },
        result: 'found', status: 'completed' as const,
      }],
      'chat-1',
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content[0]).toEqual(expect.objectContaining({ name: 'search' }));
  });

  it('sets chatId on all messages', () => {
    const messages = convertThreadItems(
      [{ id: 'i1', type: 'agentMessage', text: 'Hi' }],
      'my-chat',
    );
    expect(messages[0]!.chatId).toBe('my-chat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-history.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write history.ts**

```ts
// packages/core/src/plugins/builtin/codex/history.ts
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import type { ThreadItem } from './types.js';

export function convertThreadItems(items: ThreadItem[], chatId: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const item of items) {
    switch (item.type) {
      case 'agentMessage':
        messages.push(makeMessage(chatId, 'assistant', [{ type: 'text', text: item.text }]));
        break;

      case 'reasoning':
        messages.push(makeMessage(chatId, 'assistant', [{ type: 'thinking', thinking: item.text }]));
        break;

      case 'commandExecution':
        messages.push(makeMessage(chatId, 'assistant', [{
          type: 'tool_use', id: item.id, name: 'command_execution',
          input: { command: item.command },
        }]));
        messages.push(makeMessage(chatId, 'tool_result', [{
          type: 'tool_result', toolUseId: item.id,
          content: item.aggregated_output,
          isError: (item.exit_code ?? 0) !== 0,
        }]));
        break;

      case 'fileChange':
        messages.push(makeMessage(chatId, 'assistant', [{
          type: 'tool_use', id: item.id, name: 'file_change',
          input: { changes: item.changes },
        }]));
        messages.push(makeMessage(chatId, 'tool_result', [{
          type: 'tool_result', toolUseId: item.id,
          content: 'applied',
          isError: item.status === 'failed',
        }]));
        break;

      case 'mcpToolCall':
        messages.push(makeMessage(chatId, 'assistant', [{
          type: 'tool_use', id: item.id, name: item.tool,
          input: item.arguments,
        }]));
        messages.push(makeMessage(chatId, 'tool_result', [{
          type: 'tool_result', toolUseId: item.id,
          content: item.result ?? item.error ?? '',
          isError: !!item.error,
        }]));
        break;

      case 'userMessage':
        messages.push(makeMessage(chatId, 'user', [{ type: 'text', text: item.text }]));
        break;

      // webSearch, todoList — skip for now
    }
  }

  return messages;
}

function makeMessage(chatId: string, type: ChatMessage['type'], content: MessageContent[]): ChatMessage {
  return {
    id: nanoid(),
    chatId,
    type,
    content,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/history.ts packages/core/src/__tests__/codex-history.test.ts
git commit -m "feat(codex): add history converter — thread items to ChatMessage"
```

---

### Task 7: Session (`session.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/session.ts`
- Test: `packages/core/src/__tests__/codex-session.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/__tests__/codex-session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexSession } from '../plugins/builtin/codex/session.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');
  const { Readable, Writable } = require('node:stream');

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdin = new Writable({ write(_chunk: unknown, _enc: unknown, cb: () => void) { cb(); } });
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.pid = 9999;
      proc.killed = false;
      proc.kill = vi.fn(() => { proc.emit('close', 0); return true; });
      return proc;
    }),
  };
});

import { spawn } from 'node:child_process';
import type { SessionSink } from '@qlan-ro/mainframe-types';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
  };
}

describe('CodexSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns codex app-server with correct args', async () => {
    const session = new CodexSession({ projectPath: '/tmp/project' });
    const sink = createSink();

    // Spawn will start the handshake which will hang, so we simulate the response
    const spawnPromise = session.spawn({ model: 'codex-mini-latest', permissionMode: 'default' }, sink);

    // Get the spawned process and simulate handshake response
    const proc = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    const initResponse = JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0', codexHome: '/home/.codex' } }) + '\n';
    proc.stdout.push(initResponse);

    await spawnPromise;

    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['app-server'],
      expect.objectContaining({
        cwd: '/tmp/project',
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });

  it('sets adapterId to codex', () => {
    const session = new CodexSession({ projectPath: '/tmp' });
    expect(session.adapterId).toBe('codex');
  });

  it('isSpawned returns false before spawn', () => {
    const session = new CodexSession({ projectPath: '/tmp' });
    expect(session.isSpawned).toBe(false);
  });

  it('maps yolo permission mode to never approval + danger-full-access sandbox', async () => {
    const session = new CodexSession({ projectPath: '/tmp/project' });
    const sink = createSink();

    const spawnPromise = session.spawn({ permissionMode: 'yolo' }, sink);
    const proc = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    proc.stdout.push(JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0', codexHome: '/home/.codex' } }) + '\n');
    await spawnPromise;

    // Send a message to trigger thread/start — check the params
    const written: string[] = [];
    proc.stdin.write = vi.fn((data: string, _enc?: unknown, cb?: () => void) => {
      written.push(data);
      if (typeof cb === 'function') cb();
      return true;
    });

    // Simulate thread/start response
    const sendPromise = session.sendMessage('hello');
    // initialized notification was already sent, next write is thread/start
    // We need to parse it and respond
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    const threadStartMsg = JSON.parse(written[written.length - 1]!.trim());
    if (threadStartMsg.method === 'thread/start') {
      expect(threadStartMsg.params.approvalPolicy).toBe('never');
      expect(threadStartMsg.params.sandbox).toBe('danger-full-access');
      // Respond to thread/start
      proc.stdout.push(JSON.stringify({ id: threadStartMsg.id, result: { thread: { id: 'thr_1' } } }) + '\n');
      // Respond to thread/started notification
      proc.stdout.push(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thr_1' } } }) + '\n');
    }

    // Wait for turn/start
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(1));
    const lastMsg = JSON.parse(written[written.length - 1]!.trim());
    if (lastMsg.method === 'turn/start') {
      proc.stdout.push(JSON.stringify({ id: lastMsg.id, result: { turn: { id: 'turn_1', status: 'running' } } }) + '\n');
    }

    await sendPromise;
  });

  it('kill calls close on client', async () => {
    const session = new CodexSession({ projectPath: '/tmp' });
    const sink = createSink();

    const spawnPromise = session.spawn({}, sink);
    const proc = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    proc.stdout.push(JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0', codexHome: '/tmp' } }) + '\n');
    await spawnPromise;

    await session.kill();
    expect(proc.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write session.ts**

```ts
// packages/core/src/plugins/builtin/codex/session.ts
import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { nanoid } from 'nanoid';
import type {
  AdapterProcess,
  AdapterSession,
  SessionSpawnOptions,
  SessionOptions,
  SessionSink,
  ControlResponse,
  ChatMessage,
  ContextFile,
  SkillFileEntry,
} from '@qlan-ro/mainframe-types';
import { JsonRpcClient } from './jsonrpc.js';
import { handleNotification, type CodexSessionState } from './event-mapper.js';
import { ApprovalHandler } from './approval-handler.js';
import { convertThreadItems } from './history.js';
import type {
  InitializeResult,
  ThreadStartResult,
  ThreadResumeResult,
  TurnStartResult,
  ThreadReadResult,
  ApprovalPolicy,
  SandboxMode,
  CollaborationMode,
  UserInput,
} from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:session');

const HANDSHAKE_TIMEOUT_MS = 10_000;

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

export class CodexSession implements AdapterSession {
  readonly id: string;
  readonly adapterId = 'codex';
  readonly projectPath: string;

  private client: JsonRpcClient | null = null;
  private approvalHandler: ApprovalHandler | null = null;
  private sink: SessionSink = nullSink;
  private readonly onExitCallback: (() => void) | undefined;
  private readonly resumeThreadId: string | undefined;

  readonly state: CodexSessionState = { threadId: null, currentTurnId: null };

  private pendingModel: string | undefined;
  private pendingPermissionMode: string = 'default';
  private pid = 0;
  private status: 'starting' | 'ready' | 'running' | 'stopped' | 'error' = 'starting';

  constructor(options: SessionOptions, onExit?: () => void) {
    this.id = nanoid();
    this.projectPath = options.projectPath;
    this.resumeThreadId = options.chatId;
    this.onExitCallback = onExit;
  }

  get isSpawned(): boolean {
    return this.client !== null;
  }

  getProcessInfo(): AdapterProcess | null {
    if (!this.client) return null;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.state.threadId ?? '',
      pid: this.pid,
      status: this.status,
      projectPath: this.projectPath,
      model: this.pendingModel,
    };
  }

  async spawn(options: SessionSpawnOptions = {}, sink?: SessionSink): Promise<AdapterProcess> {
    this.sink = sink ?? nullSink;
    this.pendingModel = options.model;
    this.pendingPermissionMode = options.permissionMode ?? 'default';

    try {
      accessSync(this.projectPath);
    } catch {
      throw new Error(`Project directory does not exist or is not accessible: ${this.projectPath}`);
    }

    const executable = options.executablePath || 'codex';
    const child = spawn(executable, ['app-server'], {
      cwd: this.projectPath,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    this.pid = child.pid || 0;
    this.status = 'starting';

    this.approvalHandler = new ApprovalHandler(this.sink);
    const approvalHandler = this.approvalHandler;

    this.client = new JsonRpcClient(child, {
      onNotification: (method, params) => handleNotification(method, params, this.sink, this.state),
      onRequest: (method, params, id) => {
        approvalHandler.handleRequest(method, params, id, (rpcId, result) => {
          this.client?.respond(rpcId, result);
        });
      },
      onError: (error) => this.sink.onError(new Error(error)),
      onExit: (code) => {
        this.status = 'stopped';
        this.client = null;
        this.sink.onExit(code);
        this.onExitCallback?.();
      },
    });

    // Perform initialize handshake
    const handshakeTimer = setTimeout(() => {
      log.error({ sessionId: this.id }, 'codex handshake timeout');
      this.sink.onError(new Error('handshake timeout'));
      this.client?.close();
    }, HANDSHAKE_TIMEOUT_MS);

    try {
      await this.client.request<InitializeResult>('initialize', {
        clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      });
      this.client.notify('initialized');
      this.status = 'ready';
    } finally {
      clearTimeout(handshakeTimer);
    }

    log.info(
      { sessionId: this.id, projectPath: this.projectPath, model: options.model, resume: !!this.resumeThreadId },
      'codex session spawned',
    );

    return this.getProcessInfo()!;
  }

  async sendMessage(message: string, images?: { mediaType: string; data: string }[]): Promise<void> {
    if (!this.client) throw new Error(`Session ${this.id} not spawned`);

    const input: UserInput[] = [];
    if (images?.length) {
      for (const img of images) {
        log.warn({ sessionId: this.id }, 'codex: image attachments not supported yet, skipping');
      }
    }
    input.push({ type: 'text', text: message, text_elements: [] });

    // First message: start or resume thread
    if (!this.state.threadId) {
      if (this.resumeThreadId) {
        const resumeResult = await this.client.request<ThreadResumeResult>('thread/resume', {
          threadId: this.resumeThreadId,
          model: this.pendingModel,
          cwd: this.projectPath,
        });
        this.state.threadId = resumeResult.thread.id;
      } else {
        const { approvalPolicy, sandbox } = this.mapPermissionMode(this.pendingPermissionMode);
        const startResult = await this.client.request<ThreadStartResult>('thread/start', {
          model: this.pendingModel,
          cwd: this.projectPath,
          approvalPolicy,
          sandbox,
        });
        this.state.threadId = startResult.thread.id;
      }
    }

    // Start turn
    const { approvalPolicy, sandbox } = this.mapPermissionMode(this.pendingPermissionMode);
    const collaborationMode = this.buildCollaborationMode();

    await this.client.request<TurnStartResult>('turn/start', {
      threadId: this.state.threadId,
      input,
      approvalPolicy,
      sandboxPolicy: this.mapSandboxPolicy(sandbox),
      collaborationMode,
      model: this.pendingModel,
    });

    this.status = 'running';
  }

  async kill(): Promise<void> {
    this.approvalHandler?.rejectAll();
    this.client?.close();
    this.client = null;
  }

  async interrupt(): Promise<void> {
    if (!this.client || !this.state.threadId || !this.state.currentTurnId) return;
    await this.client.request('turn/interrupt', {
      threadId: this.state.threadId,
      turnId: this.state.currentTurnId,
    });
  }

  async respondToPermission(response: ControlResponse): Promise<void> {
    this.approvalHandler?.resolve(response);
  }

  async setModel(model: string): Promise<void> {
    this.pendingModel = model;
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.pendingPermissionMode = mode;
  }

  async sendCommand(_command: string, _args?: string): Promise<void> {
    // TODO: investigate Codex skills/apps as potential equivalents to Claude slash commands
    log.warn({ sessionId: this.id }, 'codex: sendCommand not supported');
  }

  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    // TODO: implement — read Codex-equivalent context files
    return { global: [], project: [] };
  }

  async loadHistory(): Promise<ChatMessage[]> {
    if (!this.resumeThreadId) return [];

    // Spawn a temporary app-server to read history
    const { spawn: spawnProcess } = await import('node:child_process');
    const child = spawnProcess('codex', ['app-server'], {
      cwd: this.projectPath,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const tempClient = new JsonRpcClient(child, {
      onNotification: () => {},
      onRequest: () => {},
      onError: () => {},
      onExit: () => {},
    });

    try {
      await tempClient.request('initialize', {
        clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
      });
      tempClient.notify('initialized');

      const result = await tempClient.request<ThreadReadResult>('thread/read', {
        threadId: this.resumeThreadId,
        includeTurns: true,
      });

      const allItems = result.thread.turns?.flatMap((t) => t.items) ?? [];
      return convertThreadItems(allItems, this.resumeThreadId);
    } catch (err) {
      log.warn({ err, threadId: this.resumeThreadId }, 'codex: failed to load history');
      return [];
    } finally {
      tempClient.close();
    }
  }

  async extractPlanFiles(): Promise<string[]> {
    // TODO: implement
    return [];
  }

  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    // TODO: implement
    return [];
  }

  private mapPermissionMode(mode: string): { approvalPolicy: ApprovalPolicy; sandbox: SandboxMode } {
    if (mode === 'yolo') {
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    }
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  }

  private mapSandboxPolicy(sandbox: SandboxMode): { type: string } {
    switch (sandbox) {
      case 'danger-full-access': return { type: 'dangerFullAccess' };
      case 'read-only': return { type: 'readOnly' };
      case 'workspace-write':
      default: return { type: 'workspaceWrite' };
    }
  }

  private buildCollaborationMode(): CollaborationMode | undefined {
    if (this.pendingPermissionMode === 'plan') {
      return {
        mode: 'plan',
        settings: {
          model: this.pendingModel ?? '',
          reasoning_effort: null,
          developer_instructions: null,
        },
      };
    }
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/session.ts packages/core/src/__tests__/codex-session.test.ts
git commit -m "feat(codex): add session — spawn, message, kill, approve lifecycle"
```

---

### Task 8: Adapter (`adapter.ts`)

**Files:**
- Create: `packages/core/src/plugins/builtin/codex/adapter.ts`
- Test: `packages/core/src/__tests__/codex-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/__tests__/codex-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CodexAdapter } from '../plugins/builtin/codex/adapter.js';

// Mock execFile
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
      cb(null, 'codex 1.2.3');
    }),
  };
});

describe('CodexAdapter', () => {
  it('has id "codex"', () => {
    const adapter = new CodexAdapter();
    expect(adapter.id).toBe('codex');
  });

  it('has name "Codex"', () => {
    const adapter = new CodexAdapter();
    expect(adapter.name).toBe('Codex');
  });

  it('isInstalled returns true when codex --version succeeds', async () => {
    const adapter = new CodexAdapter();
    expect(await adapter.isInstalled()).toBe(true);
  });

  it('getVersion extracts semver from stdout', async () => {
    const adapter = new CodexAdapter();
    expect(await adapter.getVersion()).toBe('1.2.3');
  });

  it('createSession returns a CodexSession', () => {
    const adapter = new CodexAdapter();
    const session = adapter.createSession({ projectPath: '/tmp' });
    expect(session.adapterId).toBe('codex');
    expect(session.projectPath).toBe('/tmp');
  });

  it('killAll kills all tracked sessions', async () => {
    const adapter = new CodexAdapter();
    const session1 = adapter.createSession({ projectPath: '/tmp' });
    const session2 = adapter.createSession({ projectPath: '/tmp' });
    vi.spyOn(session1, 'kill').mockResolvedValue();
    vi.spyOn(session2, 'kill').mockResolvedValue();

    adapter.killAll();

    expect(session1.kill).toHaveBeenCalled();
    expect(session2.kill).toHaveBeenCalled();
  });

  it('getToolCategories returns expected categories', () => {
    const adapter = new CodexAdapter();
    const categories = adapter.getToolCategories!();
    expect(categories.progress.has('todo_list')).toBe(true);
    expect(categories.explore.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write adapter.ts**

```ts
// packages/core/src/plugins/builtin/codex/adapter.ts
import { execFile, spawn } from 'node:child_process';
import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  ExternalSession,
  SessionOptions,
} from '@qlan-ro/mainframe-types';
import { CodexSession } from './session.js';
import { JsonRpcClient } from './jsonrpc.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';
import type { InitializeResult, ModelListResult, ThreadListResult } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:adapter');

export class CodexAdapter implements Adapter {
  readonly id = 'codex';
  readonly name = 'Codex';

  private sessions = new Set<CodexSession>();

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('codex', ['--version'], (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('codex', ['--version'], (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        resolve(match?.[1] ?? stdout.trim());
      });
    });
  }

  async listModels(): Promise<AdapterModel[]> {
    let client: JsonRpcClient | null = null;
    try {
      client = await this.spawnTempAppServer();
      const result = await client.request<ModelListResult>('model/list');
      return result.models.map((m) => ({
        id: m.id,
        label: m.name ?? m.id,
      }));
    } catch (err) {
      log.warn({ err }, 'codex: failed to list models');
      return [];
    } finally {
      client?.close();
    }
  }

  getToolCategories(): ToolCategories {
    return {
      explore: new Set(),
      hidden: new Set(),
      progress: new Set(['todo_list']),
      subagent: new Set(),
    };
  }

  createSession(options: SessionOptions): AdapterSession {
    const session = new CodexSession(options, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch(() => {});
    }
    this.sessions.clear();
  }

  // TODO: implement getContextFiles
  // TODO: implement listSkills, createSkill, updateSkill, deleteSkill
  // TODO: implement listAgents, createAgent, updateAgent, deleteAgent
  // TODO: implement listCommands

  async listExternalSessions(projectPath: string, _excludeSessionIds: string[]): Promise<ExternalSession[]> {
    let client: JsonRpcClient | null = null;
    try {
      client = await this.spawnTempAppServer();
      const result = await client.request<ThreadListResult>('thread/list', {
        cwd: projectPath,
        archived: false,
      });
      return result.threads.map((t) => ({
        sessionId: t.id,
        adapterId: this.id,
        projectPath,
        firstPrompt: t.name,
        summary: t.name,
        createdAt: t.createdAt ?? new Date().toISOString(),
        modifiedAt: t.modifiedAt ?? new Date().toISOString(),
        model: t.model,
      }));
    } catch (err) {
      log.warn({ err }, 'codex: failed to list external sessions');
      return [];
    } finally {
      client?.close();
    }
  }

  private async spawnTempAppServer(): Promise<JsonRpcClient> {
    const child = spawn('codex', ['app-server'], {
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const client = new JsonRpcClient(child, {
      onNotification: () => {},
      onRequest: () => {},
      onError: () => {},
      onExit: () => {},
    });

    await client.request<InitializeResult>('initialize', {
      clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
    });
    client.notify('initialized');

    return client;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/codex-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/adapter.ts packages/core/src/__tests__/codex-adapter.test.ts
git commit -m "feat(codex): add adapter — install check, model list, session factory"
```

---

### Task 9: Registration in daemon startup

**Files:**
- Modify: `packages/core/src/index.ts:16-17` (add imports)
- Modify: `packages/core/src/index.ts:85` (add loadBuiltin call)

- [ ] **Step 1: Add imports to packages/core/src/index.ts**

Add after line 19 (`import { activate as activateTodos } ...`):

```ts
import codexManifest from './plugins/builtin/codex/manifest.json' with { type: 'json' };
import { activate as activateCodex } from './plugins/builtin/codex/index.js';
```

- [ ] **Step 2: Add loadBuiltin call**

Add after line 85 (`await pluginManager.loadBuiltin(claudeManifest ...)`):

```ts
  await pluginManager.loadBuiltin(codexManifest as PluginManifest, activateCodex);
```

- [ ] **Step 3: Build and verify no type errors**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: BUILD SUCCESS with no type errors

- [ ] **Step 4: Run the full test suite for core**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run`
Expected: All tests pass (existing + new codex tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(codex): register codex plugin in daemon startup"
```

---

### Task 10: Changeset and final verification

- [ ] **Step 1: Add changeset**

Run: `pnpm changeset`

Select `@qlan-ro/mainframe-core` with `minor` bump. Description:
```
Add Codex builtin adapter plugin — OpenAI Codex CLI integration via app-server JSON-RPC protocol with interactive approvals, streaming events, and session management
```

- [ ] **Step 2: Run full typecheck**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for codex plugin"
```
