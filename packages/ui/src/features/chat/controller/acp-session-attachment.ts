/**
 * `AcpSessionPlane`'s connect/replay half — split out (todo #350 plan review
 * fixes, group 3 step 0) once the plane crossed 300 lines. Owns the shared
 * client subscription, full/gap replay, and the empty-refresh guard; the
 * plane keeps the accumulator, gates, and dispatch. See `acp-session-plane.ts`'s
 * module doc for the four-mechanism-collapse this replaces.
 *
 * **Staged replay (D4, plan task U2).** Once the daemon advertises
 * `replayComplete`, every successful `session/resume` opens a window
 * (`acp-replay-coordinator.ts`'s `ReplayWindowCoordinator`) that stays open until
 * this session's next `_mainframe.dev/replay_complete` — `resume()` itself
 * now stays pending that whole time, not just for the round trip. A full
 * window tells the host to stage off-screen (`host.beginReplay`) and publish
 * in one swap at the marker (`host.completeReplay`); a cursor window applies
 * straight to the visible transcript, as before. Without the capability,
 * `resume()` keeps the legacy reset-at-reply path unchanged — the
 * coordinator settles synchronously and no window is ever pushed.
 */
import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import { z } from 'zod';
import type { ReplayCursor } from '../../../lib/daemon/acp-client';
import { FullReplayRetry } from './acp-full-replay';
import { ReplayCancelledError } from './acp-replay-window';
import { ReplayWindowCoordinator } from './acp-replay-coordinator';
import type { ApplyOutcome } from '../view-model/acp-item-accumulator';
import type { AcpSessionAttachmentHost, AcpSessionClientPort } from './acp-session-attachment-types';

export type { AcpSessionAttachmentHost, AcpSessionClientPort } from './acp-session-attachment-types';

const ResumeMetaSchema = z
  .object({ itemCount: z.number().int().optional(), fullReplay: z.boolean().optional() })
  .loose();

