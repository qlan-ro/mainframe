import {
  HistoryAroundResultSchema,
  HistoryPageResultSchema,
  type HistoryAroundParams,
  type HistoryAroundResult,
  SubagentHistoryExportResultSchema,
  type SubagentHistoryParams,
  type SubagentHistoryPageParams,
  HistorySearchResultSchema,
  type HistoryPageParams,
  type HistoryPageResult,
  type HistorySearchResult,
} from '@qlan-ro/mainframe-types';
import type { RpcConnection } from './acp-rpc-connection';
import { decodeReplayBatch } from './acp-replay-batch';

export type SubagentPageParams = SubagentHistoryPageParams;

/** Folds a result's compressed `batches` into `updates`, checking them against the session. */
function decodeBatches<T extends { updates?: unknown[]; batches?: Parameters<typeof decodeReplayBatch>[0][] }>(
  page: T,
  sessionId: string,
  what: string,
): void {
  if (page.updates && page.batches) throw new Error(`${what} has two update encodings`);
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
