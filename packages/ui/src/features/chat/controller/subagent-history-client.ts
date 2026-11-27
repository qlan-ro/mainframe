import type { HistoryAroundResult, HistoryPageResult } from '@qlan-ro/mainframe-types';
import type { AcpClientHandle } from './acp-chat-controller';

export class SubagentHistoryClient {
  constructor(
    private readonly resolveClient: () => Promise<AcpClientHandle | null>,
    private readonly sessionId: () => string,
  ) {}

  private async connect() {
    const client = await this.resolveClient();
    if (!client) throw new Error('Sub-agent history is unavailable');
    await client.ensureConnected();
    return client;
  }

  async search(agentId: string, query: string) {
    const client = await this.connect();
    if (!client.historySearch) throw new Error('Sub-agent search is unavailable');
    return client.historySearch(this.sessionId(), query, agentId);
  }

  async export(agentId: string) {
    const client = await this.connect();
    if (!client.subagentHistoryExport) throw new Error('Sub-agent export is unavailable');
    return client.subagentHistoryExport(this.sessionId(), agentId);
  }

  /**
   * The one item `itemId` names (an item or tool-use id), plus its ancestors. A snapshot: it never
   * touches the chat's history floor. Null when the daemon cannot answer it, so the caller falls back.
   */
  async around(itemId: string): Promise<HistoryAroundResult | null> {
    const client = await this.connect();
    if (client.mainframeCapabilities?.historyAround !== true || !client.historyAround) return null;
    return client.historyAround({ sessionId: this.sessionId(), itemId, before: 0, after: 0 });
  }

  async page(agentId: string, before?: string, untilItemId?: string) {
    const client = await this.connect();
    const request = client.subagentHistoryPage?.bind(client);
    if (!request) throw new Error('Sub-agent history is unavailable');
    return new Promise<HistoryPageResult>((resolve, reject) => {
      void request({ sessionId: this.sessionId(), agentId, before, untilItemId }, resolve).catch(reject);
    });
  }
}
