/** How an agent's work ended. Pure. */
import type { RowStatus } from './tool-icons';

/** `going`, and `unknown` when nothing says how it ended: text it wrote so far is no answer yet. */
export type AgentOutcome = 'going' | 'done' | 'failed' | 'stopped' | 'unknown';

export function agentOutcome(status: RowStatus): AgentOutcome {
  if (status === 'failed') return 'failed';
  if (status === 'stopped' || status === 'interrupted' || status === 'declined') return 'stopped';
  if (status === 'unknown') return 'unknown';
  return status === 'success' ? 'done' : 'going';
}
