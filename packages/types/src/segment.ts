/**
 * Provider segments of a chat: one chat, many provider-native sessions.
 * Mirrors `mainframe-types/src/segment.rs`. Each type is the inferred shape
 * of its schema, so the wire contract is defined once.
 */
import { z } from 'zod';

export const SegmentKindSchema = z.enum(['initial', 'provider_switch', 'context_reset']);
export type SegmentKind = z.infer<typeof SegmentKindSchema>;

export const HandoffStrategySchema = z.enum(['delta', 'full']);
export type HandoffStrategy = z.infer<typeof HandoffStrategySchema>;

export const HandoffStatusSchema = z.enum(['pending', 'delivered', 'superseded']);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export const HandoffSummarySchema = z.object({
  id: z.string(),
  strategy: HandoffStrategySchema,
  status: HandoffStatusSchema,
  itemCount: z.number(),
  omittedCount: z.number(),
  fellBackToFresh: z.boolean(),
});
export type HandoffSummary = z.infer<typeof HandoffSummarySchema>;

/** The totals of the segment a switch closed, shown in the divider's hint. */
export const SegmentTotalsSchema = z.object({
  adapterId: z.string(),
  model: z.string().nullable(),
  turnCount: z.number(),
  totalCost: z.number(),
  totalTokensInput: z.number(),
  totalTokensOutput: z.number(),
});
export type SegmentTotals = z.infer<typeof SegmentTotalsSchema>;

/** The divider a segment after the chat's first opens with. */
export const ProviderSwitchMarkerSchema = z.object({
  segmentId: z.string(),
  kind: SegmentKindSchema,
  fromAdapterId: z.string(),
  toAdapterId: z.string(),
  fromAdapterName: z.string(),
  toAdapterName: z.string(),
  toModel: z.string().nullable(),
  /** True when the segment returns to a native session the chat used before. */
  resumed: z.boolean(),
  previous: SegmentTotalsSchema,
  handoff: HandoffSummarySchema.nullable(),
});
export type ProviderSwitchMarker = z.infer<typeof ProviderSwitchMarkerSchema>;

/** `GET /api/chats/:id/segments` row. */
export const ChatSegmentSchema = z.object({
  id: z.string(),
  ordinal: z.number(),
  kind: SegmentKindSchema,
  adapterId: z.string(),
  model: z.string().nullable(),
  borrowed: z.boolean(),
  nativeSessionId: z.string().nullable(),
  turnCount: z.number(),
  totalCost: z.number(),
  totalTokensInput: z.number(),
  totalTokensOutput: z.number(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  handoff: HandoffSummarySchema.nullable(),
});
export type ChatSegment = z.infer<typeof ChatSegmentSchema>;

const EffortLevelSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

/** `POST /api/chats/:id/switch-provider` body. Unknown fields are refused. */
export const SwitchProviderBodySchema = z
  .object({
    adapterId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    model: z.string().min(1).optional(),
    tuning: z
      .object({
        effort: EffortLevelSchema.nullable().optional(),
        fast: z.boolean().nullable().optional(),
        ultracode: z.boolean().nullable().optional(),
        adaptiveThinking: z.boolean().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SwitchProviderBody = z.infer<typeof SwitchProviderBodySchema>;

/** "3 items" / "1 item, 2 omitted" — the omitted part is dropped at zero. */
export function handoffCounts(items: number, omitted: number): string {
  const noun = items === 1 ? 'item' : 'items';
  return omitted === 0 ? `${items} ${noun}` : `${items} ${noun}, ${omitted} omitted`;
}

/**
 * The divider's one-line label. Mirrors `ProviderSwitchMarker::label` in
 * Rust, which renders the same text as the fallback for older clients.
 */
export function providerSwitchLabel(marker: ProviderSwitchMarker): string {
  const to = marker.toAdapterName;
  if (marker.kind === 'context_reset') return `New ${to} session · earlier context cleared`;
  const handoff = marker.handoff;
  if (!handoff) {
    return marker.resumed
      ? `Back to ${to} · resumes its earlier session with your next message`
      : `Switched to ${to} · context hands off with your next message`;
  }
  const counts = handoffCounts(handoff.itemCount, handoff.omittedCount);
  if (handoff.fellBackToFresh) return `Back to ${to} · new session · context handed off (${counts})`;
  if (marker.resumed) return `Back to ${to} · resumed earlier session · caught up (${counts})`;
  return `Switched to ${to} · context handed off (${counts})`;
}
