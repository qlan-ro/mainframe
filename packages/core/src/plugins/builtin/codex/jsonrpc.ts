// packages/core/src/plugins/builtin/codex/jsonrpc.ts
import type { ChildProcess } from 'node:child_process';
import { isJsonRpcResponse, isJsonRpcError, isJsonRpcNotification, isJsonRpcServerRequest } from './types.js';
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
    if (process.stdout) {
      const stdout = process.stdout;
      const origPush = stdout.push.bind(stdout);
      stdout.push = (chunk: unknown, encoding?: BufferEncoding): boolean => {
        if (chunk !== null && chunk !== undefined) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, encoding ?? 'utf8');
          this.handleStdout(buf);
        }
        return origPush(chunk as Buffer, encoding);
      };
    }
    if (process.stderr) {
      const stderr = process.stderr;
      const origPush = stderr.push.bind(stderr);
      stderr.push = (chunk: unknown, encoding?: BufferEncoding): boolean => {
        if (chunk !== null && chunk !== undefined) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, encoding ?? 'utf8');
          this.handleStderr(buf);
        }
        return origPush(chunk as Buffer, encoding);
      };
    }
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
