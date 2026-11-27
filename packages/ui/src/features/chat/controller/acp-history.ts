import type {
  HistoryAroundResult,
  HistoryPageParams,
  HistoryPageResult,
  HistorySearchResult,
  HistoryState,
  HistoryWindow,
  ReplayCursor,
} from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import type { AcpSessionClientPort } from './acp-session-attachment-types';
import { AroundWindow, type AroundStep, type DetachedHistory } from './acp-history-around';

export type { DetachedHistory } from './acp-history-around';

export interface HistoryLoadState extends HistoryState {
  loading: boolean;
  error?: string;
  /** Set while the transcript shows a window around a target. `hasMore` then means "more above the window". */
  detached?: DetachedHistory;
}

/** What the history asks of the transcript store for windows: see `acp-plane-window-host.ts`. */
export interface HistoryWindowHost {
  /** The item the newest `turns` turns start at in the live window, or null when it holds no more. */
  newestPageStart(turns: number): string | null;
  /** Drops everything above `start` from the live window. */
  trimTo(start: string, refresh: boolean): void;
  /** Shows a window around a target, or the same window cut again, with what continues it. */
  showWindow(result: HistoryAroundResult, more?: AroundStep[]): void;
  extendWindow(result: HistoryAroundResult, side: 'before' | 'after'): void;
  hideWindow(): void;
  windowHasItem(id: string): boolean;
  windowSpan(id: string): { before: number; after: number } | null;
}

interface HistoryHost extends HistoryWindowHost {
  chatId(): string;
  client(): AcpSessionClientPort;
  active(): boolean;
  changed(state: HistoryLoadState): void;
  prepend(page: HistoryPageResult): void;
  hasItem(id: string, floor?: string): boolean;
}

export class AcpHistory {
  private state: HistoryLoadState = { hasMore: false, loading: false };
  private generation = 0;
  private inFlight: Promise<boolean> | null = null;
  private loadingSide: 'before' | 'after' | 'live' = 'before';
  private readonly around: AroundWindow;

  constructor(private readonly host: HistoryHost) {
    this.around = new AroundWindow({
      chatId: () => host.chatId(),
      client: () => host.client(),
      active: () => host.active(),
      generation: () => this.generation,
      begin: (side) => {
        this.loadingSide = side;
        this.update({ ...this.state, loading: true, error: undefined });
      },
      fail: (generation, error) => {
        if (generation === this.generation)
          this.update({ ...this.state, error: error instanceof Error ? error.message : 'Could not load messages' });
      },
      end: (generation) => {
        if (generation === this.generation && this.state.loading) this.update({ ...this.state, loading: false });
      },
      trimLive: () => this.trimLive(false),
      show: (result, more) => {
        host.showWindow(result, more);
        this.host.changed(this.view());
      },
      extendShown: (result, side) => host.extendWindow(result, side),
      span: (id) => host.windowSpan(id),
      leave: () => this.returnToTail(),
      changed: () => this.host.changed(this.view()),
    });
  }

  invalidate(): void {
    this.generation += 1;
    this.inFlight = null;
    if (this.state.loading) this.update({ ...this.state, loading: false });
  }

  reset(history?: HistoryState): void {
    this.invalidate();
    this.state = { hasMore: false, ...history, loading: false };
    this.host.changed(this.view());
    // A window is a snapshot: a resync has changed what it was cut from.
    void this.around.resnapshot();
  }

  /** What the transcript's boundaries read: the live window's state, or the window around a target. */
  private view(): HistoryLoadState {
    const window = this.around.state;
    if (!window) return this.state;
    const { loading, error } = this.state;
    return {
      hasMore: window.hasBefore,
      floorItemId: this.state.floorItemId,
      contextItemIds: window.contextItemIds,
      loading: loading && this.loadingSide === 'before',
      error,
      detached: {
        hasBefore: window.hasBefore,
        hasAfter: window.hasAfter,
        loadingAfter: loading && this.loadingSide === 'after',
      },
    };
  }

