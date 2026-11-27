import {
  HistoryAroundResultSchema,
  HistoryPageResultSchema,
  type HistoryAroundParams,
  type HistoryAroundResult,
  type HistoryTrimParams,
  SubagentHistoryExportResultSchema,
  type SubagentHistoryParams,
  type SubagentHistoryPageParams,
  HistorySearchResultSchema,
  type HistoryPageParams,
  type HistoryPageResult,
  type HistorySearchResult,
} from '@qlan-ro/mainframe-types';
import type { RpcConnection } from './acp-rpc-connection';
import { decodeReplayBatch, validateBatchUpdates } from './acp-replay-batch';

export type SubagentPageParams = SubagentHistoryPageParams;

/**
 * Folds a result's compressed batches into `updates`, checking them against
 * the session: base64 `batches` from an older daemon, or `inflatedBatches` the
 * transport inflated from binary frames. Either way an unusable batch fails
 * the whole page.
 */
function decodeBatches<
  T extends {
    updates?: unknown[];
    batches?: Parameters<typeof decodeReplayBatch>[0][];
    inflatedBatches?: { count: number; updates: unknown[] }[];
  },
>(page: T, sessionId: string, what: string): void {
  const encodings = [page.updates, page.batches, page.inflatedBatches].filter((value) => value !== undefined);
  if (encodings.length > 1) throw new Error(`${what} has two update encodings`);
  if (page.inflatedBatches) {
    page.updates = page.inflatedBatches.flatMap((batch) => {
      const updates = validateBatchUpdates(batch.updates, batch.count);
      if (updates.length !== batch.count) throw new Error(`Invalid ${what.toLowerCase()} batch`);
      return updates;
    });
    return;
  }
  if (!page.batches) return;
  page.updates = page.batches.flatMap((batch) => {
    const updates = decodeReplayBatch(batch);
    if (!updates || updates.length !== batch.count || batch.sessionId !== sessionId) {
      throw new Error(`Invalid ${what.toLowerCase()} batch`);
    }
    return updates;
  });
}

/** `_mainframe.dev/history_around`: a snapshot window around one item; it never moves the history floor. */
export async function requestHistoryAround(
  connection: RpcConnection,
  params: HistoryAroundParams,
): Promise<HistoryAroundResult> {
  let result: HistoryAroundResult | undefined;
  await connection.sendRequest('_mainframe.dev/history_around', params, (raw) => {
    result = HistoryAroundResultSchema.parse(raw);
    decodeBatches(result, params.sessionId, 'History window');
  });
  return result!;
}

/** `_mainframe.dev/history_trim`: the daemon raises this connection's history floor to the new page's start. */
export async function requestHistoryTrim(
  connection: RpcConnection,
  params: HistoryTrimParams,
): Promise<HistoryPageResult> {
  return HistoryPageResultSchema.parse(await connection.sendRequest('_mainframe.dev/history_trim', params));
}

export function requestHistoryPage(
  connection: RpcConnection,
  params: HistoryPageParams | SubagentPageParams,
  apply: (page: HistoryPageResult) => void,
): Promise<unknown> {
  const method = 'agentId' in params ? '_mainframe.dev/subagent_history_page' : '_mainframe.dev/history_page';
  return connection.sendRequest(method, params, (raw) => {
    const page = HistoryPageResultSchema.parse(raw);
    decodeBatches(page, params.sessionId, 'History page');
    apply(page);
  });
}

export async function requestHistorySearch(
  connection: RpcConnection,
  sessionId: string,
  query: string,
  agentId?: string,
): Promise<HistorySearchResult> {
  const method = agentId === undefined ? '_mainframe.dev/history_search' : '_mainframe.dev/subagent_history_search';
  return HistorySearchResultSchema.parse(
    await connection.sendRequest(method, { sessionId, query, ...(agentId !== undefined && { agentId }) }),
  );
}

export async function requestSubagentExport(connection: RpcConnection, params: SubagentHistoryParams) {
  return SubagentHistoryExportResultSchema.parse(
    await connection.sendRequest('_mainframe.dev/subagent_history_export', params),
  ).markdown;
}
