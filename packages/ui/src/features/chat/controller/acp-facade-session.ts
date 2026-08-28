/**
 * Facade-mode chat session (todo #350, plan task 20) — the ACP counterpart
 * of `chat-thread-controller.ts`. A new module, not a rewrite of that
 * controller: the daemon's facade endpoints are pure, unit-tested dispatch
 * functions with no live `ChatManager`/socket wiring yet
 * (`docs/API-REFERENCE.md` § ACP Chat Facade, "Status: not yet live" —
 * confirmed against `mainframe-server/src/acp_ws.rs`, which calls only
 * `handle_frame`, never `handle_frame_with_prompt`/`dispatch_resume`).
 * Cutting the production controller over to a transport the daemon can't yet
 * serve would ship a broken chat surface; `chat-controller-registry.ts` and
 * the legacy dialect are untouched.
 *
 * Maps the four legacy reconnect re-seed paths onto the facade's single
 * primitive, `session/resume`:
 *  - `subscribe:ack` re-seed + REST history refresh → `attach()`'s
 *    `{type:'start'}` full replay.
 *  - queue snapshot → `sendMessage()`'s `PromptResponse._meta` (no separate
 *    fetch: acceptance IS the queued-state carrier, spec decision 11).
 *  - pending-permission recovery → falls out of `onPermissionRequest` for
 *    free: `gates::build_request`'s redelivery on resume and a live mid-turn
 *    gate are both plain `session/request_permission` requests to the
 *    client, indistinguishable at this layer.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type {
  JsonRpcRequestId,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  SessionUpdate,
  StopReason,
} from '@qlan-ro/mainframe-types';
import type {
  GapListener,
  PermissionRequestListener,
  ReplayCursor,
  SessionUpdateListener,
} from '../../../lib/daemon/acp-client';
import { AcpItemAccumulator } from '../view-model/acp-item-accumulator';
import { convertAcpItems } from '../view-model/convert-acp-item';

/** The `AcpFacadeClient` surface this module needs — narrowed so a test double doesn't have to reimplement the whole client. */
export interface AcpSessionClientPort {
  onSessionUpdate(listener: SessionUpdateListener): () => void;
  onPermissionRequest(listener: PermissionRequestListener): () => void;
  onGap(listener: GapListener): () => void;
  prompt(sessionId: string, text: string): Promise<PromptResponse>;
  cancel(sessionId: string): void;
  resume(sessionId: string, cwd: string, replayFrom?: ReplayCursor): Promise<ResumeSessionResponse>;
  respondPermission(id: JsonRpcRequestId, response: RequestPermissionResponse): void;
}

export interface AcpPendingPermission {
  id: JsonRpcRequestId;
  request: RequestPermissionRequest;
}

export interface AcpFacadeSessionState {
  messages: ThreadMessageLike[];
  runState: 'idle' | 'running';
  stopReason: StopReason | null;
  pendingPermission: AcpPendingPermission | null;
  /** Set only while an accepted prompt is queued behind a running turn (spec decision 11). */
  queuedPosition: number | null;
}

export interface AcpFacadeSessionDeps {
  client: AcpSessionClientPort;
  sessionId: string;
  cwd: string;
  now?: () => number;
}

function initialState(): AcpFacadeSessionState {
  return { messages: [], runState: 'idle', stopReason: null, pendingPermission: null, queuedPosition: null };
}

export class AcpFacadeSession {
  private readonly accumulator = new AcpItemAccumulator();
  private readonly firstSeenAt = new Map<string, Date>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: Array<() => void>;
  private state = initialState();
  /** Resume cursor: only advanced when the turn goes idle — a cursor into a still-streaming item would drop its tail (resume.rs's `replay()` re-seeds up to and including the cursor at its CURRENT content). */
  private lastSettledItemId: string | null = null;

  constructor(private readonly deps: AcpFacadeSessionDeps) {
    this.unsubscribe = [
      deps.client.onSessionUpdate((sessionId, update) => {
        if (sessionId === deps.sessionId) this.handleUpdate(update);
      }),
      deps.client.onPermissionRequest((id, request) => {
        if (request.sessionId === deps.sessionId) this.setPendingPermission({ id, request });
      }),
      deps.client.onGap(() => void this.resumeFromGap()),
    ];
  }

  getState(): AcpFacadeSessionState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Full re-seed — the facade's one replacement for both `subscribe:ack` re-seed and REST history refresh. */
  async attach(): Promise<void> {
    this.accumulator.reset();
    this.firstSeenAt.clear();
    await this.deps.client.resume(this.deps.sessionId, this.deps.cwd, { type: 'start' });
  }

  async sendMessage(text: string): Promise<void> {
    const response = await this.deps.client.prompt(this.deps.sessionId, text);
    const queuedState = response._meta?.['_mainframe.dev'] as { position?: number } | undefined;
    this.update({
      ...this.state,
      queuedPosition: queuedState?.position ?? null,
      runState: queuedState ? this.state.runState : 'running',
    });
  }

  cancel(): void {
    this.deps.client.cancel(this.deps.sessionId);
  }

  respondPermission(response: RequestPermissionResponse): void {
    const pending = this.state.pendingPermission;
    if (!pending) return;
    this.deps.client.respondPermission(pending.id, response);
    this.update({ ...this.state, pendingPermission: null });
  }

  dispose(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.listeners.clear();
  }

  private async resumeFromGap(): Promise<void> {
    const cursor: ReplayCursor = this.lastSettledItemId
      ? { type: 'item', itemId: this.lastSettledItemId }
      : { type: 'start' };
    try {
      const response = await this.deps.client.resume(this.deps.sessionId, this.deps.cwd, cursor);
      const meta = response._meta?.['_mainframe.dev'] as { fullReplay?: boolean } | undefined;
      if (meta?.fullReplay) {
        this.accumulator.reset();
        this.firstSeenAt.clear();
      }
    } catch (error) {
      console.warn('[acp-facade-session] resume-on-gap failed — a later gap/close will retry', error);
    }
  }

  private handleUpdate(update: SessionUpdate): void {
    this.accumulator.apply(update);
    if (update.sessionUpdate === 'state_update') {
      this.applyStateUpdate(update);
      return;
    }
    this.refreshMessages();
  }

  private applyStateUpdate(update: Extract<SessionUpdate, { sessionUpdate: 'state_update' }>): void {
    if (update.state === 'running') {
      this.update({ ...this.state, runState: 'running', stopReason: null });
      return;
    }
    if (update.state === 'idle') {
      const items = this.accumulator.itemsInOrder;
      this.lastSettledItemId = items.length > 0 ? items[items.length - 1]!.id : this.lastSettledItemId;
      this.update({ ...this.state, runState: 'idle', stopReason: update.stopReason ?? null, queuedPosition: null });
    }
  }

  private setPendingPermission(pending: AcpPendingPermission): void {
    this.update({ ...this.state, pendingPermission: pending });
  }

  private refreshMessages(): void {
    const items = this.accumulator.itemsInOrder;
    const now = () => new Date(this.deps.now?.() ?? Date.now());
    for (const item of items) {
      if (!this.firstSeenAt.has(item.id)) this.firstSeenAt.set(item.id, now());
    }
    const messages = convertAcpItems(items, (id) => this.firstSeenAt.get(id) ?? now());
    this.update({ ...this.state, messages });
  }

  private update(next: AcpFacadeSessionState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
