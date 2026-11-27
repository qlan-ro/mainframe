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
/** The most items one `history_around` returns each side. */
const MAX_SIDE = 200;

export interface AroundState {
  hasBefore: boolean;
  hasAfter: boolean;
  firstItemId: string;
  lastItemId: string;
  targetItemId: string;
  contextItemIds?: string[];
}

type Side = 'before' | 'after';
export interface AroundStep {
  result: HistoryAroundResult;
  side: Side;
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
  begin(side: Side): void;
  fail(generation: number, error: unknown): void;
  end(generation: number): void;
  /** Cuts the live window back to its newest page, off screen. False when it could not (an older daemon). */
  trimLive(): Promise<boolean>;
  /** Shows the window: `result`, and what continues it above or below, in one render. */
  show(result: HistoryAroundResult, more?: AroundStep[]): void;
  extendShown(result: HistoryAroundResult, side: Side): void;
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
 *
 * `epoch` changes whenever the window is opened, extended or replaced, so a request that was
 * asked of an older window cannot be applied to a newer one.
 */
export class AroundWindow {
  state: AroundState | null = null;
  private epoch = 0;
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
    const epoch = ++this.epoch;
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
      if (moved() || epoch !== this.epoch || result.stale || !next) return false;
      // The live window is cut off screen. A daemon that cannot raise its floor keeps it whole.
      await this.host.trimLive().catch(() => false);
      if (moved() || epoch !== this.epoch) return false;
      this.state = next;
      this.epoch += 1;
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
  async extend(side: Side): Promise<boolean> {
    const held = this.state;
    if (!held || !(side === 'before' ? held.hasBefore : held.hasAfter)) return false;
    const epoch = ++this.epoch;
    const { client, generation, moved } = this.connection();
    this.host.begin(side);
    try {
      const result = await client.historyAround!({
        sessionId: this.host.chatId(),
        itemId: side === 'before' ? held.firstItemId : held.lastItemId,
        before: side === 'before' ? EXTEND_ITEMS : 0,
        after: side === 'after' ? EXTEND_ITEMS : 0,
      });
      if (moved() || epoch !== this.epoch || !this.state) return false;
      if (result.stale) {
        this.host.leave();
        return false;
      }
      this.host.extendShown(result, side);
      this.state = this.continued(held, result, side);
      // A refresh that measured the window before these rows came is out of date.
      this.epoch += 1;
      return true;
    } catch (error) {
      this.host.fail(generation, error);
      throw error;
    } finally {
      this.host.end(generation);
    }
  }

  private continued(held: AroundState, result: HistoryAroundResult, side: Side): AroundState {
    return side === 'before'
      ? { ...held, hasBefore: result.hasBefore, firstItemId: result.firstItemId ?? held.firstItemId }
      : { ...held, hasAfter: result.hasAfter, lastItemId: result.lastItemId ?? held.lastItemId };
  }

  /**
   * A window is a snapshot, and the stream drops changes below the connection's floor. It is cut
   * again after a resync, a compaction, a cleared transcript and the end of a turn, over the span
   * it showed (the target and what it held each side, in as many requests as that takes). A target
   * that is gone (compacted away) takes the reader back to the tail. A request that was overtaken
   * by an open, an extension or another refresh is dropped and asked again.
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
        await this.refresh();
      } while (this.again);
    } catch (error) {
      console.warn('[history] window refresh failed', error);
    } finally {
      this.refreshing = false;
    }
  }

  private async refresh(): Promise<void> {
    const held = this.state;
    if (!held || !this.host.active()) return;
    const epoch = this.epoch;
    const span = this.host.span(held.targetItemId);
    const { client, moved } = this.connection();
    const ask = (itemId: string, before: number, after: number) =>
      client.historyAround!({ sessionId: this.host.chatId(), itemId, before, after });
    // Dropped: the window moved on (a jump, a step), or the connection did.
    const overtaken = () => {
      if (moved()) return true;
      if (epoch === this.epoch && this.state) return false;
      this.again = true;
      return true;
    };
    const need = { before: span?.before ?? AROUND_ITEMS, after: span?.after ?? AROUND_ITEMS };
    const first = await ask(held.targetItemId, Math.min(MAX_SIDE, need.before), Math.min(MAX_SIDE, need.after));
    if (overtaken()) return;
    let next = stateOf(first, held.targetItemId);
    if (first.stale || !next) {
      this.host.leave();
      return;
    }
    const more: AroundStep[] = [];
    for (const side of ['before', 'after'] as const) {
      let left = need[side] - MAX_SIDE;
      while (left > 0 && (side === 'before' ? next.hasBefore : next.hasAfter)) {
        const count = Math.min(MAX_SIDE, left);
        const result = await ask(
          side === 'before' ? next.firstItemId : next.lastItemId,
          side === 'before' ? count : 0,
          side === 'after' ? count : 0,
        );
        if (overtaken()) return;
        if (result.stale) break;
        more.push({ result, side });
        next = this.continued(next, result, side);
        left -= MAX_SIDE;
      }
    }
    this.epoch += 1;
    this.state = next;
    this.host.show(first, more);
    this.host.changed();
  }
}
