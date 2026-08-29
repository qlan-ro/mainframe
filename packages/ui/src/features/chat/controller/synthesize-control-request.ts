/**
 * Builds a stand-in `ControlRequest` for a `session/request_permission` whose
 * `_meta.controlRequest` is absent or unparseable (spec decision 27) — a
 * version-skewed daemon build, or a non-Mainframe ACP agent that never sends
 * the extension payload at all. `options` alone must still render a gate
 * (spec decision 12's floor), so this fills the fields the reply path needs
 * to correlate and answer, not the fields only the rich Plan/AskUserQuestion
 * cards read.
 */
import type { JsonRpcRequestId, RequestPermissionRequest, ControlRequest } from '@qlan-ro/mainframe-types';

const GATE_ID_PREFIX = 'gate-';

/** Strips the `gate-{requestId}` wrapper `gate_request_id` (Rust) applies — the same scheme `handleGateResolved` unwraps. */
function requestIdFromRpcId(rpcId: JsonRpcRequestId): string {
  const raw = String(rpcId);
  return raw.startsWith(GATE_ID_PREFIX) ? raw.slice(GATE_ID_PREFIX.length) : raw;
}

function synthesizeControlRequest(rpcId: JsonRpcRequestId, request: RequestPermissionRequest): ControlRequest {
  const toolCall = request.subject?.type === 'tool_call' ? request.subject.toolCall : undefined;
  const requestId = requestIdFromRpcId(rpcId);
  return {
    requestId,
    toolName: toolCall?.title ?? '(unknown tool)',
    toolUseId: toolCall?.toolCallId ?? requestId,
    input: {},
    suggestions: [],
  };
}

/**
 * `carried` is `GateMetaSchema`'s parse of `_meta.controlRequest` — that
 * schema only proves it's a record, not that `requestId` is a usable string,
 * so a carried payload missing one is treated the same as no `_meta` at all.
 */
export function resolveGateControlRequest(
  rpcId: JsonRpcRequestId,
  request: RequestPermissionRequest,
  carried: ControlRequest | undefined,
): { control: ControlRequest; synthesized: boolean } {
  if (typeof carried?.requestId === 'string' && carried.requestId.length > 0) {
    return { control: carried, synthesized: false };
  }
  return { control: synthesizeControlRequest(rpcId, request), synthesized: true };
}
