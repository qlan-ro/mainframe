// packages/core/src/plugins/builtin/codex/jsonrpc.ts
import type { ChildProcess } from 'node:child_process';
import { isJsonRpcResponse, isJsonRpcError, isJsonRpcNotification, isJsonRpcServerRequest } from './types.js';
import type { RequestId } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:jsonrpc');

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const STDERR_TAIL_LINES = 20;

// `<rfc3339> <LEVEL> <target>: <message>` — the codex binary's tracing format.
const TRACING_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s/;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function findJsonObjectEnd(input: string): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (depth === 0 && !/\s/.test(ch)) {
      return null;
    }
  }

  return null;
}

function parseJsonRpcMessages(line: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  let rest = line.trim();

  while (rest) {
    try {
      messages.push(JSON.parse(rest) as Record<string, unknown>);
      return messages;
    } catch {
      const end = findJsonObjectEnd(rest);
      if (end === null) throw new Error('No complete JSON object found');
      messages.push(JSON.parse(rest.slice(0, end)) as Record<string, unknown>);
      rest = rest.slice(end).trim();
      if (!rest.startsWith('{')) return messages;
    }
  }

  return messages;
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
  private stderrBuffer = '';
  private readonly recentStderr: string[] = [];
  private pending = new Map<RequestId, PendingRequest>();
  private closed = false;
  private closeListeners = new Set<() => void>();

  constructor(
    private readonly process: ChildProcess,
    private readonly handlers: JsonRpcHandlers,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    process.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    process.stderr?.on('data', (chunk: Buffer) => this.handleStderr(chunk));
    process.on('close', (code: number | null) => {
      this.rejectAllPending(new Error(`Process exited with code ${code}`));
      this.reportUnexpectedExit(code);
      for (const listener of this.closeListeners) listener();
      this.handlers.onExit(code);
    });
    process.on('error', (err: Error) => {
      this.handlers.onError(err.message);
    });
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Client closed'));

    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params: params ?? {} };
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
    const msg: Record<string, unknown> = { method, params: params ?? {} };
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

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  private write(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg) + '\n';
    log.trace({ msg }, 'jsonrpc write');
    this.process.stdin?.write(json);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      log.trace({ line }, 'jsonrpc recv');
      try {
        for (const msg of parseJsonRpcMessages(line)) {
          this.dispatch(msg);
        }
      } catch {
        log.warn({ line: line.slice(0, 200) }, 'jsonrpc: malformed JSON line');
      }
    }
  }

  // codex is a Rust binary that writes tracing logs to stderr as normal operation —
  // an unauthenticated remote MCP server alone emits ERROR lines on every startup while
  // the run proceeds fine. stderr is a log stream, never an error channel: a real failure
  // arrives as a JSON-RPC error, a process 'error', or a non-zero exit (reported below).
  private handleStderr(chunk: Buffer): void {
    this.stderrBuffer += chunk.toString();
    const lines = this.stderrBuffer.split('\n');
    this.stderrBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const message = line.trim();
      if (!message) continue;

      this.recentStderr.push(message);
      if (this.recentStderr.length > STDERR_TAIL_LINES) this.recentStderr.shift();

      if (TRACING_LINE.test(message)) log.debug({ stderr: message }, 'codex stderr');
      else log.warn({ stderr: message }, 'codex stderr');
    }
  }

  private reportUnexpectedExit(code: number | null): void {
    if (this.closed || code === 0 || code === null) return;
    const tail = this.recentStderr.join('\n');
    this.handlers.onError(tail ? `codex exited with code ${code}:\n${tail}` : `codex exited with code ${code}`);
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
