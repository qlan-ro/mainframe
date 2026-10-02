import type { CompactToolPart, ToolStatus } from './types';
import { record } from './values';

export function resolveToolStatus(part: CompactToolPart, pendingToolIds: ReadonlySet<string>): ToolStatus {
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
