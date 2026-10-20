import {
  HistoryPageResultSchema,
  HistorySearchResultSchema,
  type HistoryPageParams,
  type HistoryPageResult,
  type HistorySearchResult,
} from '@qlan-ro/mainframe-types';
import type { RpcConnection } from './acp-rpc-connection';
import { decodeReplayBatch } from './acp-replay-batch';

export function requestHistoryPage(
  connection: RpcConnection,
  params: HistoryPageParams,
  apply: (page: HistoryPageResult) => void,
): Promise<unknown> {
  return connection.sendRequest('_mainframe.dev/history_page', params, (raw) => {
    const page = HistoryPageResultSchema.parse(raw);
    if (page.updates && page.batches) throw new Error('History page has two update encodings');
    if (page.batches) {
      page.updates = page.batches.flatMap((batch) => {
        const updates = decodeReplayBatch(batch);
        if (!updates || updates.length !== batch.count || batch.sessionId !== params.sessionId) {
          throw new Error('Invalid history page batch');
        }
        return updates;
      });
    }
    apply(page);
  });
}

export async function requestHistorySearch(
  connection: RpcConnection,
  sessionId: string,
  query: string,
): Promise<HistorySearchResult> {
  return HistorySearchResultSchema.parse(
    await connection.sendRequest('_mainframe.dev/history_search', { sessionId, query }),
  );
}
