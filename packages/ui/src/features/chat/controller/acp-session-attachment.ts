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
import { MAINFRAME_META_NAMESPACE, RevisionCursorSchema, type RevisionCursor } from '@qlan-ro/mainframe-types';
import { z } from 'zod';
import type { ReplayCursor } from '../../../lib/daemon/acp-client';
import { FullReplayRetry, type FullReplayTrigger } from './acp-full-replay';
import { ReplayCancelledError } from './acp-replay-window';
import { ReplayWindowCoordinator } from './acp-replay-coordinator';
import { wireAcpSessionListeners } from './acp-session-listeners';
import type { ApplyOutcome } from '../view-model/acp-item-accumulator';
import type { ReplayStage } from './acp-replay-stage';
import type { AcpSessionAttachmentHost, AcpSessionClientPort } from './acp-session-attachment-types';

export type { AcpSessionAttachmentHost, AcpSessionClientPort } from './acp-session-attachment-types';

const ResumeMetaSchema = z
  .object({
    itemCount: z.number().int().optional(),
    fullReplay: z.boolean().optional(),
    cursor: RevisionCursorSchema.optional(),
  })
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
  /** Bumped on every (re)subscribe, `detach()`, `dispose()`, and a genuine client rebind — `resume()` captures it before its round trip and treats a mismatch on return as "this attachment moved on; drop the reply." */
  private generation = 0;
  /** The client's `connectionGeneration` last observed when (re)wiring listeners — tells a live-socket gap (unchanged) apart from a reconnect (bumped); only the latter invalidates a queued window outright (finding 1). */
  private observedConnectionGeneration = 0;
  /** Counts overlapping `resume()` calls — two CAN be genuinely in flight (a gap resume racing an attach), and a boolean's `finally` would have the first to settle wrongly clear pending status for the one still running (finding 5). */
  private resumePendingCount = 0;
  /** D4: the window FIFO and the legacy/staged reply continuation. */
  private readonly replay = new ReplayWindowCoordinator({
    getChatId: () => this.host.getChatId(),
    dispatch: (event) => this.host.dispatch(event),
    hasAccumulatedItems: () => this.host.hasAccumulatedItems(),
    resetAccumulator: () => this.host.resetAccumulator(),
    beginReplay: (opts) => this.host.beginReplay(opts),
    completeReplay: (opts) => this.host.completeReplay(opts),
    discardReplay: (opts) => this.host.discardReplay(opts),
    isResumePending: () => this.resumePendingCount > 0,
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
    await this.resume(this.host.nextReplayFrom(client.mainframeCapabilities ?? null));
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
   * before the round trip. `trigger` carries through to `resume()`'s
   * backoff-reset decision (findings 3, 6, `acp-full-replay.ts`).
   */
  async reattach(opts: { wipe?: boolean; trigger?: FullReplayTrigger } = {}): Promise<void> {
    if (!this.subscribed) return;
    const wipe = opts.wipe ?? true;
    if (!this.stagedReplaySupported()) {
      this.host.resetSettledCursor();
      this.host.resetAccumulator();
    }
    await this.resume({ type: 'start' }, { bypassGuard: wipe, suppressBackoffReset: opts.trigger === 'needs-replay' });
  }

  /**
   * No-op while detached — same reasoning as `reattach()`. A gap fires for two reasons the client can't tell apart on its own: a live-socket heartbeat/sequence gap, or a dead-and-reconnected socket. Only the latter invalidates a queued window outright — its `resume()` went out on a connection that no longer exists, so its marker can never arrive, and leaving it queued would let the NEXT marker (meant for whatever this gap resume opens) close it instead, discarding the new window's staging through the shared slot (finding 1). A live gap keeps today's behavior: the open window(s) are aborted but stay queued, absorbing frames until their own marker arrives — a gap resuming the live cursor must not swallow `FullReplayRetry`'s own, unrelated armed retry.
   */
  async resumeFromGap(): Promise<void> {
    if (!this.subscribed || this.host.isDisposed() || !this.replay.hasAttached) return;
    const observedBefore = this.observedConnectionGeneration;
    this.syncConnectionGeneration();
    // `syncConnectionGeneration()` only drains when the generation actually
    // moved; an unchanged generation means THIS is a live-socket gap on the
    // connection already reconciled against, which still gets today's
    // absorb-until-marker treatment rather than a drain.
    if (this.requireClient().connectionGeneration === observedBefore) {
      this.replay.abortOpenWindowsOnGap();
    }
    const cursor = this.host.nextReplayFrom(this.requireClient().mainframeCapabilities ?? null);
    try {
      await this.resume(cursor);
    } catch (error) {
      console.warn('[acp-session] resume-on-gap failed — a later gap/close will retry', error);
    }
  }

  /**
   * The single choke point for reconciling a reconnect THIS attachment has not yet been told about via its own `onGap` (re-review LOW): a loader's `ensureConnected()` elsewhere lands a new connection, and its `notifyGap` can lag by up to the client's own backoff. Called before routing any frame (`acp-session-listeners.ts`'s `onSessionUpdate`) and before `AcpSessionPlane.sendPrompt()` — both can otherwise land fresh, post-reconnect traffic on a stale window's own stage (routed via `currentReplayStage()`), invisible until the late gap eventually drains it. A no-op once the generation is already reconciled, so calling it from multiple sites costs nothing extra.
   */
  syncConnectionGeneration(): void {
    if (!this.client) return;
    const current = this.client.connectionGeneration;
    if (current === this.observedConnectionGeneration) return;
    this.replay.cancelStaleConnection(current);
    this.observedConnectionGeneration = current;
  }

  /** Prompt/cancel/reply only need a bound client, not a live subscription — a dormant chat can still be prompted (the daemon attaches this connection on send). */
  requireClient(): AcpSessionClientPort {
    if (!this.client) throw new Error('[acp-session] not attached — no facade client yet');
    return this.client;
  }

  /** D3 routing: an unknown-id frame with no creation marker. Tagged `'needs-replay'` so a steadily-unknown id backs off exponentially instead of firing a full replay per patch (finding 6, `acp-full-replay.ts`). Also invalidates the durable revision cursor (todo #377) — harmless even when the request below is swallowed (resume already pending), since that resume's own reply recommits a fresh one. */
  routeNeedsReplay(): void {
    this.host.clearDurableCursor();
    this.replay.routeNeedsReplay(() => this.fullReplay.requestResync('needs-replay'));
  }

  /** The FIFO-front window's own stage — where a routed frame applies (todo #385). `null` while the FIFO is empty or its front window was refused. */
  currentReplayStage(): ReplayStage | null {
    return this.replay.currentStage();
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

  /** Baseline for the live-gap-vs-reconnect check in `resumeFromGap()` is refreshed here too — every (re)wire starts observing the client's CURRENT connection generation. */
  private wireListeners(client: AcpSessionClientPort): void {
    this.observedConnectionGeneration = client.connectionGeneration;
    this.unsubscribe.push(
      ...wireAcpSessionListeners(client, {
        getChatId: () => this.host.getChatId(),
        host: this.host,
        fullReplay: this.fullReplay,
        replay: this.replay,
        syncConnectionGeneration: () => this.syncConnectionGeneration(),
        isResumeOrReplayPending: () => this.resumePendingCount > 0 || this.replay.hasOpenWindow(),
      }),
      client.onGap(() => void this.resumeFromGap()),
    );
  }

  private detachListeners(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe.length = 0;
  }

  private async resume(
    cursor: ReplayCursor,
    opts: { bypassGuard?: boolean; suppressBackoffReset?: boolean } = {},
  ): Promise<void> {
    const client = this.requireClient();
    const requestGeneration = this.generation;
    const requestConnectionGeneration = client.connectionGeneration;
    this.resumePendingCount += 1;
    try {
      const response = await client.resume(this.host.getChatId(), '', cursor);
      if (requestGeneration !== this.generation) {
        throw new ReplayCancelledError(
          `[acp-session] ${this.host.getChatId()} moved on before the resume reply arrived`,
        );
      }
      const meta = ResumeMetaSchema.safeParse(response._meta?.[MAINFRAME_META_NAMESPACE]);
      const itemCount = meta.success ? (meta.data.itemCount ?? null) : null;
      const replyCursor: RevisionCursor | null = meta.success ? (meta.data.cursor ?? null) : null;
      const isFullReplay = cursor.type === 'start' || (meta.success && meta.data.fullReplay === true);
      await this.replay.continueResume(
        this.stagedReplaySupported(),
        isFullReplay,
        itemCount,
        replyCursor,
        { generation: requestGeneration, connectionGeneration: requestConnectionGeneration },
        opts,
      );
      // Only a window that PROVABLY completed resets the backoff — not a
      // mere reply (a daemon-aborted delivery must not look like success,
      // finding 3), and not a needs-replay-triggered run (closing fine
      // isn't proof the id it was chasing is now known, finding 6).
      if (!opts.suppressBackoffReset) this.fullReplay.reset();
    } finally {
      this.resumePendingCount -= 1;
    }
  }
}