/**
 * Connect/replay half of `AcpSessionPlane`: attach, reattach, gap resume,
 * dormancy detach/reactivate, and the empty-refresh guard.
 *
 * Two independent bits of state (D2, todo #350 T33), plus `fullReplay`,
 * which serializes and bounds the re-replays resync/transcript_cleared ask
 * for (T40), and `replay` (the window coordinator, D4), which decides what
 * each resume reply means:
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
  /**
   * Bumped on every (re)subscribe, `detach()`, `dispose()`, and a genuine
   * client rebind — `resume()` captures it before its round trip and treats
   * a mismatch on return as "this attachment moved on; drop the reply."
   */
  private generation = 0;
  /** True from the moment a `resume()` request is sent until its window settles — a needs-replay signal is redundant with an in-flight replay (D3 routing). */
  private resumePending = false;
  /** D4: the window FIFO and the legacy/staged reply continuation. */
  private readonly replay = new ReplayWindowCoordinator({
    getChatId: () => this.host.getChatId(),
    dispatch: (event) => this.host.dispatch(event),
    hasAccumulatedItems: () => this.host.hasAccumulatedItems(),
    resetAccumulator: () => this.host.resetAccumulator(),
    beginReplay: (opts) => this.host.beginReplay(opts),
    completeReplay: (opts) => this.host.completeReplay(opts),
    discardReplay: (opts) => this.host.discardReplay(opts),
    isResumePending: () => this.resumePending,
  });
  /** One full replay at a time, for both the resync and the wipe trigger (T40). */
  private readonly fullReplay = new FullReplayRetry(
    (opts) => this.reattach(opts),
    () => this.host.getChatId(),
    { hasOpenWindow: () => this.replay.hasOpenWindow(), abortOpenWindow: () => this.replay.abortOpenWindow() },
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
    if (this.subscribed) {
      this.detachListeners();
      this.cancelAllReplays();
    }
    this.client = client;
    this.generation += 1;
    if (this.subscribed) this.wireListeners(client);
  }

  /** Bind to the shared per-profile client and full-replay this chat. Idempotent per client. */
  async attach(client: AcpSessionClientPort): Promise<void> {
    this.bindClient(client);
    this.subscribeIfNeeded();
    await this.resume({ type: 'start' });
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
    if (!this.replay.hasAttached) {
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
    this.cancelAllReplays();
    this.client?.detach(this.host.getChatId());
    this.detachListeners();
    this.subscribed = false;
    this.generation += 1;
  }

  /**
   * Full re-replay of the current transcript (e.g. after a server-side
   * wipe, or a resync's cache-eviction signal). `wipe` (default `true`, the
   * historical behavior every existing caller relies on) bypasses the
   * empty-refresh guard — a server-initiated wipe must win regardless of
   * what the guard's inputs say; a resync (`wipe: false`) is subject to it.
   * Without staged replay there is no off-screen staging to make skipping
   * the pre-reset safe, so `wipe` also decides whether this call pre-resets
   * before the round trip.
   */
  async reattach(opts: { wipe?: boolean } = {}): Promise<void> {
    if (!this.subscribed) return;
    const wipe = opts.wipe ?? true;
    if (!this.stagedReplaySupported()) {
      this.host.resetSettledCursor();
      this.host.resetAccumulator();
    }
    await this.resume({ type: 'start' }, { bypassGuard: wipe });
  }

  /** No-op while detached — same reasoning as `reattach()`. A gap (silence, sequence gap, or the socket closing) invalidates any still-open window: nothing can tell it apart from one that will never get its marker. */
  async resumeFromGap(): Promise<void> {
    if (!this.subscribed || this.host.isDisposed() || !this.replay.hasAttached) return;
    // Only the open window(s) are stale here, and they stay in the FIFO
    // until their own marker — `FullReplayRetry`'s own armed retry (if any)
    // is a DIFFERENT, bounded replay the resync backoff scheduled; a gap
    // resuming the live cursor must not swallow it.
    this.replay.abortOpenWindowsOnGap();
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

  /** D3 routing: an unknown-id frame with no creation marker. */
  routeNeedsReplay(): void {
    this.replay.routeNeedsReplay(() => this.fullReplay.requestResync());
  }

  /** Tracks a frame's creation against the currently-open window, for the `itemCount` cross-check at publish (advisory only). */
  recordApplyOutcome(outcome: ApplyOutcome): void {
    this.replay.recordApplyOutcome(outcome);
  }

  dispose(): void {
    this.cancelAllReplays();
    this.detachListeners();
    this.subscribed = false;
    this.client = null;
    this.generation += 1;
  }

  private stagedReplaySupported(): boolean {
    return this.client?.mainframeCapabilities?.replayComplete === true;
  }

  private subscribeIfNeeded(): void {
    if (this.subscribed) return;
    this.wireListeners(this.requireClient());
    this.subscribed = true;
    this.generation += 1;
  }

  /** A detach, dispose, client rebind, or a gap: nothing can close any still-open window again on this binding. */
  private cancelAllReplays(): void {
    this.fullReplay.cancel();
    this.replay.cancelAll();
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
        // The server wiped the transcript (plan-mode clear-context): drop the
        // local projection and re-replay so tool-call items drop too. The
        // cursor and accumulator go NOW, not in the deferred reattach — a
        // detach before that runs would swallow it, and a live update in the
        // meantime would re-render items the server has already dropped.
        // Only the round-trip is deferred (and, once staged replay is
        // supported, builds off-screen before it pops back in).
        this.host.dispatch({ type: 'transcript.cleared' });
        this.host.resetSettledCursor();
        this.host.resetAccumulator();
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
    client.onReplayComplete?.((sessionId, aborted) => {
      if (sessionId === chatId()) this.replay.handleReplayComplete(aborted);
    });
  }

  private detachListeners(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe.length = 0;
  }

  private async resume(cursor: ReplayCursor, opts: { bypassGuard?: boolean } = {}): Promise<void> {
    const client = this.requireClient();
    const requestGeneration = this.generation;
    this.resumePending = true;
    try {
      const response = await client.resume(this.host.getChatId(), '', cursor);
      // Any successful round-trip — gap, reactivation, attach — ends a failure streak.
      this.fullReplay.reset();
      if (requestGeneration !== this.generation) {
        throw new ReplayCancelledError(
          `[acp-session] ${this.host.getChatId()} moved on before the resume reply arrived`,
        );
      }
      const meta = ResumeMetaSchema.safeParse(response._meta?.[MAINFRAME_META_NAMESPACE]);
      const itemCount = meta.success ? (meta.data.itemCount ?? null) : null;
      const isFullReplay = cursor.type === 'start' || (meta.success && meta.data.fullReplay === true);
      await this.replay.continueResume(this.stagedReplaySupported(), isFullReplay, itemCount, requestGeneration, opts);
    } finally {
      this.resumePending = false;
    }
  }
}
