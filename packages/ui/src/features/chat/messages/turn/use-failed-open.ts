import type { Turn } from '../../view-model/turn/types';
import { turnState, type LiveChildren } from './live-children';
import { useTurnSelector } from './turn-context';

function lastFailure(turn: Turn, children: LiveChildren): string | undefined {
  const state = turnState(turn, children);
  if (state === 'going' || state === 'needs-you') return undefined;
  for (const { id, succeeded } of turn.settledSteps) {
    if (turn.retried.includes(id)) continue;
    if (children.failed.has(id) || turn.failed.includes(id)) return id;
    if (succeeded) return undefined;
  }
  return undefined;
}

export function useFailedOpen(turnKey: string | undefined, toolCallId: string): boolean {
  return useTurnSelector(({ model, children }) => {
    const turn = turnKey ? model.turns.get(turnKey) : undefined;
    return turn !== undefined && lastFailure(turn, children) === toolCallId;
  }, false);
}
