/**
 * JSON-RPC 2.0 framing + request/response correlation over one ACP facade WS
 * connection (todo #350, plan task 19). Classification mirrors the daemon's
 * `rpc::parse_frame` (`mainframe-acp/src/rpc.rs`): frame *shape* — which keys
 * are present — decides request vs. notification vs. response, not a
 * try-then-fallback; a request's `id` can legitimately be `null`; a
 * notification never has an `id` key at all.
 */
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcRequestId, JsonRpcResponse } from '@qlan-ro/mainframe-types';
import { NotSentError } from './not-sent-error';
import { BinaryResponses, batchFrameCount } from './acp-binary-responses';
import { parseBinaryFrame } from './acp-binary-frame';
import { JsonRpcNotificationSchema, JsonRpcRequestSchema, JsonRpcResponseSchema } from '@qlan-ro/mainframe-types';

export interface AcpSocketLike {
  /** Binary history frames must arrive as `ArrayBuffer`; set on open when the socket has it. */
  binaryType?: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type AcpSocketFactory = (url: string) => AcpSocketLike;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingEntry {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  onSuccess?: (result: unknown) => void;
  deadline: ReturnType<typeof setTimeout>;
}

/** A reply that never arrives must not hang `prompt()`/`resume()` forever — the caller always leaves its waiting state. */
const REQUEST_DEADLINE_MS = 30_000;
const CLOSED_ERROR: RpcError = { code: -32000, message: 'connection closed' };

interface ParseableSchema<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T };
}

/** One `/acp/{profile}` connection's frame plumbing — no session semantics. */
export class RpcConnection {
  private socket: AcpSocketLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingEntry>();
  private requestHandler: ((request: JsonRpcRequest) => void) | null = null;
  private notificationHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private readonly binary = new BinaryResponses<PendingEntry>({
    isWaiting: (key, entry) => this.pending.get(key) === entry,
    succeed: (key, entry, result) => {
      this.dropPending(key);
      this.succeed(entry, result);
    },
    fail: (key, error) => this.failBinary(key, error),
  });
  /** True while a binary response inflates: later messages wait, so a page lands before what followed it. */
  private blocked = false;
  private readonly backlog: (string | ArrayBuffer)[] = [];

  constructor(
    private readonly url: string,
    private readonly createSocket: AcpSocketFactory,
  ) {}

  /** Opens the socket; resolves once it reports `onopen`, rejects if it never does. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(this.url);
      this.socket = socket;
      if ('binaryType' in socket) socket.binaryType = 'arraybuffer';
      let settledOpen = false;
      socket.onopen = () => {
        settledOpen = true;
        resolve();
      };
      socket.onmessage = (ev) => this.receive(ev.data);
      socket.onerror = () => {
        if (settledOpen) return;
        settledOpen = true;
        reject(new Error('acp connection failed to open'));
      };
      socket.onclose = () => {
        this.rejectAllPending({ code: -32000, message: 'connection closed' });
        if (!settledOpen) {
          settledOpen = true;
          reject(new Error('acp connection closed before opening'));
        }
        this.closeHandler?.();
      };
    });
  }

  onRequest(handler: (request: JsonRpcRequest) => void): void {
    this.requestHandler = handler;
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /** Rejects pending requests synchronously: a real `close()` fires `onclose` late (R3.8). */
  close(): void {
    this.socket?.close();
    this.socket = null;
    this.rejectAllPending(CLOSED_ERROR);
  }

