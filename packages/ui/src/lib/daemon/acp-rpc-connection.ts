/**
 * JSON-RPC 2.0 framing + request/response correlation over one ACP facade WS
 * connection (todo #350, plan task 19). Classification mirrors the daemon's
 * `rpc::parse_frame` (`mainframe-acp/src/rpc.rs`): frame *shape* — which keys
 * are present — decides request vs. notification vs. response, not a
 * try-then-fallback; a request's `id` can legitimately be `null`; a
 * notification never has an `id` key at all.
 */
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcRequestId, JsonRpcResponse } from '@qlan-ro/mainframe-types';
import { JsonRpcNotificationSchema, JsonRpcRequestSchema, JsonRpcResponseSchema } from '@qlan-ro/mainframe-types';

export interface AcpSocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
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
  reject: (error: RpcError) => void;
}

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

  constructor(
    private readonly url: string,
    private readonly createSocket: AcpSocketFactory,
  ) {}

  /** Opens the socket; resolves once it reports `onopen`, rejects if it never does. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(this.url);
      this.socket = socket;
      let settledOpen = false;
      socket.onopen = () => {
        settledOpen = true;
        resolve();
      };
      socket.onmessage = (ev) => this.handleMessage(ev.data);
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

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
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

  private write(frame: unknown): void {
    if (!this.socket) {
      console.warn('[acp-client] dropped outbound frame — connection not open', frame);
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  private handleMessage(raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      console.warn('[acp-client] dropped malformed frame — not JSON');
      return;
    }
    if (typeof value !== 'object' || value === null) {
      console.warn('[acp-client] dropped malformed frame — not an object', value);
      return;
    }
    const fields = value as Record<string, unknown>;
    if ('method' in fields) {
      if ('id' in fields) this.dispatch(JsonRpcRequestSchema, value, (r) => this.requestHandler?.(r));
      else this.dispatch(JsonRpcNotificationSchema, value, (n) => this.notificationHandler?.(n));
      return;
    }
    if ('result' in fields || 'error' in fields) {
      this.dispatch(JsonRpcResponseSchema, value, (r) => this.handleResponse(r));
      return;
    }
    console.warn('[acp-client] dropped frame with no recognizable shape', fields);
  }

  private dispatch<T>(schema: ParseableSchema<T>, value: unknown, onOk: (parsed: T) => void): void {
    const result = schema.safeParse(value);
    if (!result.success || result.data === undefined) {
      console.warn('[acp-client] dropped frame failing schema validation', value);
      return;
    }
    onOk(result.data);
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === null || response.id === undefined) return;
    const key = String(response.id);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    // Both `JsonRpcResponseSchema` union members are `.loose()` (permits
    // unknown extra keys), so their inferred types carry an index signature
    // that defeats plain `'error' in response` narrowing to a single member —
    // read both optional fields explicitly instead.
    const { error, result } = response as { error?: RpcError; result?: unknown };
    if (error !== undefined) entry.reject(error);
    else entry.resolve(result);
  }

  private rejectAllPending(error: RpcError): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
