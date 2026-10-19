import { useEffect, useMemo, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { ProgressiveMessages } from '../../thread/ProgressiveMessages';
import { TurnPresentationCache } from '../../view-model/compact/turn-presentation-cache';
import { buildTurnDisclosures } from '../../view-model/compact/build-turn-disclosures';
import { boundedMessageComponents } from '../bounded-messages';
import { MessageRenderBoundary } from '../MessageRenderBoundary';
import { AssistantMessage } from '../AssistantMessage';
import { CompactMessageSlice } from './CompactMessageSlice';
import { useTranscriptScope } from './transcript-scope';
import { TurnPresentationProvider, useTurnPresentationSelector } from './turn-presentation-context';
import { useTurnDisclosureState } from './use-turn-disclosure-state';
import { turnDisclosureStore } from './turn-disclosure-store';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import type { ActivitySource } from '@/features/session-panel/activity-model';

function AssistantSlice() {
  const id = useAuiState((s) => s.message.id);
  // The cache keeps an untouched message's presentation identical, so a chunk
  // re-renders only the slice whose message moved.
  const presentation = useTurnPresentationSelector((s) => s.model.messagesById.get(id));
  return (
    <MessageRenderBoundary>
      {!presentation || presentation.native ? (
        <AssistantMessage />
      ) : (
        <CompactMessageSlice presentation={presentation} />
      )}
    </MessageRenderBoundary>
  );
}
const components = { ...boundedMessageComponents, AssistantMessage: AssistantSlice };
export function CompactTranscript() {
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const scope = useTranscriptScope();
  const chatId = useChatExtrasSelector((extras) => extras?.state.chatId);
  const backgroundAgent = useChatExtrasSelector((extras) =>
    Object.values(extras?.state.backgroundTasks ?? {}).some((task) => task.kind === 'agent'),
  );
  const root = useRef<HTMLDivElement>(null);
  const cache = useMemo(() => new TurnPresentationCache(), []);
  const model = useMemo(
    () => buildTurnDisclosures(messages, { ...scope, isRunning }, Date.now(), cache),
    [messages, scope, isRunning, cache],
  );
  useEffect(() => {
    const onJump = (event: Event) => {
      const { chatId: target, source } = (event as CustomEvent<{ chatId: string; source: ActivitySource }>).detail;
      if (target !== chatId) return;
      const presentation = model.messagesById.get(source.messageId);
      for (const unit of presentation?.units ?? []) {
        if (unit.part.type !== 'tool-call' || unit.part.toolCallId !== source.toolCallId) continue;
        if (unit.turnKey) turnDisclosureStore.set(unit.turnKey, 'open');
      }
    };
    window.addEventListener(ACTIVITY_JUMP_EVENT, onJump);
    return () => window.removeEventListener(ACTIVITY_JUMP_EVENT, onJump);
  }, [model, chatId]);
  const state = useTurnDisclosureState(model, root, backgroundAgent);
  return (
    <TurnPresentationProvider value={{ model, ...state }}>
      <div ref={root} data-testid="chat-compact-transcript">
        <ProgressiveMessages components={components} />
      </div>
    </TurnPresentationProvider>
  );
}
