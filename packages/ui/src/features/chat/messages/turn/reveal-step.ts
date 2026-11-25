/** Opens a turn on one of its steps, whose row may not exist yet: the turn is folded, or its message is not drawn. */
import { useCallback } from 'react';
import { showActivityRow } from '@/features/session-panel/activity-source';
import type { MessageSlice, TurnModel } from '../../view-model/turn/types';
import { useTurnActions } from './turn-context';
import { useTranscriptScope } from './transcript-scope';

/** The message whose steps or markers hold a call. */
function sliceOfCall(model: TurnModel, toolCallId: string): MessageSlice | undefined {
  return [...model.slices.values()].find(({ work, markers }) =>
    [...work, ...markers].some(({ part }) => part.type === 'tool-call' && part.toolCallId === toolCallId),
  );
}

export function useRevealStep(turnKey: string) {
  const { reveal, model } = useTurnActions();
  const { chatId } = useTranscriptScope();
  return useCallback(
    async (toolCallId: string, { open }: { open: boolean }) => {
      reveal(turnKey);
      const slice = sliceOfCall(model(), toolCallId);
      if (chatId && slice)
        await showActivityRow(chatId, { messageId: slice.messageId, toolCallId }, { open, focus: true });
    },
    [reveal, turnKey, chatId, model],
  );
}
