/**
 * Dispatches one ACP facade connection's inbound `session/update`,
 * `session/request_permission`, and `_mainframe.dev/*` notifications to
 * registered listeners. Split out of `acp-client.ts` once that file crossed
 * 300 lines — `AcpFacadeClient` owns the connection/reconnect lifecycle and
 * delegates its `on*` methods here; this module owns wire-frame parsing and
 * listener fan-out only. Heartbeat sequences and outbound error replies
 * both reach their target via injected callbacks rather than a direct
 * reference, so this module stays ignorant of `HeartbeatWatchdog`/`RpcConnection`.
 *
 * Every notification is one `NOTIFICATIONS` row plus its entry in
 * `ListenerSignatures`; `handleNotification` is a table lookup, not a switch.
 */
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcRequestId,
  QueuedMessageRef,
  RequestPermissionRequest,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import {
  CompactionParamsSchema,
  GateResolvedParamsSchema,
  HeartbeatParamsSchema,
  MAINFRAME_META_NAMESPACE,
  QueueStateParamsSchema,
  RequestPermissionRequestSchema,
  ResyncParamsSchema,
  TranscriptClearedParamsSchema,
  UpdateSessionNotificationSchema,
} from '@qlan-ro/mainframe-types';

export type SessionUpdateListener = (sessionId: string, update: SessionUpdate) => void;
export type PermissionRequestListener = (id: JsonRpcRequestId, request: RequestPermissionRequest) => void;
export type GateResolvedListener = (sessionId: string, requestId: string) => void;
export type CompactionListener = (sessionId: string, phase: 'started' | 'done') => void;
export type TranscriptClearedListener = (sessionId: string) => void;
export type QueueStateListener = (sessionId: string, refs: QueuedMessageRef[]) => void;
/** `_mainframe.dev/resync` (T20/T34): the chat's message cache evicted from the front — re-replay without wiping the reducer's transcript first. */
export type ResyncListener = (sessionId: string) => void;
/** `_mainframe.dev/heartbeat` — registered by the constructor, not by a public `on*`. */
export type HeartbeatListener = (sequence: number) => void;

/** Every fanned-out method with the signature its listeners are called with. */
interface ListenerSignatures {
  'session/update': SessionUpdateListener;
  'session/request_permission': PermissionRequestListener;
  '_mainframe.dev/heartbeat': HeartbeatListener;
  '_mainframe.dev/queue_state': QueueStateListener;
  '_mainframe.dev/transcript_cleared': TranscriptClearedListener;
  '_mainframe.dev/compaction': CompactionListener;
  '_mainframe.dev/gate_resolved': GateResolvedListener;
  '_mainframe.dev/resync': ResyncListener;
}
type ListenerMethod = keyof ListenerSignatures;
/** `session/request_permission` is a request, not a notification — it has an error reply and stays off the table. */
export type NotificationMethod = Exclude<ListenerMethod, 'session/request_permission'>;

/** Structural rather than `z.ZodType` so this module doesn't need zod as a direct dependency — mirrors `acp-rpc-connection.ts`. */
interface ParseableSchema<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T };
}

/** One listener set holds one method's listeners, so its element type is erased; `register`/`NOTIFICATIONS` pin the real signature per method. */
type AnyListener = (...args: never[]) => void;

interface NotificationEntry {
  readonly method: NotificationMethod;
  readonly schema: ParseableSchema<unknown>;
  readonly project: (parsed: never) => unknown[];
}

function defineNotification<M extends NotificationMethod, T>(
  method: M,
  schema: ParseableSchema<T>,
  project: (parsed: T) => Parameters<ListenerSignatures[M]>,
): NotificationEntry {
  return { method, schema, project };
}

