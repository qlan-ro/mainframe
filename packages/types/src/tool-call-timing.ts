import { z } from 'zod';

const EpochMillisecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ToolCallTimingSchema = z
  .object({
    startedAt: EpochMillisecondsSchema,
    completedAt: EpochMillisecondsSchema.optional(),
  })
  .refine((timing) => timing.completedAt === undefined || timing.completedAt >= timing.startedAt, {
    message: 'Completion must not precede the start',
  });

export type ToolCallTiming = z.infer<typeof ToolCallTimingSchema>;