  sendRequest(method: string, params?: unknown, onSuccess?: (result: unknown) => void): Promise<unknown> {
    const id = this.nextId++;
    const key = String(id);
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        this.dropPending(key);
        reject({ code: -32000, message: 'request timed out' });
      }, REQUEST_DEADLINE_MS);
      this.pending.set(key, { resolve, reject, deadline, onSuccess });
      this.write({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  sendNotification(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  /** Reply to a daemon-initiated request (e.g. `session/request_permission`). */
  respond(id: JsonRpcRequestId | null, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  /** Error reply to a daemon-initiated request — e.g. a schema-rejected `session/request_permission` (R3.7). */
  respondError(id: JsonRpcRequestId | null, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(frame: unknown): void {
    if (!this.socket) {
      console.warn('[acp-client] dropped outbound frame — connection not open', frame);
      this.rejectIfRequest(frame);
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  /** A request written after the connection died must reject its own promise, not hang until the next close/timeout. */
  private rejectIfRequest(frame: unknown): void {
    const id = (frame as { id?: unknown }).id;
    if (id === undefined) return;
    const key = String(id);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.dropPending(key);
    entry.reject(new NotSentError(CLOSED_ERROR.message));
  }

  /** One socket message, in arrival order: held back while a binary response is still inflating. */
  private receive(data: string | ArrayBuffer): void {
    if (this.blocked) {
      this.backlog.push(data);
      return;
    }
    const inflating = typeof data === 'string' ? this.handleMessage(data) : this.handleBinary(data);
    if (!inflating) return;
    this.blocked = true;
    void inflating.finally(() => {
      this.blocked = false;
      while (!this.blocked && this.backlog.length > 0) {
        try {
          this.receive(this.backlog.shift()!);
        } catch (error) {
          // A throwing listener loses only its own message, as before binary frames.
          console.error('[acp-client] a held message failed while draining the backlog', error);
        }
      }
    });
  }

  private handleMessage(raw: string): Promise<void> | undefined {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      console.warn('[acp-client] dropped malformed frame — not JSON');
      return undefined;
    }
    if (typeof value !== 'object' || value === null) {
      console.warn('[acp-client] dropped malformed frame — not an object', value);
      return undefined;
    }
    const fields = value as Record<string, unknown>;
    if ('method' in fields) {
      if ('id' in fields) this.dispatch(JsonRpcRequestSchema, value, (r) => this.requestHandler?.(r));
      else this.dispatch(JsonRpcNotificationSchema, value, (n) => this.notificationHandler?.(n));
      return undefined;
    }
    if ('result' in fields || 'error' in fields) {
      let inflating: Promise<void> | undefined;
      this.dispatch(JsonRpcResponseSchema, value, (r) => {
        inflating = this.handleResponse(r);
      });
      return inflating;
    }
    console.warn('[acp-client] dropped frame with no recognizable shape', fields);
    return undefined;
  }

  /** A binary history frame: held for its response, and the response completed if this was its last one. */
  private handleBinary(data: ArrayBuffer): Promise<void> | undefined {
    const frame = parseBinaryFrame(data);
    if (!frame) {
      console.warn('[acp-client] dropped an unreadable binary frame');
      return undefined;
    }
    if (!this.pending.has(frame.id)) return undefined; // its request timed out or never existed
    try {
      return this.binary.frame(frame);
    } catch (error) {
      this.failBinary(frame.id, error);
      return undefined;
    }
  }

  private dispatch<T>(schema: ParseableSchema<T>, value: unknown, onOk: (parsed: T) => void): void {
    const result = schema.safeParse(value);
    if (!result.success || result.data === undefined) {
      console.warn('[acp-client] dropped frame failing schema validation', value);
      return;
    }
    onOk(result.data);
  }

  private handleResponse(response: JsonRpcResponse): Promise<void> | undefined {
    if (response.id === null || response.id === undefined) return undefined;
    const key = String(response.id);
    const entry = this.pending.get(key);
    if (!entry) return undefined;
    // Both response union members are `.loose()`, which defeats `'error' in response` narrowing: read both fields.
    const { error, result } = response as { error?: RpcError; result?: unknown };
    if (error === undefined) {
      const expected = batchFrameCount(result);
      if (expected !== undefined && expected > 0) {
        // Keep the entry (and its deadline) until the frames are in and inflated.
        try {
          return this.binary.response(key, entry, result as Record<string, unknown>, expected);
        } catch (failure) {
          this.failBinary(key, failure);
          return undefined;
        }
      }
    }
    this.dropPending(key);
    if (error !== undefined) entry.reject(error);
    else this.succeed(entry, batchFrameCount(result) === 0 ? { ...(result as object), inflatedBatches: [] } : result);
    return undefined;
  }

  private succeed(entry: PendingEntry, result: unknown): void {
    try {
      entry.onSuccess?.(result);
      entry.resolve(result);
    } catch (error) {
      entry.reject(error);
    }
  }

  /** A corrupt or inconsistent frame fails its own request whole; nothing is applied and the connection carries on. */
  private failBinary(key: string, error: unknown): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.dropPending(key);
    const reason = error instanceof Error ? error.message : String(error);
    console.warn('[acp-client] dropped an undecodable binary history response', reason);
    entry.reject({ code: -32000, message: `invalid binary history frame: ${reason}` });
  }

  private dropPending(key: string): void {
    const entry = this.pending.get(key);
    if (entry) clearTimeout(entry.deadline);
    this.pending.delete(key);
    this.binary.drop(key);
  }

  private rejectAllPending(error: RpcError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.deadline);
      entry.reject(error);
    }
    this.pending.clear();
    this.binary.clear();
  }
}
