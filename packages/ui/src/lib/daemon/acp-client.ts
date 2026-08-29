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
 * chat of that adapter (`acp-clients.ts`), multiplexing N sessions. Inbound
 * notification/request parsing and listener fan-out live in
 * `acp-notification-router.ts` — this file owns connection lifecycle and
 * reconnect only, delegating its `on*` listener methods to that router.
 */
import type {
  CancelSessionNotification,
  InitializeRequest,
  InitializeResponse,
  JsonRpcRequestId,
  MainframeCapabilities,
  PromptRequest,
  PromptResponse,
  RequestPermissionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
} from '@qlan-ro/mainframe-types';
import {
  InitializeResponseSchema,
  MAINFRAME_META_NAMESPACE,
  MainframeCapabilitiesSchema,
  PINNED_PROTOCOL_VERSION,
  PromptResponseSchema,
  ResumeSessionResponseSchema,
} from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from './active-daemon';
import { HeartbeatWatchdog } from './acp-heartbeat-watchdog';
import {
  AcpNotificationRouter,
  type CompactionListener,
  type GateResolvedListener,
  type PermissionRequestListener,
  type QueueStateListener,
  type SessionUpdateListener,
  type TranscriptClearedListener,
} from './acp-notification-router';
import { RpcConnection, type AcpSocketFactory, type AcpSocketLike } from './acp-rpc-connection';

/** Matches `mainframe_acp::resume::ReplayCursor`'s wire shape — opaque on the vendored type by design (session.ts). */
export type ReplayCursor = { type: 'start' } | { type: 'item'; itemId: string };

/** Production default; overridden per-connection by the daemon's advertised `heartbeatIntervalMs`. */
const FALLBACK_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_CLIENT_INFO = { name: 'mainframe-ui', version: '0.0.0' };

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
  private readonly router = new AcpNotificationRouter((sequence) => this.watchdog?.observe(sequence));
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
    connection.onNotification((n) => this.router.handleNotification(n));
    connection.onRequest((r) => this.router.handleRequest(r));
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
    return this.router.onSessionUpdate(listener);
  }

  onPermissionRequest(listener: PermissionRequestListener): () => void {
    return this.router.onPermissionRequest(listener);
  }

  /** Fires when a gate this client did not answer resolved elsewhere (another client or the CLI). */
  onGateResolved(listener: GateResolvedListener): () => void {
    return this.router.onGateResolved(listener);
  }

  /** Live compaction progress for a session (`_mainframe.dev/compaction`). */
  onCompaction(listener: CompactionListener): () => void {
    return this.router.onCompaction(listener);
  }

  /** The server wiped a session's transcript (`_mainframe.dev/transcript_cleared`). */
  onTranscriptCleared(listener: TranscriptClearedListener): () => void {
    return this.router.onTranscriptCleared(listener);
  }

  /** A session's full queued-prompt snapshot (`_mainframe.dev/queue_state`). */
  onQueueState(listener: QueueStateListener): () => void {
    return this.router.onQueueState(listener);
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
}
