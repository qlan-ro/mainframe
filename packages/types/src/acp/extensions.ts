/**
 * Mainframe's `_mainframe.dev` extension namespace (todo #350) — the
 * handshake/control slice: the namespace key, agent capabilities advertised
 * in `initialize`, and the rich permission answer that reuses today's
 * `ControlResponse` semantics. Everything else in the namespace (out-of-band
 * notification params, in-band message/turn payloads) lives in
 * `extensions-notifications.ts` and `extensions-payload.ts` — split along
 * that seam because the file crossed 300 lines (see those files' headers for
 * the shared extensibility-discipline rationale, ACP-EVALUATION.md "What to
 * borrow" #6). Mirrors `mainframe-types/src/acp/extensions.rs`.
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
