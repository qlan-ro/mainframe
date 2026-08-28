/**
 * Tool calls: the `ToolCallUpdate` upsert/patch and its streamed-append
 * sibling `ToolCallContentChunk` (todo #350). Mirrors
 * `mainframe-types/src/acp/tool_call.rs` — see that file for why `diff`/
 * `terminal` content variants are deferred.
 *
 * Patch fields use Zod's `.nullish()` (optional + nullable): JSON's
 * property-presence already distinguishes omitted from `null`, so — unlike
 * the Rust side, which needs a hand-rolled `Option<Option<T>>` serde helper
 * (`patch.rs`) — no extra machinery is needed here to keep the three states
 * (omitted / cleared / replaced) apart.
 */
import { z } from 'zod';
import { ContentBlockSchema } from './content.js';

export type ToolCallId = string;

/** ACP-EVALUATION.md "What to borrow" #2: a tool taxonomy shared across ACP's whole agent ecosystem. */
export const ToolKindSchema = z.enum([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const ToolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

export const ToolCallLocationSchema = z
  .object({
    path: z.string(),
    line: z.number().int().nonnegative().optional(),
  })
  .loose();
export type ToolCallLocation = z.infer<typeof ToolCallLocationSchema>;

export const ToolCallContentSchema = z
  .object({
    type: z.literal('content'),
    content: ContentBlockSchema,
  })
  .loose();
export type ToolCallContent = z.infer<typeof ToolCallContentSchema>;

/**
 * Tool-call upsert/patch. Only `toolCallId` is required; every other field is
 * a patch field (schema: "omitted fields leave the existing tool call value
 * unchanged, `null` clears or unsets the value, and concrete values replace
 * the previous value").
 */
export const ToolCallUpdateSchema = z
  .object({
    toolCallId: z.string(),
    title: z.string().nullish(),
    kind: ToolKindSchema.nullish(),
    status: ToolCallStatusSchema.nullish(),
    content: z.array(ToolCallContentSchema).nullish(),
    locations: z.array(ToolCallLocationSchema).nullish(),
    rawInput: z.unknown().nullish(),
    rawOutput: z.unknown().nullish(),
    _meta: z.record(z.string(), z.unknown()).nullish(),
  })
  .loose();
export type ToolCallUpdate = z.infer<typeof ToolCallUpdateSchema>;

/**
 * One appended item of tool-call content — the `tool_call_content_chunk`
 * `session/update` payload. Unlike `ToolCallUpdate.content` (a full-array
 * replace), this always appends one item to the tool call's existing content.
 */
export const ToolCallContentChunkSchema = z
  .object({
    toolCallId: z.string(),
    content: ToolCallContentSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type ToolCallContentChunk = z.infer<typeof ToolCallContentChunkSchema>;
