/**
 * `session/request_permission` — a mid-turn blocking request while updates
 * keep streaming (todo #350). Mirrors `mainframe-types/src/acp/
 * permission.rs`. The adapter supplies an ordered option list
 * (ACP-EVALUATION.md "What to borrow" #4); a plain `{outcome:"selected",
 * optionId}` answer is always valid, and Mainframe-aware clients attach a
 * rich answer under `_meta["_mainframe.dev"]`
 * (`extensions.RichPermissionAnswerSchema`).
 */
import { z } from 'zod';
import { ToolCallUpdateSchema } from './tool-call.js';

export type PermissionOptionId = string;

export const PermissionOptionKindSchema = z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
export type PermissionOptionKind = z.infer<typeof PermissionOptionKindSchema>;

/**
 * One option the client may pick. The client must not infer a permission's
 * effect from `kind`/`name` — the daemon/adapter owns the effect (spec:
 * "Clients must not infer a permission's effect from option kind or label").
 */
export const PermissionOptionSchema = z
  .object({
    optionId: z.string(),
    name: z.string(),
    kind: PermissionOptionKindSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type PermissionOption = z.infer<typeof PermissionOptionSchema>;

export const ToolCallPermissionSubjectSchema = z
  .object({
    toolCall: ToolCallUpdateSchema,
  })
  .loose();
export type ToolCallPermissionSubject = z.infer<typeof ToolCallPermissionSubjectSchema>;

/**
 * The operation requiring permission, scoped to the `tool_call` variant —
 * `command` (a bare-shell-command subject with no associated tool call) is
 * not on Mainframe's permission path today and is deferred.
 */
export const RequestPermissionSubjectSchema = z.union([
  ToolCallPermissionSubjectSchema.extend({ type: z.literal('tool_call') }),
]);
export type RequestPermissionSubject = z.infer<typeof RequestPermissionSubjectSchema>;

export const RequestPermissionRequestSchema = z
  .object({
    sessionId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    subject: RequestPermissionSubjectSchema.optional(),
    options: z.array(PermissionOptionSchema).min(1),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type RequestPermissionRequest = z.infer<typeof RequestPermissionRequestSchema>;

/**
 * The outcome of a permission request. `cancelled` is mandated on
 * `session/cancel` — the client MUST answer every open request this way
 * (spec edge cases).
 */
export const RequestPermissionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('cancelled') }).loose(),
  z.object({ outcome: z.literal('selected'), optionId: z.string() }).loose(),
]);
export type RequestPermissionOutcome = z.infer<typeof RequestPermissionOutcomeSchema>;

/**
 * The plain ACP answer is `{outcome}` alone. A rich Mainframe answer adds
 * `_meta["_mainframe.dev"]` carrying `extensions.RichPermissionAnswerSchema`
 * — both are the same wire type here; the daemon reads `_meta` to tell them
 * apart (spec acceptance criterion 8).
 */
export const RequestPermissionResponseSchema = z
  .object({
    outcome: RequestPermissionOutcomeSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type RequestPermissionResponse = z.infer<typeof RequestPermissionResponseSchema>;
