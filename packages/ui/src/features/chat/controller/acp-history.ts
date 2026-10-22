import type {
  HistoryPageParams,
  HistoryPageResult,
  HistorySearchResult,
  HistoryState,
  HistoryWindow,
  ReplayCursor,
} from '@qlan-ro/mainframe-types';
import type { AcpSessionClientPort } from './acp-session-attachment-types';

export interface HistoryLoadState extends HistoryState {
  loading: boolean;
  error?: string;
}

interface HistoryHost {
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

  constructor(private readonly host: HistoryHost) {}

  invalidate(): void {
    this.generation += 1;
    this.inFlight = null;
    if (this.state.loading) this.update({ ...this.state, loading: false });
  }

  reset(history?: HistoryState): void {
    this.invalidate();
    this.state = { hasMore: false, ...history, loading: false };
    this.host.changed(this.state);
  }

  window(cursor: ReplayCursor): HistoryWindow {
    return cursor.type === 'revision'
      ? { floorItemId: this.state.floorItemId, contextItemIds: this.state.contextItemIds, items: 80 }
      : { containers: 40, items: 80 };
  }

  isContextItem(id: string): boolean {
    return this.host.hasItem(id) && !this.host.hasItem(id, this.state.floorItemId);
  }

  async search(query: string): Promise<HistorySearchResult> {
    const client = this.host.client();
    if (!client.historySearch) throw new Error('History search unavailable');
    return client.historySearch(this.host.chatId(), query);
  }

  async load(untilItemId?: string): Promise<boolean> {
    if (untilItemId && this.host.hasItem(untilItemId, this.state.floorItemId)) return true;
    if (this.inFlight) {
      await this.inFlight;
      return untilItemId ? this.load(untilItemId) : false;
    }
    if (!this.host.active() || !this.state.hasMore || !this.state.floorItemId) return false;
    const pending = this.fetch(untilItemId);
    this.inFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
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
          containers: 40,
          items: 80,
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
          if (stale) return;
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
    this.host.changed(state);
  }
}
