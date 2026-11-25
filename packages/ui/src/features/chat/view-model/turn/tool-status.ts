import type { ToolPart, ToolStatus } from './types';
import { record } from './values';

export function resolveToolStatus(part: ToolPart, pendingToolIds: ReadonlySet<string>): ToolStatus {
  const approval = part.approval;
  if (pendingToolIds.has(part.toolCallId) || (approval && approval.approved === undefined && !approval.resolution)) {
    return 'awaiting-approval';
  }
  if (approval?.approved === false) return 'declined';
  const lifecycle = record(part.providerMetadata?.mainframe)?.acpStatus;
  if (approval?.resolution || lifecycle === 'cancelled') return 'stopped';
  if (part.isError === true || record(part.result)?.isError === true || lifecycle === 'failed') return 'failed';
  if (lifecycle === 'pending' || lifecycle === 'in_progress') return 'running';
  if (lifecycle === 'completed') return 'success';
  if (part.status.type === 'incomplete') {
    if (part.status.reason === 'cancelled') return 'stopped';
    return part.status.reason === 'error' ? 'failed' : 'unknown';
  }
  if (part.status.type === 'running') return 'running';
  return part.status.type === 'complete' && part.result !== undefined ? 'success' : 'unknown';
}

/**
 * The status as far as anything can still act on it. `live`: the turn the call
 * belongs to is running. A call with no outcome in a turn that isn't was cut
 * short (a killed or interrupted session), so it reads stopped; only a pending
 * request of the thread's own proves an approval is still awaited.
 */
export function settledStatus(part: ToolPart, pendingToolIds: ReadonlySet<string>, live: boolean): ToolStatus {
  const status = resolveToolStatus(part, pendingToolIds);
  if (live) return status;
  const unfinished = status === 'running' || (status === 'awaiting-approval' && !pendingToolIds.has(part.toolCallId));
  return unfinished ? 'stopped' : status;
}
