/**
 * Dispatches one ACP facade connection's inbound `session/update`,
 * `session/request_permission`, and `_mainframe.dev/*` notifications to
 * registered listeners. Split out of `acp-client.ts` once that file crossed
 * 300 lines — `AcpFacadeClient` owns the connection/reconnect lifecycle and
 * delegates its `on*` methods here; this module owns wire-frame parsing and
 * listener fan-out only. Heartbeat sequences reach the watchdog via a
 * callback rather than a direct reference, so this module stays ignorant of
 * `HeartbeatWatchdog`.
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
  QueueStateParamsSchema,
  RequestPermissionRequestSchema,
  TranscriptClearedParamsSchema,
  UpdateSessionNotificationSchema,
} from '@qlan-ro/mainframe-types';

export type SessionUpdateListener = (sessionId: string, update: SessionUpdate) => void;
export type PermissionRequestListener = (id: JsonRpcRequestId, request: RequestPermissionRequest) => void;
export type GateResolvedListener = (sessionId: string, requestId: string) => void;
export type CompactionListener = (sessionId: string, phase: 'started' | 'done') => void;
export type TranscriptClearedListener = (sessionId: string) => void;
export type QueueStateListener = (sessionId: string, refs: QueuedMessageRef[]) => void;

/** Structural rather than `z.ZodType` so this module doesn't need zod as a direct dependency — mirrors `acp-rpc-connection.ts`. */
interface ParseableSchema<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T };
}

export class AcpNotificationRouter {
  private readonly sessionUpdateListeners = new Set<SessionUpdateListener>();
  private readonly permissionRequestListeners = new Set<PermissionRequestListener>();
  private readonly gateResolvedListeners = new Set<GateResolvedListener>();
  private readonly compactionListeners = new Set<CompactionListener>();
  private readonly transcriptClearedListeners = new Set<TranscriptClearedListener>();
  private readonly queueStateListeners = new Set<QueueStateListener>();

  constructor(private readonly onHeartbeat: (sequence: number) => void) {}

  onSessionUpdate(listener: SessionUpdateListener): () => void {
    this.sessionUpdateListeners.add(listener);
    return () => this.sessionUpdateListeners.delete(listener);
  }

  onPermissionRequest(listener: PermissionRequestListener): () => void {
    this.permissionRequestListeners.add(listener);
    return () => this.permissionRequestListeners.delete(listener);
  }

  onGateResolved(listener: GateResolvedListener): () => void {
    this.gateResolvedListeners.add(listener);
    return () => this.gateResolvedListeners.delete(listener);
  }

  onCompaction(listener: CompactionListener): () => void {
    this.compactionListeners.add(listener);
    return () => this.compactionListeners.delete(listener);
  }

  onTranscriptCleared(listener: TranscriptClearedListener): () => void {
    this.transcriptClearedListeners.add(listener);
    return () => this.transcriptClearedListeners.delete(listener);
  }

  onQueueState(listener: QueueStateListener): () => void {
    this.queueStateListeners.add(listener);
    return () => this.queueStateListeners.delete(listener);
  }

  handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'session/update':
        this.handleSessionUpdate(notification.params);
        return;
      case '_mainframe.dev/heartbeat':
        this.handleHeartbeat(notification.params);
        return;
      case '_mainframe.dev/queue_state':
        this.handleQueueState(notification.params);
        return;
      case '_mainframe.dev/transcript_cleared':
        this.handleTranscriptCleared(notification.params);
        return;
      case '_mainframe.dev/compaction':
        this.handleCompaction(notification.params);
        return;
      case '_mainframe.dev/gate_resolved':
        this.handleGateResolved(notification.params);
        return;
    }
  }

  handleRequest(request: JsonRpcRequest): void {
    if (request.method !== 'session/request_permission' || request.id == null) return;
    const parsed = this.parseOrWarn(RequestPermissionRequestSchema, request.params, 'session/request_permission');
    if (!parsed) return;
    this.permissionRequestListeners.forEach((fn) => fn(request.id as JsonRpcRequestId, parsed));
  }

  private handleSessionUpdate(params: unknown): void {
    const parsed = this.parseOrWarn(UpdateSessionNotificationSchema, params, 'session/update');
    if (!parsed) return;
    this.sessionUpdateListeners.forEach((fn) => fn(parsed.sessionId, parsed.update));
  }

  private handleHeartbeat(params: unknown): void {
    const parsed = this.parseOrWarn(HeartbeatParamsSchema, params, 'heartbeat');
    if (!parsed) return;
    this.onHeartbeat(parsed.sequence);
  }

  private handleQueueState(params: unknown): void {
    const parsed = this.parseOrWarn(QueueStateParamsSchema, params, 'queue_state');
    if (!parsed) return;
    this.queueStateListeners.forEach((fn) => fn(parsed.sessionId, parsed.refs as QueuedMessageRef[]));
  }

  private handleTranscriptCleared(params: unknown): void {
    const parsed = this.parseOrWarn(TranscriptClearedParamsSchema, params, 'transcript_cleared');
    if (!parsed) return;
    this.transcriptClearedListeners.forEach((fn) => fn(parsed.sessionId));
  }

  private handleCompaction(params: unknown): void {
    const parsed = this.parseOrWarn(CompactionParamsSchema, params, 'compaction');
    if (!parsed) return;
    this.compactionListeners.forEach((fn) => fn(parsed.sessionId, parsed.phase));
  }

  private handleGateResolved(params: unknown): void {
    const parsed = this.parseOrWarn(GateResolvedParamsSchema, params, 'gate_resolved');
    if (!parsed) return;
    this.gateResolvedListeners.forEach((fn) => fn(parsed.sessionId, parsed.requestId));
  }

  private parseOrWarn<T>(schema: ParseableSchema<T>, value: unknown, label: string): T | undefined {
    const result = schema.safeParse(value);
    if (!result.success || result.data === undefined) {
      console.warn(`[acp-client] dropped malformed ${label}`, value);
      return undefined;
    }
    return result.data;
  }
}
