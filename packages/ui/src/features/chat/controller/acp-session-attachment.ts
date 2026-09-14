/**
 * `AcpSessionPlane`'s connect/replay half — split out (todo #350 plan review
 * fixes, group 3 step 0) once the plane crossed 300 lines. Owns the shared
 * client subscription, full/gap replay, and the empty-refresh guard; the
 * plane keeps the accumulator, gates, and dispatch. See `acp-session-plane.ts`'s
 * module doc for the four-mechanism-collapse this replaces.
 */
import type { JsonRpcRequestId, RequestPermissionRequest, SessionUpdate } from '@qlan-ro/mainframe-types';
import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import { z } from 'zod';
import type {
  CompactionListener,
  GateResolvedListener,
  PermissionRequestListener,
  QueueStateListener,
  ResyncListener,
  SessionUpdateListener,
  TranscriptClearedListener,
} from '../../../lib/daemon/acp-notification-router';
import type { GapListener, ReplayCursor } from '../../../lib/daemon/acp-client';
import type { PromptRequest, PromptResponse, ResumeSessionResponse } from '@qlan-ro/mainframe-types';
import type { ChatStateEvent } from './chat-thread-state';

const ResumeMetaSchema = z
  .object({ itemCount: z.number().int().optional(), fullReplay: z.boolean().optional() })
  .loose();

/** The `AcpFacadeClient` surface this plane needs — narrowed so a test double doesn't reimplement the whole client. */
export interface AcpSessionClientPort {
  onSessionUpdate(listener: SessionUpdateListener): () => void;
  onPermissionRequest(listener: PermissionRequestListener): () => void;
  onGateResolved(listener: GateResolvedListener): () => void;
  onCompaction(listener: CompactionListener): () => void;
  onTranscriptCleared(listener: TranscriptClearedListener): () => void;
  onQueueState(listener: QueueStateListener): () => void;
  onResync(listener: ResyncListener): () => void;
  onGap(listener: GapListener): () => void;
  prompt(sessionId: string, text: string, extra?: Pick<PromptRequest, '_meta'>): Promise<PromptResponse>;
  cancel(sessionId: string): void;
  resume(sessionId: string, cwd: string, replayFrom?: ReplayCursor): Promise<ResumeSessionResponse>;
  respondPermission(id: JsonRpcRequestId, response: import('@qlan-ro/mainframe-types').RequestPermissionResponse): void;
}

export interface AcpSessionAttachmentHost {
  getChatId(): string;
  dispatch(event: ChatStateEvent): void;
  isDisposed(): boolean;
  getLastSettledItemId(): string | null;
  resetSettledCursor(): void;
  resetAccumulator(): void;
  hasAccumulatedItems(): boolean;
  onSessionUpdate(update: SessionUpdate): void;
  onPermissionRequest(rpcId: JsonRpcRequestId, request: RequestPermissionRequest): void;
  onGateResolvedForSession(requestId: string): void;
}

/** Connect/replay half of `AcpSessionPlane`: attach, reattach, gap resume, and the empty-refresh guard. */
export class AcpSessionAttachment {
  private client: AcpSessionClientPort | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private hasAttached = false;

  constructor(private readonly host: AcpSessionAttachmentHost) {}

  get currentClient(): AcpSessionClientPort | null {
    return this.client;
  }

  /** Bind to the shared per-profile client and full-replay this chat. Idempotent per client. */
  async attach(client: AcpSessionClientPort): Promise<void> {
    if (this.client !== client) {
      this.detachListeners();
      this.client = client;
      this.wireListeners(client);
    }
    await this.resume({ type: 'start' });
    this.hasAttached = true;
  }

  /**
   * Full re-replay of the current transcript (e.g. after a server-side
   * wipe). Pre-resets before the round-trip AND bypasses the empty-refresh
   * guard on the way back: the pre-reset alone would be defeated by a live
   * update landing between the reset and the resume response, which would
   * repopulate the accumulator and re-arm the guard just in time to refuse
   * the wipe it's finishing. `bypassGuard` makes a server-initiated wipe
   * deterministic regardless of that race (R2.2 / R1.3).
   */
  async reattach(): Promise<void> {
    this.host.resetSettledCursor();
    this.host.resetAccumulator();
    await this.resume({ type: 'start' }, { bypassGuard: true });
  }

