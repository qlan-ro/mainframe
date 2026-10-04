import { useMemo, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useChatExtras } from '../../runtime/chat-extras';
import { ProgressiveMessages } from '../../thread/ProgressiveMessages';
import { TurnPresentationCache } from '../../view-model/compact/turn-presentation-cache';
import { buildTurnDisclosures } from '../../view-model/compact/build-turn-disclosures';
import { boundedMessageComponents } from '../bounded-messages';
import { MessageRenderBoundary } from '../MessageRenderBoundary';
import { AssistantMessage } from '../AssistantMessage';
import { CompactMessageSlice } from './CompactMessageSlice';
import { useTranscriptScope } from './transcript-scope';
import { TurnPresentationProvider, useTurnPresentation } from './turn-presentation-context';
import { useTurnDisclosureState } from './use-turn-disclosure-state';

function AssistantSlice() {
  const id = useAuiState((s) => s.message.id);
  const { model } = useTurnPresentation();
  const presentation = model.messagesById.get(id);
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
  const extras = useChatExtras();
  const backgroundAgent = Object.values(extras?.state.backgroundTasks ?? {}).some((task) => task.kind === 'agent');
  const root = useRef<HTMLDivElement>(null);
  const cache = useMemo(() => new TurnPresentationCache(), []);
  const model = useMemo(
    () => buildTurnDisclosures(messages, { ...scope, isRunning }, Date.now(), cache),
    [messages, scope, isRunning, cache],
  );
  const state = useTurnDisclosureState(model, root, backgroundAgent);
  return (
    <TurnPresentationProvider value={{ model, ...state }}>
      <div ref={root} data-testid="chat-compact-transcript">
        <ProgressiveMessages components={components} />
      </div>
    </TurnPresentationProvider>
  );
}
