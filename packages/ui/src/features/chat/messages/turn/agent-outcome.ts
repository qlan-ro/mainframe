/** How an agent's work ended. Pure. */
import type { RowStatus } from './tool-icons';

/** `going`: text it wrote so far is no answer yet. */
export type AgentOutcome = 'going' | 'done' | 'failed' | 'stopped';

export function agentOutcome(status: RowStatus): AgentOutcome {
  if (status === 'failed') return 'failed';
  if (status === 'stopped' || status === 'interrupted' || status === 'declined') return 'stopped';
  return status === 'success' || status === 'unknown' ? 'done' : 'going';
}