  async resumeFromGap(): Promise<void> {
    if (this.host.isDisposed() || !this.hasAttached) return;
    const settled = this.host.getLastSettledItemId();
    const cursor: ReplayCursor = settled ? { type: 'item', itemId: settled } : { type: 'start' };
    try {
      await this.resume(cursor);
    } catch (error) {
      console.warn('[acp-session] resume-on-gap failed — a later gap/close will retry', error);
    }
  }

  requireClient(): AcpSessionClientPort {
    if (!this.client) throw new Error('[acp-session] not attached — no facade client yet');
    return this.client;
  }

  dispose(): void {
    this.detachListeners();
    this.client = null;
  }

  private wireListeners(client: AcpSessionClientPort): void {
    const chatId = () => this.host.getChatId();
    this.unsubscribe.push(
      client.onSessionUpdate((sessionId, update) => {
        if (sessionId === chatId()) this.host.onSessionUpdate(update);
      }),
      client.onPermissionRequest((id, request) => {
        if (request.sessionId === chatId()) this.host.onPermissionRequest(id, request);
      }),
      client.onGateResolved((sessionId, requestId) => {
        if (sessionId === chatId()) this.host.onGateResolvedForSession(requestId);
      }),
      client.onCompaction((sessionId, phase) => {
        if (sessionId !== chatId()) return;
        this.host.dispatch({ type: phase === 'started' ? 'compact.started' : 'compact.done' });
      }),
      client.onTranscriptCleared((sessionId) => {
        if (sessionId !== chatId()) return;
        // The server wiped the transcript (plan-mode clear-context): drop
        // the local projection and re-replay so tool-call items drop too.
        this.host.dispatch({ type: 'transcript.cleared' });
        this.reattach().catch((error: unknown) =>
          console.warn('[acp-session] reattach after transcript_cleared failed', error),
        );
      }),
      client.onQueueState((sessionId, refs) => {
        if (sessionId !== chatId()) return;
        // Always a full snapshot (never a delta) — the reducer replaces the
        // queued set wholesale, so stale turns cannot survive a reconnect.
        this.host.dispatch({ type: 'queued.snapshot', refs });
      }),
      client.onResync((sessionId) => {
        if (sessionId !== chatId()) return;
        // Cache eviction, NOT a wipe (spec: distinct from
        // transcript_cleared) — re-replay without blanking the reducer's
        // transcript first, or the thread flashes empty mid-conversation.
        this.reattach().catch((error: unknown) => console.warn('[acp-session] reattach after resync failed', error));
      }),
      client.onGap(() => void this.resumeFromGap()),
    );
  }

  private detachListeners(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe.length = 0;
  }

  private async resume(cursor: ReplayCursor, opts: { bypassGuard?: boolean } = {}): Promise<void> {
    const client = this.requireClient();
    const response = await client.resume(this.host.getChatId(), '', cursor);
    const meta = ResumeMetaSchema.safeParse(response._meta?.[MAINFRAME_META_NAMESPACE]);
    const itemCount = meta.success ? (meta.data.itemCount ?? null) : null;
    const isFullReplay = cursor.type === 'start' || (meta.success && meta.data.fullReplay === true);
    if (!isFullReplay) return;
    // Refuse an empty full replay of a transcript we already hold — the
    // legacy `refusesEmptyRefresh` guard: "empty" from the daemon can mean
    // "no history session for this chat yet", never trust it to blank a
    // populated thread (the first attach is never refused, so a genuinely
    // empty thread still renders as one). `reattach()` bypasses this: see
    // its doc comment for why a server-initiated wipe must win regardless.
    if (!opts.bypassGuard && itemCount === 0 && this.hasAttached && this.host.hasAccumulatedItems()) {
      console.warn(`[acp-session] refused an empty full replay for ${this.host.getChatId()}`);
      this.host.dispatch({ type: 'history.refresh.refused' });
      return;
    }
    this.host.resetAccumulator();
  }
}
