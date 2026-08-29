import type { ControlResponse, ExecutionMode, PermissionOption } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';

type Base = Pick<ControlResponse, 'requestId' | 'toolUseId' | 'toolName'>;
const base = (e: ChatPermissionEntry): Base => ({
  requestId: e.requestId,
  toolUseId: e.request.toolUseId,
  toolName: e.request.toolName,
});

export function buildPermissionResponse(e: ChatPermissionEntry, kind: 'deny' | 'once' | 'always'): ControlResponse {
  if (kind === 'deny') return { ...base(e), behavior: 'deny' };
  const res: ControlResponse = { ...base(e), behavior: 'allow', updatedInput: e.request.input };
  if (kind === 'always') res.updatedPermissions = e.request.suggestions;
  return res;
}

/**
 * Maps a chosen adapter-supplied option to its `ControlResponse` — `kind` is
 * the ONLY field consulted, never `optionId`/`name` (spec decision 12: "the
 * client must not infer a permission's effect from an option's id or label").
 * A kind this build doesn't recognize resolves to `deny`, mirroring the
 * daemon's own `GateAnswerError::UnknownOption` rule that an unmatched option
 * is never treated as approval (`mainframe-acp/src/gates.rs::parse_answer`).
 */
export function buildOptionResponse(e: ChatPermissionEntry, option: PermissionOption): ControlResponse {
  if (option.kind === 'allow_once') return buildPermissionResponse(e, 'once');
  if (option.kind === 'allow_always') return buildPermissionResponse(e, 'always');
  return buildPermissionResponse(e, 'deny');
}

export function buildAskUserQuestionResponse(
  e: ChatPermissionEntry,
  answers: Record<string, string | string[]> | undefined,
): ControlResponse {
  if (!answers) return { ...base(e), behavior: 'deny' };
  return { ...base(e), behavior: 'allow', updatedInput: { ...e.request.input, answers } };
}

export type PlanDecision =
  | { kind: 'approve'; executionMode: ExecutionMode; clearContext: boolean }
  | { kind: 'revise'; feedback: string }
  | { kind: 'reject' };

export function buildPlanResponse(e: ChatPermissionEntry, d: PlanDecision): ControlResponse {
  if (d.kind === 'approve')
    return {
      ...base(e),
      behavior: 'allow',
      // The Claude CLI's control_response schema requires `updatedInput` on every
      // `allow` (desktop always sends the request's own input as the passthrough).
      // Omitting it makes the CLI reject the approval ("permission request failed").
      updatedInput: e.request.input,
      executionMode: d.executionMode,
      ...(d.clearContext ? { clearContext: true } : {}),
    };
  // Reject = bare deny (abandon the plan, no message); revise = deny + feedback.
  if (d.kind === 'reject') return { ...base(e), behavior: 'deny' };
  return { ...base(e), behavior: 'deny', message: d.feedback.trim() };
}
