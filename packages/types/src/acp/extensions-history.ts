import { z } from 'zod';
import { SessionUpdateSchema } from './update.js';
import { ReplayBatchParamsSchema } from './extensions-notifications.js';

export const WINDOWED_HISTORY_OPT_IN_KEY = 'windowedHistory';
export const HistoryWindowSchema = z
  .object({
    containers: z.number().int().optional(),
    floorItemId: z.string().optional(),
  })
  .loose();
export type HistoryWindow = z.infer<typeof HistoryWindowSchema>;

export const HistoryStateSchema = z
  .object({
    hasMore: z.boolean(),
    floorItemId: z.string().optional(),
  })
  .loose();
export type HistoryState = z.infer<typeof HistoryStateSchema>;

export const HistoryPageParamsSchema = z
  .object({
    sessionId: z.string(),
    before: z.string(),
    containers: z.number().int().optional(),
    untilItemId: z.string().optional(),
  })
  .loose();
export type HistoryPageParams = z.infer<typeof HistoryPageParamsSchema>;

export const HistoryPageResultSchema = HistoryStateSchema.extend({
  updates: z.array(SessionUpdateSchema).optional(),
  batches: z.array(ReplayBatchParamsSchema).optional(),
  stale: z.boolean().optional(),
});
export type HistoryPageResult = z.infer<typeof HistoryPageResultSchema>;

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
