import type { HistoryAroundResult } from '@qlan-ro/mainframe-types';
import type { AcpSessionClientPort } from './acp-session-attachment-types';

/** The reader is in a window around a jump target, not at the live tail (`history_around`). */
export interface DetachedHistory {
  hasBefore: boolean;
  hasAfter: boolean;
  /** A later window is on its way. */
  loadingAfter: boolean;
}

/** Items each side of a jump target, and per step when the reader scrolls on from the window. */
export const AROUND_ITEMS = 50;
export const EXTEND_ITEMS = 100;

export interface AroundState {
  hasBefore: boolean;
  hasAfter: boolean;
  firstItemId: string;
  lastItemId: string;
  targetItemId: string;
  contextItemIds?: string[];
}

function stateOf(result: HistoryAroundResult, asked: string): AroundState | null {
  if (!result.firstItemId || !result.lastItemId) return null;
  return {
    hasBefore: result.hasBefore,
    hasAfter: result.hasAfter,
    firstItemId: result.firstItemId,
    lastItemId: result.lastItemId,
    targetItemId: result.targetItemId ?? asked,
    contextItemIds: result.contextItemIds,
  };
}

export interface AroundHost {
  chatId(): string;
  client(): AcpSessionClientPort;
  active(): boolean;
  /** Changes when the history is reloaded or detached, which ends a load on its way. */
  generation(): number;
  /** A load of one side is under way. */
  begin(side: 'before' | 'after'): void;
  fail(generation: number, error: unknown): void;
  end(generation: number): void;
  /** Cuts the live window back to its newest page, off screen. */
  trimLive(): void;
  show(result: HistoryAroundResult): void;
  extendShown(result: HistoryAroundResult, side: 'before' | 'after'): void;
  /** Items held each side of `id` in the window shown. */
  span(id: string): { before: number; after: number } | null;
  /** The window is gone (its target no longer exists): show the tail. */
  leave(): void;
  /** The window's state changed. */
  changed(): void;
}

/**
 * The window around a jump target, as a snapshot (`_mainframe.dev/history_around`). It never moves
 * the connection's history floor, so the live window keeps receiving every update; this class only
 * loads and extends the snapshot, and cuts it again when it may be out of date.
 */
export class AroundWindow {
  state: AroundState | null = null;
  private refreshing = false;
  private again = false;

  constructor(private readonly host: AroundHost) {}

  private connection() {
    const client = this.host.client();
    const generation = this.host.generation();
    const connection = client.connectionGeneration;
    const moved = () =>
      generation !== this.host.generation() ||
      client !== this.host.client() ||
      connection !== client.connectionGeneration ||
      !this.host.active();
    return { client, generation, moved };
  }

  /** Opens a window around `itemId`, replacing the one shown. False when the daemon does not know the item. */
  async open(itemId: string): Promise<boolean> {
    const { client, generation, moved } = this.connection();
    this.host.begin('before');
    try {
      const result = await client.historyAround!({
        sessionId: this.host.chatId(),
        itemId,
        before: AROUND_ITEMS,
        after: AROUND_ITEMS,
      });
      const next = stateOf(result, itemId);
      if (moved() || result.stale || !next) return false;
      this.host.trimLive();
      this.state = next;
      this.host.show(result);
      return true;
    } catch (error) {
      this.host.fail(generation, error);
      throw error;
    } finally {
      this.host.end(generation);
    }
  }

  /** The next items above or below the window. A window repeats its anchor, so the merge is by item id. */
  async extend(side: 'before' | 'after'): Promise<boolean> {
    const held = this.state;
    if (!held || !(side === 'before' ? held.hasBefore : held.hasAfter)) return false;
    const { client, generation, moved } = this.connection();
    this.host.begin(side);
    try {
      const result = await client.historyAround!({
        sessionId: this.host.chatId(),
        itemId: side === 'before' ? held.firstItemId : held.lastItemId,
        before: side === 'before' ? EXTEND_ITEMS : 0,
        after: side === 'after' ? EXTEND_ITEMS : 0,
      });
      if (moved() || !this.state) return false;
      if (result.stale) {
        this.host.leave();
        return false;
      }
      this.host.extendShown(result, side);
      this.state =
        side === 'before'
          ? { ...held, hasBefore: result.hasBefore, firstItemId: result.firstItemId ?? held.firstItemId }
          : { ...held, hasAfter: result.hasAfter, lastItemId: result.lastItemId ?? held.lastItemId };
      return true;
    } catch (error) {
      this.host.fail(generation, error);
      throw error;
    } finally {
      this.host.end(generation);
    }
  }

  /**
   * A window is a snapshot, and the stream drops changes below the connection's floor. It is cut
   * again after a resync, a compaction, a cleared transcript and the end of a turn, over the span it
   * showed. A target that is gone (compacted away) takes the reader back to the tail.
   */
  async resnapshot(): Promise<void> {
    if (!this.state) return;
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.again = false;
        const held = this.state;
        if (!held || !this.host.active()) return;
        const span = this.host.span(held.targetItemId);
        const { client, moved } = this.connection();
        const result = await client.historyAround!({
          sessionId: this.host.chatId(),
          itemId: held.targetItemId,
          before: Math.min(200, span?.before ?? AROUND_ITEMS),
          after: Math.min(200, span?.after ?? AROUND_ITEMS),
        });
        if (moved() || !this.state) return;
        const next = stateOf(result, held.targetItemId);
        if (result.stale || !next) {
          this.host.leave();
          return;
        }
        this.state = next;
        this.host.show(result);
        this.host.changed();
      } while (this.again);
    } catch (error) {
      console.warn('[history] window refresh failed', error);
    } finally {
      this.refreshing = false;
    }
  }
}