  get isDetached(): boolean {
    return this.around.state !== null;
  }

  /** The window may be out of date (the end of a turn, a compaction, a cleared transcript). */
  resnapshot(): void {
    void this.around.resnapshot();
  }

  window(cursor: ReplayCursor): HistoryWindow {
    const turns = useUiPrefs.getState().historyTurns;
    return cursor.type === 'revision' ? { floorItemId: this.state.floorItemId, turns } : { turns };
  }

  /** Changes when the history is reloaded or detached, which ends a load on its way. */
  get loadGeneration(): number {
    return this.generation;
  }

  isContextItem(id: string): boolean {
    if (this.around.state) return this.around.state.contextItemIds?.includes(id) ?? false;
    return this.host.hasItem(id) && !this.host.hasItem(id, this.state.floorItemId);
  }

  async search(query: string): Promise<HistorySearchResult> {
    const client = this.host.client();
    if (!client.historySearch) throw new Error('History search unavailable');
    return client.historySearch(this.host.chatId(), query);
  }

  async load(untilItemId?: string): Promise<boolean> {
    const window = this.around.state;
    if (untilItemId && (window ? this.host.windowHasItem(untilItemId) : this.holds(untilItemId))) return true;
    if (this.inFlight) {
      await this.inFlight;
      return untilItemId ? this.load(untilItemId) : false;
    }
    if (!this.host.active()) return false;
    const pending = window ? this.awayStep(untilItemId) : this.tailStep(untilItemId);
    return pending ? this.track(pending) : false;
  }

  private holds(id: string): boolean {
    return this.host.hasItem(id, this.state.floorItemId);
  }

  private tailStep(untilItemId?: string): Promise<boolean> | null {
    if (!this.state.hasMore || !this.state.floorItemId) return null;
    // On the plain list a jump loads a window around its target, not everything between.
    if (untilItemId && this.canAround()) return this.around.open(untilItemId);
    return this.fetch(untilItemId);
  }

  private awayStep(untilItemId?: string): Promise<boolean> | null {
    if (!untilItemId) return this.around.extend('before');
    if (this.holds(untilItemId)) return Promise.resolve(this.returnToTail());
    return this.around.open(untilItemId);
  }

  private canAround(): boolean {
    if (!useUiPrefs.getState().plainTranscript) return false;
    const client = this.host.client();
    return client.mainframeCapabilities?.historyAround === true && typeof client.historyAround === 'function';
  }

  /** Scrolling down from a window: the next items, and from its end the way back to the live tail. */
  async loadLater(): Promise<boolean> {
    const window = this.around.state;
    if (!window) return false;
    if (this.inFlight) {
      await this.inFlight;
      return false;
    }
    if (!window.hasAfter) return this.returnToTail();
    if (!this.host.active()) return false;
    return this.track(this.around.extend('after'));
  }

  /** Back to the live window: it was cut to its newest page when the window opened, and has taken every live update since. */
  returnToTail(): boolean {
    if (!this.around.state) return false;
    this.around.state = null;
    this.invalidate();
    this.host.hideWindow();
    this.host.changed(this.view());
    return true;
  }

  private track(pending: Promise<boolean>): Promise<boolean> {
    this.inFlight = pending;
    return pending.finally(() => {
      if (this.inFlight === pending) this.inFlight = null;
    });
  }

  /**
   * The reader is back at the tail: drops everything above the newest page. They are at the bottom,
   * so nothing needs anchoring. The page above the new floor loads again the usual way. Skipped while
   * a load is under way.
   */
  trim(): Promise<boolean> {
    if (this.around.state || this.inFlight || !this.host.active()) return Promise.resolve(false);
    return this.track(this.trimLive(true)).catch(() => false);
  }

  private canTrim(): boolean {
    const client = this.host.client();
    const caps = client.mainframeCapabilities;
    return caps?.windowedHistory === true && caps.historyTrim === true && typeof client.historyTrim === 'function';
  }

