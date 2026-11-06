/**
 * `session/update` — the streaming notification and its `SessionUpdate`
 * payload variants (todo #350). Mirrors `mainframe-types/src/acp/update.rs`;
 * see that file for which variants are scoped out (`terminal_*`, `plan_*`,
 * `available_commands_update`, `config_option_update`, `session_info_update`
 * — none are in plan task 1's frame list).
 */
import { z } from 'zod';
import { ContentChunkSchema } from './content.js';
import { MAINFRAME_META_NAMESPACE } from './extensions.js';
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

/**
 * Schema `StopReason` is `end_turn | max_tokens | max_turn_requests |
 * refusal | cancelled` plus an "other" catch-all for `_`-prefixed
 * implementation extensions — it has no built-in error reason. The spec
 * requires one ("Turns end with an explicit stop reason (completed,
 * cancelled, **error**)"), so `_mainframe.dev/error` is added as that
 * extension — see `mainframe-types/src/acp/update.rs`'s `StopReason::Error`.
 */
export const StopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
  '_mainframe.dev/error',
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const IdleStateUpdateSchema = z
  .object({
    stopReason: StopReasonSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type IdleStateUpdate = z.infer<typeof IdleStateUpdateSchema>;

/**
 * The daemon-recorded start of the current turn, riding a `running`
 * `state_update`'s `_meta["_mainframe.dev"]` (spec decision 43). Epoch
 * milliseconds, identical on every connection and every emission of the same
 * turn (live frame and `session/resume` replay); absent when the daemon does
 * not know it. A malformed value (negative, fractional, non-numeric) is
 * dropped to `undefined` rather than failing the whole update.
 */
export const TurnStartMetaSchema = z
  .object({
    startedAtMs: z.number().int().nonnegative().optional().catch(undefined),
  })
  .loose();
export type TurnStartMeta = z.infer<typeof TurnStartMetaSchema>;

/** `running`'s `_meta`: a malformed namespace value is dropped, not rejected. */
const RunningMetaSchema = z
  .object({
    [MAINFRAME_META_NAMESPACE]: TurnStartMetaSchema.optional().catch(undefined),
  })
  .loose()
  .optional()
  .catch(undefined);

/**
 * Foreground-work state transition. `running` and `idle` carry their own
 * `_meta` (`idle` also `stopReason`); `requires_action` is the one variant
 * this vendored subset leaves without it (nothing in the facade grammar needs
 * it there). The wire tag is `state`, flattened onto the same
 * object as `session/update`'s own `sessionUpdate` tag — Rust's internally
 * tagged newtype-variant encoding does the same flattening (`update.rs`), so
 * `SessionUpdateSchema` below extends each of these three shapes directly
 * rather than nesting a `state` sub-object.
 */
const StateRunningSchema = z.object({ state: z.literal('running'), _meta: RunningMetaSchema }).loose();
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
