/**
 * Tool calls: the `ToolCallUpdate` upsert/patch and its streamed-append
 * sibling `ToolCallContentChunk` (todo #350). Mirrors
 * `mainframe-types/src/acp/tool_call.rs`. `ToolCallContent` carries the
 * `content` and `diff` variants; `terminal` is an explicit deviation — the
 * facade declines the `terminal/*` client services a `terminalId` would
 * point into (spec Decision 16).
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

/** Schema `DiffFileType` — kind of file content represented by a diff change. */
export const DiffFileTypeSchema = z.enum(['text', 'binary', 'directory', 'symlink']);
export type DiffFileType = z.infer<typeof DiffFileTypeSchema>;

/** Schema `DiffPatch` — renderable patch text; `git_patch` is the only ACP-defined format. */
export const DiffPatchSchema = z
  .object({
    format: z.literal('git_patch'),
    text: z.string(),
  })
  .loose();
export type DiffPatch = z.infer<typeof DiffPatchSchema>;

const diffChangeShared = {
  fileType: DiffFileTypeSchema.nullish(),
  mimeType: z.string().nullish(),
  _meta: z.record(z.string(), z.unknown()).nullish(),
};

/**
 * Schema `DiffChange` — one file-level change: `add`/`delete`/`modify` carry
 * `path`, `move`/`copy` carry `oldPath` + `path`.
 */
export const DiffChangeSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add'), path: z.string(), ...diffChangeShared }).loose(),
  z.object({ operation: z.literal('delete'), path: z.string(), ...diffChangeShared }).loose(),
  z.object({ operation: z.literal('modify'), path: z.string(), ...diffChangeShared }).loose(),
  z.object({ operation: z.literal('move'), oldPath: z.string(), path: z.string(), ...diffChangeShared }).loose(),
  z.object({ operation: z.literal('copy'), oldPath: z.string(), path: z.string(), ...diffChangeShared }).loose(),
]);
export type DiffChange = z.infer<typeof DiffChangeSchema>;

/**
 * Schema `Diff` — `changes` is authoritative for affected paths/operations;
 * `patch` optionally carries renderable text consistent with `changes`
 * (omitted and `null` both mean no patch text was provided).
 */
export const DiffSchema = z
  .object({
    changes: z.array(DiffChangeSchema),
    patch: DiffPatchSchema.nullish(),
    _meta: z.record(z.string(), z.unknown()).nullish(),
  })
  .loose();
export type Diff = z.infer<typeof DiffSchema>;

export const ToolCallContentSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('content'),
      content: ContentBlockSchema,
    })
    .loose(),
  z.object({ type: z.literal('diff'), ...DiffSchema.shape }).loose(),
]);
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
