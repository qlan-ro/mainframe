/** Negotiation is shared across all chat sessions bound to this per-profile client. */
import {
  type CancelSessionNotification,
  InitializeResponseSchema,
  type InitializeRequest,
  type InitializeResponse,
  type JsonRpcRequestId,
  MAINFRAME_META_NAMESPACE,
  type MainframeCapabilities,
  PINNED_PROTOCOL_VERSION,
  type PromptRequest,
  type PromptResponse,
  PromptResponseSchema,
  type ReplayCursor,
  type RequestPermissionResponse,
  REVISION_CURSORS_OPT_IN_KEY,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  ResumeSessionResponseSchema,
} from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from './active-daemon';
import { AcpCapabilityState, parseCapabilities, type CapabilitiesListener } from './acp-capability-state';
import { HeartbeatWatchdog } from './acp-heartbeat-watchdog';
import {
  AcpNotificationRouter,
  type CompactionListener,
  type CursorListener,
  type GateResolvedListener,
  type PermissionRequestListener,
  type QueueStateListener,
  type ReplayCompleteListener,
  type ResyncListener,
  type SessionUpdateListener,
  type TranscriptClearedListener,
} from './acp-notification-router';
import { RpcConnection, type AcpSocketFactory, type AcpSocketLike } from './acp-rpc-connection';
/** `mainframe_acp::resume::ReplayCursor`'s wire shape (todo #377 added the `revision` variant) — single-canonical-type in `@qlan-ro/mainframe-types`, re-exported for existing `from './acp-client'` imports. */
export type { ReplayCursor };
/** Production default; overridden per-connection by the daemon's advertised `heartbeatIntervalMs`. */
const FALLBACK_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_CLIENT_INFO = { name: 'mainframe-ui', version: '0.0.0' };

export type GapListener = () => void;

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

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;

export class AcpFacadeClient {
  private connection: RpcConnection | null = null;
  private watchdog: HeartbeatWatchdog | null = null;
  private readonly capabilities = new AcpCapabilityState();
  private connectAttempt = 0;
  private connectPromise: Promise<InitializeResponse> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  private manuallyClosed = false;
  /** Bumped on every NEW underlying connection (first one included) — lets a consumer tell a live-socket `onGap` from a dead-socket reconnect, which `connected` can't (it's already `true` again by the time the gap fires). */
  private generation = 0;
  private readonly router = new AcpNotificationRouter(
    (sequence) => this.watchdog?.observe(sequence),
    (id, code, message) => this.connection?.respondError(id, code, message),
  );
  private readonly gapListeners = new Set<GapListener>();

  constructor(
    private readonly profile: string,
    private readonly deps: AcpFacadeClientDeps = {},
  ) {}

  get mainframeCapabilities(): MainframeCapabilities | null {
    return this.capabilities.current;
  }

  onCapabilitiesChanged(listener: CapabilitiesListener): () => void {
    return this.capabilities.subscribe(listener);
  }

  /** See the field doc — bumped on every new underlying connection, first one included. */
  get connectionGeneration(): number {
    return this.generation;
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

  /** Install successful negotiation in the reply handler before the next session frame can dispatch. */
  async connect(): Promise<InitializeResponse> {
    const attempt = ++this.connectAttempt;
    const url = (this.deps.url ?? (() => defaultUrl(this.profile)))();
    const connection = new RpcConnection(url, this.deps.createSocket ?? defaultSocketFactory);
    connection.onNotification((n) => {
      if (this.connection === connection) this.router.handleNotification(n);
    });
    connection.onRequest((r) => {
      if (this.connection === connection) this.router.handleRequest(r);
    });
    connection.onClose(() => this.handleClose(connection));
    try {
      await connection.open();

      // `_meta` opts into revision-versioned resume cursors (todo #377) — ignored by a daemon that doesn't advertise `revisionCursors` back.
      const request: InitializeRequest = {
        protocolVersion: PINNED_PROTOCOL_VERSION,
        info: this.deps.clientInfo ?? DEFAULT_CLIENT_INFO,
        _meta: { [MAINFRAME_META_NAMESPACE]: { [REVISION_CURSORS_OPT_IN_KEY]: true } },
      };
      let response!: InitializeResponse;
      await connection.sendRequest('initialize', request, (result) => {
        if (attempt !== this.connectAttempt) throw new Error('[acp-client] initialization superseded');
        response = this.acceptInitialize(connection, result);
      });
      return response;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  disconnect(): void {
    this.connectAttempt += 1;
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

  /**
   * Drop this session's live stream on the daemon (`_mainframe.dev/session_detach`,
   * D2 dormancy). Best-effort: a disconnected client has nothing to notify —
   * the daemon already lost this connection — so this never throws.
   */
  detach(sessionId: string): void {
    if (!this.connected) return;
    this.requireConnection().sendNotification('_mainframe.dev/session_detach', { sessionId });
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

  /** The chat's server-side message cache evicted from the front (`_mainframe.dev/resync`) — re-replay without wiping the transcript first. */
  onResync(listener: ResyncListener): () => void {
    return this.router.onResync(listener);
  }

  /** Closes exactly one `session/resume` replay (`_mainframe.dev/replay_complete`, spec Decision 38). */
  onReplayComplete(listener: ReplayCompleteListener): () => void {
    return this.router.onReplayComplete(listener);
  }

  /** Advances the durable revision cursor outside a resume round trip (`_mainframe.dev/cursor`, todo #377). */
  onCursor(listener: CursorListener): () => void {
    return this.router.onCursor(listener);
  }

  /** Fires when the caller should call `resume()` to converge: a heartbeat gap, silence, or the socket closing. */
  onGap(listener: GapListener): () => void {
    this.gapListeners.add(listener);
    return () => this.gapListeners.delete(listener);
  }

  private acceptInitialize(connection: RpcConnection, result: unknown): InitializeResponse {
    const response = InitializeResponseSchema.parse(result);
    if (response.protocolVersion !== PINNED_PROTOCOL_VERSION) {
      throw new Error(`[acp-client] daemon negotiated an unsupported protocol version ${response.protocolVersion}`);
    }
    const capabilities = parseCapabilities(response);
    this.connection = connection;
    this.generation += 1;
    this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    this.watchdog?.stop();
    this.armWatchdog(capabilities?.heartbeatIntervalMs ?? FALLBACK_HEARTBEAT_INTERVAL_MS);
    this.capabilities.replace(capabilities);
    return response;
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

  /** Ignore stale socket closures; reconnect before asking sessions to resume. */
  private handleClose(connection: RpcConnection): void {
    if (this.connection !== connection) return;
    this.watchdog?.stop();
    this.watchdog = null;
    this.connection = null;
    this.connectPromise = null;
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
