import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useTurnSelector, type TurnContextValue } from '../messages/turn/turn-context';
import { foldsAway, leftOut } from '../view-model/turn/folded-away';

/** Ids of the messages whose folded turn draws nothing for them, joined by `\0` (a string, so the selector compares by value). */
function foldedAwayIds({ model, open }: TurnContextValue): string {
  let ids = '';
  for (const slice of model.slices.values())
    if (foldsAway(slice) && !open(slice.turnKey)) ids += `${slice.messageId}\0`;
  return ids;
}

const toSet = (ids: string): ReadonlySet<string> => new Set(ids ? ids.split('\0').slice(0, -1) : []);

/**
 * The messages the plain list leaves out: a folded turn draws nothing for them (`view-model/turn/folded-away.ts`).
 * Opening the turn brings them back as rows; a jump to one opens its turn first (`TurnTranscript` `useJumps`).
 */
export function useFoldedAwayRows(): ReadonlySet<string> {
  const candidates = useTurnSelector(foldedAwayIds, '');
  const candidateSet = useMemo(() => toSet(candidates), [candidates]);
  const ids = useAuiState((s) => leftOut(s.thread.messages, candidateSet));
  return useMemo(() => toSet(ids), [ids]);
}
