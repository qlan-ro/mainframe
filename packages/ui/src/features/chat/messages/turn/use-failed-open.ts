import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react';
import type { Turn, TurnModel } from '../../view-model/turn/types';
import { disclosureStore } from './disclosure-store';
import { turnState, type LiveChildren } from './live-children';
import { useTranscriptScope } from './transcript-scope';
import { useTurnSelector } from './turn-context';

export const NestedFailedOpen = createContext<{ model: TurnModel; children: LiveChildren } | null>(null);

function lastFailure(turn: Turn, children: LiveChildren): string | undefined {
  const state = turnState(turn, children);
  if (children.unplacedAgents || state === 'going' || state === 'needs-you') return undefined;
  if (
    turn.children.some(({ toolCallId }) => {
      const outcome = children.outcomes.get(toolCallId);
      return outcome === 'checking' || outcome === 'running';
    })
  )
    return undefined;
  for (const { id, succeeded, failed } of turn.settledSteps) {
    const outcome = children.outcomes.get(id);
    if (outcome === 'failed' || children.failed.has(id) || failed) return id;
    if (outcome === 'completed' || (outcome === undefined && succeeded)) return undefined;
  }
  return undefined;
}

export function useFailedOpen(
  turnKey: string | undefined,
  toolCallId: string,
  rowKey: string,
  messageId: string,
): boolean {
  const { rootThreadId, chatId } = useTranscriptScope();
  const nested = useContext(NestedFailedOpen);
  const outer = useTurnSelector((value) => {
    const turn = !nested && turnKey ? value.model.turns.get(turnKey) : undefined;
    return turn && lastFailure(turn, value.children) === toolCallId ? turn : undefined;
  }, undefined);
  const innerKey = nested?.model.slices.get(messageId)?.turnKey;
  const inner = innerKey ? nested?.model.turns.get(innerKey) : undefined;
  const candidate = nested && inner && lastFailure(inner, nested.children) === toolCallId ? inner : outer;
  const opened = useSyncExternalStore(disclosureStore.subscribe, () =>
    candidate ? disclosureStore.automaticDefault(rowKey, candidate.workKeys) : disclosureStore.autoOpened(rowKey),
  );
  useLayoutEffect(() => {
    if (candidate) disclosureStore.rememberAutomatic(rowKey, candidate.workKeys, { rootThreadId, chatId });
  }, [candidate, rowKey, rootThreadId, chatId]);
  return opened;
}