/** Adding a `_mainframe.dev/*` notification costs one row here, one `ListenerSignatures` line, and one `on*` registrar. */
const NOTIFICATIONS: readonly NotificationEntry[] = [
  defineNotification('session/update', UpdateSessionNotificationSchema, (p) => [p.sessionId, p.update]),
  defineNotification('_mainframe.dev/heartbeat', HeartbeatParamsSchema, (p) => [p.sequence]),
  defineNotification('_mainframe.dev/queue_state', QueueStateParamsSchema, (p) => [
    p.sessionId,
    p.refs as QueuedMessageRef[],
  ]),
  defineNotification('_mainframe.dev/transcript_cleared', TranscriptClearedParamsSchema, (p) => [p.sessionId]),
  defineNotification('_mainframe.dev/compaction', CompactionParamsSchema, (p) => [p.sessionId, p.phase]),
  defineNotification('_mainframe.dev/gate_resolved', GateResolvedParamsSchema, (p) => [p.sessionId, p.requestId]),
  defineNotification('_mainframe.dev/resync', ResyncParamsSchema, (p) => [p.sessionId]),
];

const ROUTES: ReadonlyMap<string, NotificationEntry> = new Map(NOTIFICATIONS.map((entry) => [entry.method, entry]));

/** The routed methods, in table order — exported so a test can assert the table and the public `on*` surface stay in step. */
export const NOTIFICATION_METHODS: readonly NotificationMethod[] = NOTIFICATIONS.map((entry) => entry.method);

/** `_mainframe.dev/resync` warns as `resync`; `session/update` keeps its full method name. */
function warnLabel(method: string): string {
  return method.replace(`${MAINFRAME_META_NAMESPACE}/`, '');
}

function parseOrWarn<T>(schema: ParseableSchema<T>, value: unknown, label: string): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    console.warn(`[acp-client] dropped malformed ${label}`, value);
    return undefined;
  }
  return result.data;
}

export class AcpNotificationRouter {
  private readonly listeners = new Map<ListenerMethod, Set<AnyListener>>();

  constructor(
    onHeartbeat: HeartbeatListener,
    private readonly onRequestError: (id: JsonRpcRequestId, code: number, message: string) => void,
  ) {
    this.register('_mainframe.dev/heartbeat', onHeartbeat);
  }

  onSessionUpdate(listener: SessionUpdateListener): () => void {
    return this.register('session/update', listener);
  }

  onPermissionRequest(listener: PermissionRequestListener): () => void {
    return this.register('session/request_permission', listener);
  }

  onGateResolved(listener: GateResolvedListener): () => void {
    return this.register('_mainframe.dev/gate_resolved', listener);
  }

  onCompaction(listener: CompactionListener): () => void {
    return this.register('_mainframe.dev/compaction', listener);
  }

  onTranscriptCleared(listener: TranscriptClearedListener): () => void {
    return this.register('_mainframe.dev/transcript_cleared', listener);
  }

  onQueueState(listener: QueueStateListener): () => void {
    return this.register('_mainframe.dev/queue_state', listener);
  }

  onResync(listener: ResyncListener): () => void {
    return this.register('_mainframe.dev/resync', listener);
  }

  handleNotification(notification: JsonRpcNotification): void {
    const entry = ROUTES.get(notification.method);
    if (!entry) return;
    const parsed = parseOrWarn(entry.schema, notification.params, warnLabel(entry.method));
    if (parsed === undefined) return;
    // Both casts re-apply what `defineNotification` already checked: this entry's
    // parsed type feeds its own projection, which matches its listeners' arguments.
    const args = entry.project(parsed as never) as never[];
    this.listeners.get(entry.method)?.forEach((fn) => fn(...args));
  }

  handleRequest(request: JsonRpcRequest): void {
    if (request.method !== 'session/request_permission' || request.id == null) return;
    const parsed = parseOrWarn(RequestPermissionRequestSchema, request.params, 'session/request_permission');
    if (!parsed) {
      // A schema-rejected gate must not hang the turn — an unanswered
      // request leaves the daemon waiting forever (R3.7). Reply with an
      // error so the daemon's own arm turns it into a deny.
      this.onRequestError(request.id as JsonRpcRequestId, -32602, 'invalid params for session/request_permission');
      return;
    }
    this.listeners
      .get('session/request_permission')
      ?.forEach((fn) => (fn as PermissionRequestListener)(request.id as JsonRpcRequestId, parsed));
  }

  private register<M extends ListenerMethod>(method: M, listener: ListenerSignatures[M]): () => void {
    const existing = this.listeners.get(method);
    const set = existing ?? new Set<AnyListener>();
    if (!existing) this.listeners.set(method, set);
    const erased = listener as AnyListener;
    set.add(erased);
    return () => {
      set.delete(erased);
    };
  }
}
