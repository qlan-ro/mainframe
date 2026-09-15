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
import { FullReplayRetry } from './acp-full-replay';

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
  /** Drop this session's live stream on the daemon (D2 dormancy) — `_mainframe.dev/session_detach`. */
  detach(sessionId: string): void;
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

/**
 * Connect/replay half of `AcpSessionPlane`: attach, reattach, gap resume,
 * dormancy detach/reactivate, and the empty-refresh guard.
 *
 * Two independent bits of state (D2, todo #350 T33), plus `fullReplay`,
 * which serializes and bounds the re-replays resync/transcript_cleared ask
 * for (T40):
 *  - `client` — bound as soon as a session is loaded, active or not. Prompt/
 *    cancel/reply need only this, so they work from a dormant chat too
 *    (`requireClient()` never checks subscription).
 *  - `subscribed` — whether this session's listeners are wired and it has
 *    told the daemon it's observing (`session/resume`). Only the active
 *    thread stays subscribed; `detach()`/`reactivate()` toggle it without
 *    touching `client`, so a daemon-switch rebind (`bindClient`) survives a
 *    dormant period untouched.
 */
export class AcpSessionAttachment {
  private client: AcpSessionClientPort | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private subscribed = false;
  /** Survives a detach — distinguishes a genuinely first-ever attach (full replay) from a switch-back (cursor resume). */
  private hasAttached = false;
  /** One full replay at a time, for both the resync and the wipe trigger (T40). */
  private readonly fullReplay = new FullReplayRetry(
    () => this.reattach(),
    () => this.host.getChatId(),
  );

  constructor(private readonly host: AcpSessionAttachmentHost) {}

  get currentClient(): AcpSessionClientPort | null {
    return this.client;
  }

  get isSubscribed(): boolean {
    return this.subscribed;
  }

  /** Bind (or rebind, e.g. on a daemon switch) the shared client — no wiring, no wire traffic. Safe while dormant. */
  bindClient(client: AcpSessionClientPort): void {
    if (this.client === client) return;
    if (this.subscribed) this.detachListeners();
    this.client = client;
    if (this.subscribed) this.wireListeners(client);
  }

  /** Bind to the shared per-profile client and full-replay this chat. Idempotent per client. */
  async attach(client: AcpSessionClientPort): Promise<void> {
    this.bindClient(client);
    this.subscribeIfNeeded();
    await this.resume({ type: 'start' });
    this.hasAttached = true;
  }

  /**
   * Re-establish the live stream after a `detach()` (D2 switch-back): a
   * first-ever activation (never `attach()`ed before) still needs the full
   * replay `attach()` gives; a genuine switch-back resumes from the last
   * settled item instead, so the daemon pushes only what changed while
   * dormant — no full replay.
   */
  async reactivate(client: AcpSessionClientPort): Promise<void> {
    this.bindClient(client);
    if (this.subscribed) return;
    if (!this.hasAttached) {
      await this.attach(client);
      return;
    }
    this.subscribeIfNeeded();
    const settled = this.host.getLastSettledItemId();
    const cursor: ReplayCursor = settled ? { type: 'item', itemId: settled } : { type: 'start' };
    await this.resume(cursor);
  }

  /** Drop this session's live stream (D2 dormancy) — tells the daemon, stops listening, keeps `client` bound for prompt/cancel/reply. */
  detach(): void {
    if (!this.subscribed) return;
    this.fullReplay.cancel();
    this.client?.detach(this.host.getChatId());
    this.detachListeners();
    this.subscribed = false;
  }

  /**
   * Full re-replay of the current transcript (e.g. after a server-side
   * wipe). Pre-resets before the round-trip AND bypasses the empty-refresh
   * guard on the way back: the pre-reset alone would be defeated by a live
   * update landing between the reset and the resume response, which would
   * repopulate the accumulator and re-arm the guard just in time to refuse
   * the wipe it's finishing. `bypassGuard` makes a server-initiated wipe
   * deterministic regardless of that race (R2.2 / R1.3). No-op while
   * detached — the server notification that would trigger this can't
   * arrive without a live subscription anyway.
   */
  async reattach(): Promise<void> {
    if (!this.subscribed) return;
    this.host.resetSettledCursor();
    this.host.resetAccumulator();
    await this.resume({ type: 'start' }, { bypassGuard: true });
  }

  /** No-op while detached — same reasoning as `reattach()`. */
  async resumeFromGap(): Promise<void> {
    if (!this.subscribed || this.host.isDisposed() || !this.hasAttached) return;
    const settled = this.host.getLastSettledItemId();
    const cursor: ReplayCursor = settled ? { type: 'item', itemId: settled } : { type: 'start' };
    try {
      await this.resume(cursor);
    } catch (error) {
      console.warn('[acp-session] resume-on-gap failed — a later gap/close will retry', error);
    }
  }

  /** Prompt/cancel/reply only need a bound client, not a live subscription — a dormant chat can still be prompted (the daemon attaches this connection on send). */
  requireClient(): AcpSessionClientPort {
    if (!this.client) throw new Error('[acp-session] not attached — no facade client yet');
    return this.client;
  }

  dispose(): void {
    this.fullReplay.cancel();
    this.detachListeners();
    this.subscribed = false;
    this.client = null;
  }

  private subscribeIfNeeded(): void {
    if (this.subscribed) return;
    this.wireListeners(this.requireClient());
    this.subscribed = true;
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
        this.fullReplay.requestWipe();
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
        this.fullReplay.requestResync();
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
    // Any successful round-trip — gap, reactivation, attach — ends a failure streak.
    this.fullReplay.reset();
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
