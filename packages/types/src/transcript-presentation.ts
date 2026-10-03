import { z } from 'zod';

const identity = z.string().min(1);
const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PresentationTimingSchema = z
  .object({
    startedAtMs: offset.optional(),
    completedAtMs: offset.optional(),
    durationMs: offset.optional(),
  })
  .refine((t) => t.startedAtMs === undefined || t.completedAtMs === undefined || t.completedAtMs >= t.startedAtMs);
export const TranscriptPresentationSchema = z.object({
  version: z.literal(1),
  provider: identity,
  turnId: identity,
  parentToolUseId: identity.optional(),
  phase: z.enum(['work', 'commentary', 'final_answer']).optional(),
  state: z.enum(['running', 'completed', 'cancelled', 'failed', 'invalid', 'unknown']),
  finalEligible: z.boolean(),
  timing: PresentationTimingSchema.optional(),
});
export type TranscriptPresentation = z.infer<typeof TranscriptPresentationSchema>;

export const PresentationSourceIdentitySchema = z.object({
  sourceMessageId: identity,
  sourceBlockIndex: offset,
  presentation: TranscriptPresentationSchema,
  streaming: z.boolean().optional(),
});
export const PresentationTargetSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('text'), contentBlockIndex: offset, startUtf16: offset, endUtf16: offset })
    .refine((t) => t.endUtf16 >= t.startUtf16),
  z.object({ type: z.literal('block'), contentBlockIndex: offset }),
]);
export const PresentationSourceSchema = PresentationSourceIdentitySchema.extend({ target: PresentationTargetSchema });
export const PresentationSourcesSchema = z.object({
  version: z.literal(1),
  sources: z.array(PresentationSourceSchema),
});
export type PresentationSource = z.infer<typeof PresentationSourceSchema>;
export type PresentationSources = z.infer<typeof PresentationSourcesSchema>;
