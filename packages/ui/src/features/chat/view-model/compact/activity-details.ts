import type { MessagePartState } from '@assistant-ui/react';
import { isExploration } from './activity-label';
import { resolveToolStatus } from './tool-status';

export function hasActivityDetail(part: MessagePartState, pendingToolIds: ReadonlySet<string>): boolean {
  if (part.type !== 'tool-call') return false;
  if (!isExploration(part)) return true;
  const status = resolveToolStatus(part, pendingToolIds);
  return status !== 'running' && status !== 'unknown';
}
