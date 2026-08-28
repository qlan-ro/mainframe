/**
 * Mainframe's `_mainframe.dev` extension namespace (todo #350) — everything
 * ACP has no construct for, riding `_meta` and `_`-prefixed custom methods
 * per the schema's extensibility discipline (ACP-EVALUATION.md "What to
 * borrow" #6). Mirrors `mainframe-types/src/acp/extensions.rs`. A client that
 * doesn't recognize the namespace ignores it and degrades gracefully (spec:
 * "Generic ACP clients that advertise no Mainframe capabilities get a
 * degraded but coherent chat experience").
 */
import { z } from 'zod';
import type { ControlResponse } from '../adapter.js';
import { EXECUTION_MODES } from '../settings.js';

/** The `_meta` key every extension value below is namespaced under. */
export const MAINFRAME_META_NAMESPACE = '_mainframe.dev';

// `adapter.ts` has no Zod schema for `ControlResponse` to import — this
// mirrors it field-for-field (single-canonical-*type* rule; a validation
// schema is not the type) so the rich permission answer can be validated.
const ControlDestinationSchema = z.enum(['userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg']);
const RuleBehaviorSchema = z.enum(['allow', 'deny', 'ask']);
const PermissionModeSchema = z.enum([...EXECUTION_MODES, 'plan']);
const ControlRuleSchema = z.object({ toolName: z.string(), ruleContent: z.string().optional() }).loose();
const ControlUpdateSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('addRules'),
      rules: z.array(ControlRuleSchema),
      behavior: RuleBehaviorSchema,
      destination: ControlDestinationSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('replaceRules'),
      rules: z.array(ControlRuleSchema),
      behavior: RuleBehaviorSchema,
      destination: ControlDestinationSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('removeRules'),
      rules: z.array(ControlRuleSchema),
      behavior: RuleBehaviorSchema,
      destination: ControlDestinationSchema,
    })
    .loose(),
  z.object({ type: z.literal('setMode'), mode: PermissionModeSchema, destination: ControlDestinationSchema }).loose(),
  z
    .object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: ControlDestinationSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: ControlDestinationSchema,
    })
    .loose(),
]);
const ControlResponseSchema: z.ZodType<ControlResponse> = z
  .object({
    requestId: z.string(),
    toolUseId: z.string(),
    toolName: z.string().optional(),
    behavior: z.enum(['allow', 'deny']),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    updatedPermissions: z.array(ControlUpdateSchema).optional(),
    message: z.string().optional(),
    executionMode: z.enum(EXECUTION_MODES).optional(),
    clearContext: z.boolean().optional(),
  })
  .loose();

/**
 * Mainframe's agent-capabilities extension, advertised in `initialize`'s
 * response under `_meta["_mainframe.dev"]`.
 */
export const MainframeCapabilitiesSchema = z
  .object({
    richPermissionAnswers: z.boolean().optional(),
    queuedPrompts: z.boolean().optional(),
    retryMarkers: z.boolean().optional(),
    heartbeatIntervalMs: z.number().int().nonnegative().optional(),
  })
  .loose();
export type MainframeCapabilities = z.infer<typeof MainframeCapabilitiesSchema>;

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

/**
 * The rich permission answer (spec decision 12): today's `ControlResponse`
 * semantics, reused verbatim per the single-canonical-type rule rather than
 * redefined for the facade.
 */
export const RichPermissionAnswerSchema: z.ZodType<{ controlResponse: ControlResponse }> = z
  .object({
    controlResponse: ControlResponseSchema,
  })
  .loose();
export type RichPermissionAnswer = z.infer<typeof RichPermissionAnswerSchema>;

// `chat.ts` has no Zod schema for `DiffHunk` to import — same mirror
// rationale as `ControlResponseSchema` above.
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

/**
 * Params for the daemon's custom `_mainframe.dev/heartbeat` notification
 * (spec decision 13). `sequence` lets a client detect a gap and resume
 * instead of heuristically refetching.
 */
export const HeartbeatParamsSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
  })
  .loose();
export type HeartbeatParams = z.infer<typeof HeartbeatParamsSchema>;

/**
 * Params for the daemon's custom `_mainframe.dev/gate_resolved` notification
 * (spec decision 19): pushed to every attached connection still holding the
 * gate when it resolves elsewhere, so a pending gate clears immediately
 * instead of on the next resume. `requestId` is the JSON-RPC id the gate's
 * `session/request_permission` traveled under (`gate-{id}`).
 */
export const GateResolvedParamsSchema = z
  .object({
    sessionId: z.string(),
    requestId: z.string(),
  })
  .loose();
export type GateResolvedParams = z.infer<typeof GateResolvedParamsSchema>;

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
