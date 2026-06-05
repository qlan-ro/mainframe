import type { ControlResponse, ExecutionMode } from '@qlan-ro/mainframe-types';
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

export function buildAskUserQuestionResponse(
  e: ChatPermissionEntry,
  answers: Record<string, string | string[]> | undefined,
): ControlResponse {
  if (!answers) return { ...base(e), behavior: 'deny' };
  return { ...base(e), behavior: 'allow', updatedInput: { ...e.request.input, answers } };
}

export type PlanDecision =
  | { kind: 'approve'; executionMode: ExecutionMode; clearContext: boolean }
  | { kind: 'revise'; feedback: string };

export function buildPlanResponse(e: ChatPermissionEntry, d: PlanDecision): ControlResponse {
  if (d.kind === 'approve')
    return {
      ...base(e),
      behavior: 'allow',
      executionMode: d.executionMode,
      ...(d.clearContext ? { clearContext: true } : {}),
    };
  return { ...base(e), behavior: 'deny', message: d.feedback.trim() };
}
