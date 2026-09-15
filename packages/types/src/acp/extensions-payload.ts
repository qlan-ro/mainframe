/**
 * Mainframe's `_mainframe.dev` extension namespace (todo #350) — payloads
 * that ride an in-band message/turn `_meta["_mainframe.dev"]` (as opposed to
 * standalone out-of-band notification params, which live in
 * `extensions-notifications.ts`). Split out of `extensions.ts` once that
 * file crossed 300 lines; see its header for the shared
 * extensibility-discipline rationale. Mirrors
 * `mainframe-types/src/acp/extensions.rs`.
 */
import { z } from 'zod';

/**
 * The CLI's own context-occupancy percentage riding a `usage_update`'s
 * `_meta["_mainframe.dev"]` — not derivable from used/size (the CLI accounts
 * for its usable-window buffer).
 */
export const UsageMetaSchema = z
  .object({
    percentage: z.number(),
  })
  .loose();
export type UsageMeta = z.infer<typeof UsageMetaSchema>;

/**
 * `api_retry` modeled as a content-replacing patch plus this marker (spec
 * decision 10), riding a message/tool-call upsert's `_meta["_mainframe.dev"]`
 * alongside the replaced content — never a distinct lifecycle frame.
 */
export const RetryMarkerSchema = z
  .object({
    attempt: z.number().int(),
    reason: z.string().optional(),
  })
  .loose();
export type RetryMarker = z.infer<typeof RetryMarkerSchema>;

/**
 * Queued-prompt state (spec decision 11): an ordinary accepted prompt's
 * `PromptResponse._meta["_mainframe.dev"]` carries this while the prompt
 * waits for its turn. No `queue.*` frame family exists on the facade.
 */
export const QueuedPromptStateSchema = z
  .object({
    position: z.number().int(),
  })
  .loose();
export type QueuedPromptState = z.infer<typeof QueuedPromptStateSchema>;

// `chat.ts` has no Zod schema for `DiffHunk` to import — same mirror
// rationale as `ControlResponseSchema` in `extensions.ts`.
const DiffHunkSchema = z
  .object({
    oldStart: z.number().int(),
    oldLines: z.number().int(),
    newStart: z.number().int(),
    newLines: z.number().int(),
    lines: z.array(z.string()),
  })
  .loose();

/**
 * The fidelity payload a `diff` tool-call content entry carries in its own
 * `_meta["_mainframe.dev"]` (spec Decision 15): the legacy display
 * pipeline's structured hunks plus the full before/after file text —
 * neither survives a round trip through git-patch text, and the desktop
 * Edit/Write cards consume exactly this shape (`mapToolResult`). Generic
 * ACP clients ignore it and render the sibling `patch` text.
 */
export const StructuredDiffSchema = z
  .object({
    structuredPatch: z.array(DiffHunkSchema),
    originalFile: z.string().optional(),
    modifiedFile: z.string().optional(),
  })
  .loose();
export type StructuredDiff = z.infer<typeof StructuredDiffSchema>;

/** `ItemMetaSchema.skillLoaded` — mirrors `LeafContent.SkillLoaded`. */
export const SkillLoadedMetaSchema = z
  .object({
    skillName: z.string(),
    path: z.string(),
    content: z.string(),
  })
  .loose();
export type SkillLoadedMeta = z.infer<typeof SkillLoadedMetaSchema>;

/**
 * Display-fidelity payload riding every encoded item's
 * `_meta["_mainframe.dev"]` (desktop-cutover pass): the legacy
 * `DisplayMessage` context the core ACP item grammar has no field for.
 * `containerId` is the reaggregation key — the client folds items back into
 * per-container messages; `messageMeta` is the raw `DisplayMessage.metadata`
 * map passed through verbatim (attachments, command, cost_usd, …).
 */
export const ItemMetaSchema = z
  .object({
    timestamp: z.string().optional(),
    containerId: z.string().optional(),
    parentToolCallId: z.string().optional(),
    kind: z.enum(['system', 'error']).optional(),
    errorText: z.string().optional(),
    skillLoaded: SkillLoadedMetaSchema.optional(),
    isCompacted: z.boolean().optional(),
    messageMeta: z.record(z.string(), z.unknown()).optional(),
    groupId: z.string().optional(),
    subagent: z.boolean().optional(),
  })
  .loose();
export type ItemMeta = z.infer<typeof ItemMetaSchema>;

/**
 * The send context a `session/prompt`'s `_meta["_mainframe.dev"]` carries
 * (desktop-cutover pass): uploaded attachment ids and the slash-command
 * invocation — the two fields the legacy `message.send` frame carried that
 * the core ACP prompt has no construct for.
 */
export const PromptSendMetaSchema = z
  .object({
    attachmentIds: z.array(z.string()).optional(),
    command: z.object({ name: z.string(), source: z.string(), args: z.string().optional() }).loose().optional(),
  })
  .loose();
export type PromptSendMeta = z.infer<typeof PromptSendMetaSchema>;

/**
 * The marker a truncated tool-result text block carries in its own
 * `_meta["_mainframe.dev"]` (spec decision 20): the legacy pipeline's
 * `truncated`/`fullBytes` pair, which clients use to offer the on-demand
 * full-output fetch — the same affordance the legacy dialect's
 * `ToolCallResult` carries inline.
 */
export const TruncationMarkerSchema = z
  .object({
    truncated: z.boolean(),
    fullBytes: z.number().int().nonnegative(),
  })
  .loose();
export type TruncationMarker = z.infer<typeof TruncationMarkerSchema>;
