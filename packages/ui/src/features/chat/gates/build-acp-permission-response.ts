import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type {
  ControlResponse,
  ControlUpdate,
  ExecutionMode,
  RequestPermissionResponse,
} from '@qlan-ro/mainframe-types';

/**
 * Builders for `session/request_permission` answers (todo #350, plan task
 * 22). A sibling of `build-control-response.ts`, not a rewrite of it: the
 * legacy builders read `ChatPermissionEntry` (which carries the CLI's raw
 * `input`/`suggestions`); the ACP `RequestPermissionRequest` today carries
 * neither (`mainframe-acp/src/gates.rs:55-89`'s `subject_for`/`build_request`
 * forward only `toolName`/`toolUseId`, never `request.input`, `.suggestions`,
 * or `.request_id`), so the rich builders below take that data as explicit
 * parameters a caller must already have — see the plan's task-22 decisions
 * entry for why nothing in this UI package can supply it yet.
 */

/**
 * The plain ACP answer: pick one adapter-supplied option and send nothing
 * else. The daemon/adapter owns what `optionId` means — the client must not
 * infer a permission's effect from an option's `kind` or `name` (ACP spec,
 * mirrored in `permission.ts`'s `PermissionOptionSchema` doc comment).
 */
export function buildAcpSelection(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } };
}

/** `session/cancel` mandates every open request be answered this way (ACP spec edge cases). */
export function buildAcpCancelled(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

/**
 * A rich answer: the plain selection above, plus today's full
 * `ControlResponse` semantics riding `_meta["_mainframe.dev"]` (spec decision
 * 12). The daemon validates `controlResponse.requestId`/`toolUseId` against
 * the request it claims to resolve before trusting it
 * (`mainframe-acp/src/gates.rs:144-155`).
 */
export function buildAcpRichAnswer(optionId: string, controlResponse: ControlResponse): RequestPermissionResponse {
  return {
    outcome: { outcome: 'selected', optionId },
    _meta: { [MAINFRAME_META_NAMESPACE]: { controlResponse } },
  };
}

export type AcpControlBase = Pick<ControlResponse, 'requestId' | 'toolUseId' | 'toolName'>;

/** AskUserQuestion input mutation: the original input, plus the collected answers. */
export function buildAcpAskUserQuestionAnswer(
  base: AcpControlBase,
  optionId: string,
  input: Record<string, unknown>,
  answers: Record<string, string | string[]>,
): RequestPermissionResponse {
  return buildAcpRichAnswer(optionId, {
    ...base,
    behavior: 'allow',
    updatedInput: { ...input, answers },
  });
}

/** Always-allow: the original input, plus the adapter's suggested permission rules. */
export function buildAcpAlwaysAllowAnswer(
  base: AcpControlBase,
  optionId: string,
  input: Record<string, unknown>,
  suggestions: ControlUpdate[],
): RequestPermissionResponse {
  return buildAcpRichAnswer(optionId, {
    ...base,
    behavior: 'allow',
    updatedInput: input,
    updatedPermissions: suggestions,
  });
}

/** Plan-mode approval: the original input, plus the chosen execution mode and clear-context flag. */
export function buildAcpPlanAnswer(
  base: AcpControlBase,
  optionId: string,
  input: Record<string, unknown>,
  executionMode: ExecutionMode,
  clearContext: boolean,
): RequestPermissionResponse {
  return buildAcpRichAnswer(optionId, {
    ...base,
    behavior: 'allow',
    updatedInput: input,
    executionMode,
    ...(clearContext ? { clearContext: true } : {}),
  });
}
