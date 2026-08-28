/**
 * `session/update` — the streaming notification and its `SessionUpdate`
 * payload variants (todo #350). Mirrors `mainframe-types/src/acp/update.rs`;
 * see that file for which variants are scoped out (`terminal_*`, `plan_*`,
 * `available_commands_update`, `config_option_update`, `session_info_update`
 * — none are in plan task 1's frame list).
 */
import { z } from 'zod';
import { ContentChunkSchema } from './content.js';
import { ToolCallContentChunkSchema, ToolCallUpdateSchema } from './tool-call.js';

/**
 * A user/agent message or agent-thought upsert (structurally identical
 * across the three). `content` is a patch field: omitted leaves the
 * accumulated content unchanged, `null` clears it, a value replaces it
 * wholesale — chunks (not this variant) are what append.
 */
export const MessageUpsertSchema = z
  .object({
    messageId: z.string(),
    content: z.array(ContentChunkSchema.shape.content).nullish(),
    _meta: z.record(z.string(), z.unknown()).nullish(),
  })
  .loose();
export type MessageUpsert = z.infer<typeof MessageUpsertSchema>;

export const StopReasonSchema = z.enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const IdleStateUpdateSchema = z
  .object({
    stopReason: StopReasonSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type IdleStateUpdate = z.infer<typeof IdleStateUpdateSchema>;

/**
 * Foreground-work state transition. `running`/`requires_action` carry only
 * an optional `_meta` upstream; this vendored subset omits it there (nothing
 * in the facade grammar needs it) and keeps it only on `idle`, where
 * `stopReason` lives. The wire tag is `state`, flattened onto the same
 * object as `session/update`'s own `sessionUpdate` tag — Rust's internally
 * tagged newtype-variant encoding does the same flattening (`update.rs`), so
 * `SessionUpdateSchema` below extends each of these three shapes directly
 * rather than nesting a `state` sub-object.
 */
const StateRunningSchema = z.object({ state: z.literal('running') }).loose();
const StateIdleSchema = IdleStateUpdateSchema.extend({ state: z.literal('idle') });
const StateRequiresActionSchema = z.object({ state: z.literal('requires_action') }).loose();

export const SessionStateSchema = z.union([StateRunningSchema, StateIdleSchema, StateRequiresActionSchema]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const CostSchema = z
  .object({
    amount: z.number(),
    currency: z.string(),
  })
  .loose();
export type Cost = z.infer<typeof CostSchema>;

/** Context-window occupancy plus cumulative cost (ACP-EVALUATION.md "What to borrow" #5). */
export const UsageUpdateSchema = z
  .object({
    used: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    cost: CostSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type UsageUpdate = z.infer<typeof UsageUpdateSchema>;

/**
 * Tagged on `sessionUpdate`. A plain `z.union` rather than
 * `z.discriminatedUnion`: three options here (the `state_update` family)
 * share the `state_update` discriminator value and are told apart by the
 * nested `state` tag instead, which a single-level discriminated union can't
 * express.
 */
export const SessionUpdateSchema = z.union([
  ContentChunkSchema.extend({ sessionUpdate: z.literal('user_message_chunk') }),
  MessageUpsertSchema.extend({ sessionUpdate: z.literal('user_message') }),
  ContentChunkSchema.extend({ sessionUpdate: z.literal('agent_message_chunk') }),
  MessageUpsertSchema.extend({ sessionUpdate: z.literal('agent_message') }),
  ContentChunkSchema.extend({ sessionUpdate: z.literal('agent_thought_chunk') }),
  MessageUpsertSchema.extend({ sessionUpdate: z.literal('agent_thought') }),
  StateRunningSchema.extend({ sessionUpdate: z.literal('state_update') }),
  StateIdleSchema.extend({ sessionUpdate: z.literal('state_update') }),
  StateRequiresActionSchema.extend({ sessionUpdate: z.literal('state_update') }),
  ToolCallContentChunkSchema.extend({ sessionUpdate: z.literal('tool_call_content_chunk') }),
  ToolCallUpdateSchema.extend({ sessionUpdate: z.literal('tool_call_update') }),
  UsageUpdateSchema.extend({ sessionUpdate: z.literal('usage_update') }),
]);
export type SessionUpdate = z.infer<typeof SessionUpdateSchema>;

export const UpdateSessionNotificationSchema = z
  .object({
    sessionId: z.string(),
    update: SessionUpdateSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type UpdateSessionNotification = z.infer<typeof UpdateSessionNotificationSchema>;
