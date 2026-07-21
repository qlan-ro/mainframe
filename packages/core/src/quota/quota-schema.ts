import { z } from 'zod';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';

const quotaWindowSchema = z.object({
  kind: z.enum(['session', 'weekly', 'weekly-model']),
  usedPercent: z.number(),
  resetsAt: z.number().nullable(),
  label: z.string().optional(),
  observedAt: z.number().optional(),
});

const providerQuotaSchema = z.object({
  status: z.enum(['ok', 'unknown']),
  session: quotaWindowSchema.optional(),
  weekly: quotaWindowSchema.optional(),
  modelWindows: z.array(quotaWindowSchema),
  observedAt: z.number(),
  accountIdentity: z.string().optional(),
});

/** Full-shape validation of a persisted KV blob; a corrupted or partial blob is rejected. */
export function safeParseQuota(value: string): ProviderQuota | undefined {
  try {
    const parsed = providerQuotaSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined; /* malformed JSON — caller logs and skips */
  }
}
