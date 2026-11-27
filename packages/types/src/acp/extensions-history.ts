import { z } from 'zod';
import { SessionUpdateSchema } from './update.js';
import { ReplayBatchParamsSchema } from './extensions-notifications.js';

export const WINDOWED_HISTORY_OPT_IN_KEY = 'windowedHistory';
export const HistoryWindowSchema = z
  .object({
    containers: z.number().int().optional(),
    items: z.number().int().optional(),
    floorItemId: z.string().optional(),
    contextItemIds: z.array(z.string()).optional(),
  })
  .loose();
export type HistoryWindow = z.infer<typeof HistoryWindowSchema>;

export const HistoryStateSchema = z
  .object({
    hasMore: z.boolean(),
    floorItemId: z.string().optional(),
    contextItemIds: z.array(z.string()).optional(),
  })
  .loose();
export type HistoryState = z.infer<typeof HistoryStateSchema>;

export const HistoryPageParamsSchema = z
  .object({
    sessionId: z.string(),
    before: z.string(),
    containers: z.number().int().optional(),
    items: z.number().int().optional(),
    untilItemId: z.string().optional(),
  })
  .loose();
export type HistoryPageParams = z.infer<typeof HistoryPageParamsSchema>;

/**
 * Batches the RPC layer inflated from a response's binary frames, in order.
 * Client-side only: never on the wire, the transport fills it in (replacing
 * `batchFrames`) before the result reaches its consumer, which validates each
 * entry of `updates` like any other update.
 */
export const InflatedBatchSchema = z.object({ count: z.number().int().nonnegative(), updates: z.array(z.unknown()) });
export type InflatedBatch = z.infer<typeof InflatedBatchSchema>;

export const HistoryPageResultSchema = HistoryStateSchema.extend({
  updates: z.array(SessionUpdateSchema).optional(),
  batches: z.array(ReplayBatchParamsSchema).optional(),
  /** Binary frames carrying this result's batches (opt-in); the transport turns it into `inflatedBatches`. */
  batchFrames: z.number().int().nonnegative().optional(),
  inflatedBatches: z.array(InflatedBatchSchema).optional(),
  stale: z.boolean().optional(),
});
export type HistoryPageResult = z.infer<typeof HistoryPageResultSchema>;

/**
 * `_mainframe.dev/history_around`: a window of items centred on one item,
 * independent of the connection's history floor. `before` and `after` count
 * items (default 20, clamped to 0..200). `itemId` may be an item id, a
 * tool-use id or a container id.
 */
export const HistoryAroundParamsSchema = z
  .object({
    sessionId: z.string(),
    itemId: z.string(),
    before: z.number().int().optional(),
    after: z.number().int().optional(),
    /** Also return the target's descendants (a sub-agent's steps), up to a cap. */
    includeDescendants: z.boolean().optional(),
  })
  .loose();
export type HistoryAroundParams = z.infer<typeof HistoryAroundParamsSchema>;

export const HistoryAroundResultSchema = z
  .object({
    updates: z.array(SessionUpdateSchema).optional(),
    batches: z.array(ReplayBatchParamsSchema).optional(),
    batchFrames: z.number().int().nonnegative().optional(),
    inflatedBatches: z.array(InflatedBatchSchema).optional(),
    hasBefore: z.boolean(),
    hasAfter: z.boolean(),
    firstItemId: z.string().optional(),
    lastItemId: z.string().optional(),
    targetItemId: z.string().optional(),
    contextItemIds: z.array(z.string()).optional(),
    /** True when `includeDescendants` was asked and the cap cut the descendants short. */
    hasMoreDescendants: z.boolean().optional(),
    stale: z.boolean().optional(),
  })
  .loose();
export type HistoryAroundResult = z.infer<typeof HistoryAroundResultSchema>;

export const HistorySearchParamsSchema = z.object({ sessionId: z.string(), query: z.string() }).loose();
export type HistorySearchParams = z.infer<typeof HistorySearchParamsSchema>;
export const HistoryMatchSchema = z
  .object({
    containerId: z.string(),
    itemId: z.string(),
    occurrence: z.number().int().nonnegative(),
  })
  .loose();
export type HistoryMatch = z.infer<typeof HistoryMatchSchema>;
export const HistorySearchResultSchema = z
  .object({
    total: z.number().int().nonnegative(),
    matches: z.array(HistoryMatchSchema),
    truncated: z.boolean().optional(),
  })
  .loose();
export type HistorySearchResult = z.infer<typeof HistorySearchResultSchema>;

export const SubagentHistoryParamsSchema = z
  .object({
    sessionId: z.string(),
    agentId: z.string(),
  })
  .loose();
export type SubagentHistoryParams = z.infer<typeof SubagentHistoryParamsSchema>;

export const SubagentHistoryPageParamsSchema = SubagentHistoryParamsSchema.extend({
  before: z.string().optional(),
  containers: z.number().int().optional(),
  untilItemId: z.string().optional(),
});
export type SubagentHistoryPageParams = z.infer<typeof SubagentHistoryPageParamsSchema>;

export const SubagentHistorySearchParamsSchema = SubagentHistoryParamsSchema.extend({
  query: z.string(),
});
export type SubagentHistorySearchParams = z.infer<typeof SubagentHistorySearchParamsSchema>;

export const SubagentHistoryExportResultSchema = z.object({ markdown: z.string() }).loose();
export type SubagentHistoryExportResult = z.infer<typeof SubagentHistoryExportResultSchema>;

export const SubagentRowFactsSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'stopped', 'unknown']),
    source: z.enum(['result', 'notification', 'tail']).optional(),
    summary: z.string().nullish(),
    nativeAgentId: z.string().nullish(),
    durationMs: z.number().nonnegative().nullish(),
    tokens: z.number().nonnegative().nullish(),
    toolUseCount: z.number().nonnegative().nullish(),
  })
  .loose();
export type SubagentRowFacts = z.infer<typeof SubagentRowFactsSchema>;