  /**
   * The daemon serves a page only when `before` is its floor for this connection, so the floor is
   * raised there first (`history_trim`), and the window is cut only once that is done. A daemon that
   * cannot raise its floor keeps the window whole: cutting here alone would leave every later page
   * refused.
   */
  private async trimLive(refresh: boolean): Promise<boolean> {
    if (!this.canTrim()) return false;
    const start = this.host.newestPageStart(useUiPrefs.getState().historyTurns);
    if (!start) return false;
    const client = this.host.client();
    const connection = client.connectionGeneration;
    const reply = await client.historyTrim!({ sessionId: this.host.chatId(), floorItemId: start });
    // The daemon's floor cannot be put back. A reload or a send that came meanwhile (the generation)
    // does not undo it, so the cut is made unless the connection itself changed (a new connection
    // starts from its own floor) or the window no longer holds that item.
    if (reply.stale || client !== this.host.client() || connection !== client.connectionGeneration) return false;
    if (!this.host.hasItem(start)) return false;
    this.host.trimTo(start, refresh);
    this.state = { hasMore: true, floorItemId: start, loading: false };
    this.host.changed(this.view());
    return true;
  }

  /**
   * A stale page carries the daemon's own floor. When it is a later item the window holds (a trim
   * the daemon accepted and the client did not apply), cut the window there so the retry asks `before` it.
   */
  private adoptFloor(page: HistoryPageResult): void {
    const id = page.floorItemId;
    if (!id || id === this.state.floorItemId || !this.host.hasItem(id, this.state.floorItemId)) return;
    this.host.trimTo(id, true);
    this.state = { ...this.state, hasMore: page.hasMore, floorItemId: id };
  }

  /** Pages the live window whatever the reader is looking at: export and the sub-agent fallback read it, not a jump window. */
  async loadLive(untilItemId?: string): Promise<boolean> {
    if (untilItemId && this.holds(untilItemId)) return true;
    if (this.inFlight) {
      await this.inFlight;
      return untilItemId ? this.loadLive(untilItemId) : false;
    }
    if (!this.host.active() || !this.state.hasMore || !this.state.floorItemId) return false;
    this.loadingSide = 'live';
    return this.track(this.fetch(untilItemId));
  }

  /** The live window's own paging state, which a window around a target does not change. */
  get liveHistory(): HistoryState {
    return this.state;
  }

  private async fetch(untilItemId?: string): Promise<boolean> {
    const client = this.host.client();
    if (!client.historyPage) return false;
    const generation = this.generation;
    const connection = client.connectionGeneration;
    this.update({ ...this.state, loading: true, error: undefined });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const params: HistoryPageParams = {
          sessionId: this.host.chatId(),
          before: this.state.floorItemId!,
          turns: useUiPrefs.getState().historyTurns,
          ...(untilItemId ? { untilItemId } : {}),
        };
        let stale = false;
        await client.historyPage(params, (page) => {
          if (
            generation !== this.generation ||
            client !== this.host.client() ||
            connection !== client.connectionGeneration ||
            !this.host.active()
          )
            return;
          stale = page.stale === true;
          if (stale) {
            this.adoptFloor(page);
            return;
          }
          this.host.prepend(page);
          this.update({
            hasMore: page.hasMore,
            floorItemId: page.floorItemId,
            contextItemIds: page.contextItemIds ?? this.state.contextItemIds,
            loading: false,
          });
        });
        if (
          generation !== this.generation ||
          client !== this.host.client() ||
          connection !== client.connectionGeneration
        )
          return false;
        if (!stale) return true;
      }
      return false;
    } catch (error) {
      if (generation === this.generation)
        this.update({
          ...this.state,
          error: error instanceof Error ? error.message : 'Could not load earlier messages',
        });
      throw error;
    } finally {
      if (generation === this.generation && this.state.loading) this.update({ ...this.state, loading: false });
    }
  }

  private update(state: HistoryLoadState): void {
    this.state = state;
    this.host.changed(this.view());
  }
}
