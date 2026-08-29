/**
 * ACP v2 chat-facade client (todo #350): `/acp/{profile}` JSON-RPC-over-WS,
 * handshake, session prompt/cancel/resume, permission gates, reconnect with
 * backoff, and the heartbeat/gap-resume sync contract. This IS the desktop
 * chat transcript path (`docs/API-REFERENCE.md` § ACP Chat Facade); the
 * legacy `lib/daemon/ws-client.ts` dialect remains only for the side-band
 * event families the facade does not model (chat.updated config, queued
 * refs, background tasks, worktree offers, workflow runs, compaction
 * markers) until the daemon retires it. Session-state accumulation lives in
 * `features/chat/view-model/acp-item-accumulator.ts`; this module only
 * speaks the wire protocol. One client per adapter profile, shared by every
 * chat of that adapter (`acp-clients.ts`), multiplexing N sessions.
 */
import type {
  CancelSessionNotification,
  InitializeRequest,
  InitializeResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcRequestId,
  MainframeCapabilities,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import {
  CompactionParamsSchema,
  GateResolvedParamsSchema,
  HeartbeatParamsSchema,
  InitializeResponseSchema,
  MAINFRAME_META_NAMESPACE,
  MainframeCapabilitiesSchema,
  PINNED_PROTOCOL_VERSION,
  PromptResponseSchema,
  RequestPermissionRequestSchema,
  ResumeSessionResponseSchema,
  UpdateSessionNotificationSchema,
} from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from './active-daemon';
import { HeartbeatWatchdog } from './acp-heartbeat-watchdog';
import { RpcConnection, type AcpSocketFactory, type AcpSocketLike } from './acp-rpc-connection';

/** Matches `mainframe_acp::resume::ReplayCursor`'s wire shape — opaque on the vendored type by design (session.ts). */
export type ReplayCursor = { type: 'start' } | { type: 'item'; itemId: string };

/** Production default; overridden per-connection by the daemon's advertised `heartbeatIntervalMs`. */
const FALLBACK_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_CLIENT_INFO = { name: 'mainframe-ui', version: '0.0.0' };

export type SessionUpdateListener = (sessionId: string, update: SessionUpdate) => void;
export type PermissionRequestListener = (id: JsonRpcRequestId, request: RequestPermissionRequest) => void;
/** `requestId` is the JSON-RPC id the gate's `session/request_permission` traveled under. */
export type GateResolvedListener = (sessionId: string, requestId: string) => void;
export type CompactionListener = (sessionId: string, phase: 'started' | 'done') => void;
export type GapListener = () => void;
export type CloseListener = () => void;

export interface AcpFacadeClientDeps {
  /** Resolved fresh on every `connect()` — defaults to the active daemon target. */
  url?: () => string;
  createSocket?: AcpSocketFactory;
  clientInfo?: { name: string; version: string };
}

function defaultUrl(profile: string): string {
  const target = getActiveDaemon();
  const base = `${target.baseUrl.replace(/^http/, 'ws')}/acp/${encodeURIComponent(profile)}`;
  return target.token ? `${base}?token=${encodeURIComponent(target.token)}` : base;
}

function defaultSocketFactory(url: string): AcpSocketLike {
  return new WebSocket(url) as unknown as AcpSocketLike;
}

function parseCapabilities(response: InitializeResponse): MainframeCapabilities | null {
  const raw = response._meta?.[MAINFRAME_META_NAMESPACE];
  if (raw === undefined) return null;
  const parsed = MainframeCapabilitiesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;

export class AcpFacadeClient {
  private connection: RpcConnection | null = null;
  private watchdog: HeartbeatWatchdog | null = null;
  private capabilities: MainframeCapabilities | null = null;
  private connectPromise: Promise<InitializeResponse> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  private manuallyClosed = false;
  private readonly sessionUpdateListeners = new Set<SessionUpdateListener>();
  private readonly permissionRequestListeners = new Set<PermissionRequestListener>();
  private readonly gateResolvedListeners = new Set<GateResolvedListener>();
  private readonly compactionListeners = new Set<CompactionListener>();
  private readonly gapListeners = new Set<GapListener>();
  private readonly closeListeners = new Set<CloseListener>();

  constructor(
    private readonly profile: string,
    private readonly deps: AcpFacadeClientDeps = {},
  ) {}

  get mainframeCapabilities(): MainframeCapabilities | null {
    return this.capabilities;
  }

  get connected(): boolean {
    return this.connection !== null;
  }

  /**
   * Idempotent connect: concurrent callers share one in-flight handshake, and
   * a client that already initialized resolves immediately. This is the entry
   * the per-chat controllers use — the first attach dials, the rest join.
   */
  ensureConnected(): Promise<InitializeResponse> {
    this.manuallyClosed = false;
    if (this.connectPromise) return this.connectPromise;
    const attempt = this.connect().catch((error: unknown) => {
      if (this.connectPromise === attempt) this.connectPromise = null;
      throw error;
    });
    this.connectPromise = attempt;
    return attempt;
  }

  async connect(): Promise<InitializeResponse> {
    const url = (this.deps.url ?? (() => defaultUrl(this.profile)))();
    const connection = new RpcConnection(url, this.deps.createSocket ?? defaultSocketFactory);
    connection.onNotification((n) => this.handleNotification(n));
    connection.onRequest((r) => this.handleRequest(r));
    connection.onClose(() => this.handleClose());
    this.connection = connection;
    await connection.open();

    const request: InitializeRequest = {
      protocolVersion: PINNED_PROTOCOL_VERSION,
      info: this.deps.clientInfo ?? DEFAULT_CLIENT_INFO,
    };
    const result = await connection.sendRequest('initialize', request);
    const response = InitializeResponseSchema.parse(result);
    if (response.protocolVersion !== PINNED_PROTOCOL_VERSION) {
      throw new Error(`[acp-client] daemon negotiated an unsupported protocol version ${response.protocolVersion}`);
    }
    this.capabilities = parseCapabilities(response);
    this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    this.armWatchdog(this.capabilities?.heartbeatIntervalMs ?? FALLBACK_HEARTBEAT_INTERVAL_MS);
    return response;
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectPromise = null;
    this.watchdog?.stop();
    this.watchdog = null;
    this.connection?.close();
    this.connection = null;
  }

  async prompt(sessionId: string, text: string, extra?: Pick<PromptRequest, '_meta'>): Promise<PromptResponse> {
    const request: PromptRequest = { sessionId, prompt: [{ type: 'text', text }], ...extra };
    const result = await this.requireConnection().sendRequest('session/prompt', request);
    return PromptResponseSchema.parse(result);
  }

  cancel(sessionId: string): void {
    const notification: CancelSessionNotification = { sessionId };
    this.requireConnection().sendNotification('session/cancel', notification);
  }

  async resume(sessionId: string, cwd: string, replayFrom?: ReplayCursor): Promise<ResumeSessionResponse> {
    const request: ResumeSessionRequest = { sessionId, cwd, ...(replayFrom !== undefined ? { replayFrom } : {}) };
    const result = await this.requireConnection().sendRequest('session/resume', request);
    return ResumeSessionResponseSchema.parse(result);
  }

  respondPermission(id: JsonRpcRequestId, response: RequestPermissionResponse): void {
    this.requireConnection().respond(id, response);
  }

  onSessionUpdate(listener: SessionUpdateListener): () => void {
    this.sessionUpdateListeners.add(listener);
    return () => this.sessionUpdateListeners.delete(listener);
  }

  onPermissionRequest(listener: PermissionRequestListener): () => void {
    this.permissionRequestListeners.add(listener);
    return () => this.permissionRequestListeners.delete(listener);
  }

  /** Fires when a gate this client did not answer resolved elsewhere (another client or the CLI). */
  onGateResolved(listener: GateResolvedListener): () => void {
    this.gateResolvedListeners.add(listener);
    return () => this.gateResolvedListeners.delete(listener);
  }

  /** Live compaction progress for a session (`_mainframe.dev/compaction`). */
  onCompaction(listener: CompactionListener): () => void {
    this.compactionListeners.add(listener);
    return () => this.compactionListeners.delete(listener);
  }

  /** Fires when the caller should call `resume()` to converge: a heartbeat gap, silence, or the socket closing. */
  onGap(listener: GapListener): () => void {
    this.gapListeners.add(listener);
    return () => this.gapListeners.delete(listener);
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private requireConnection(): RpcConnection {
    if (!this.connection) throw new Error('[acp-client] not connected — call connect() first');
    return this.connection;
  }

  private armWatchdog(intervalMs: number): void {
    this.watchdog = new HeartbeatWatchdog(intervalMs, () => this.notifyGap());
    this.watchdog.arm();
  }

  private notifyGap(): void {
    this.gapListeners.forEach((fn) => fn());
  }

  /**
   * Socket death: reconnect with backoff, and only THEN fire the gap
   * listeners — a gap fired while the socket is down would make every
   * session's `resume()` throw. The watchdog's silence gap (socket alive)
   * still fires immediately via `notifyGap`.
   */
  private handleClose(): void {
    this.watchdog?.stop();
    this.watchdog = null;
    this.connection = null;
    this.connectPromise = null;
    this.closeListeners.forEach((fn) => fn());
    if (this.manuallyClosed) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected()
        .then(() => this.notifyGap())
        .catch(() => this.scheduleReconnect());
    }, delay);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === 'session/update') {
      const parsed = UpdateSessionNotificationSchema.safeParse(notification.params);
      if (!parsed.success) {
        console.warn('[acp-client] dropped malformed session/update', notification.params);
        return;
      }
      this.sessionUpdateListeners.forEach((fn) => fn(parsed.data.sessionId, parsed.data.update));
      return;
    }
    if (notification.method === '_mainframe.dev/heartbeat') {
      const parsed = HeartbeatParamsSchema.safeParse(notification.params);
      if (!parsed.success) {
        console.warn('[acp-client] dropped malformed heartbeat', notification.params);
        return;
      }
      this.watchdog?.observe(parsed.data.sequence);
      return;
    }
    if (notification.method === '_mainframe.dev/compaction') {
      const parsed = CompactionParamsSchema.safeParse(notification.params);
      if (!parsed.success) {
        console.warn('[acp-client] dropped malformed compaction', notification.params);
        return;
      }
      this.compactionListeners.forEach((fn) => fn(parsed.data.sessionId, parsed.data.phase));
      return;
    }
    if (notification.method === '_mainframe.dev/gate_resolved') {
      const parsed = GateResolvedParamsSchema.safeParse(notification.params);
      if (!parsed.success) {
        console.warn('[acp-client] dropped malformed gate_resolved', notification.params);
        return;
      }
      this.gateResolvedListeners.forEach((fn) => fn(parsed.data.sessionId, parsed.data.requestId));
    }
  }

  private handleRequest(request: JsonRpcRequest): void {
    if (request.method !== 'session/request_permission' || request.id == null) return;
    const parsed = RequestPermissionRequestSchema.safeParse(request.params);
    if (!parsed.success) {
      console.warn('[acp-client] dropped malformed session/request_permission', request.params);
      return;
    }
    this.permissionRequestListeners.forEach((fn) => fn(request.id as JsonRpcRequestId, parsed.data));
  }
}
