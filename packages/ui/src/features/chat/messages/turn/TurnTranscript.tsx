/** The conversation as turns, in the virtualized message list. */
import { useEffect, useMemo, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { DisclosureScope } from '@/components/ui/disclosure-state';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import type { ActivitySource } from '@/features/session-panel/activity-model';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { VirtualMessages } from '../../thread/VirtualMessages';
import { TurnCache } from '../../view-model/turn/turn-cache';
import { buildTurns } from '../../view-model/turn/build-turns';
import type { TurnModel } from '../../view-model/turn/types';
import { boundedMessageComponents } from '../bounded-messages';
import { MessageRenderBoundary } from '../MessageRenderBoundary';
import { AssistantMessage } from '../AssistantMessage';
import { TurnSlice } from './TurnSlice';
import { useTranscriptScope } from './transcript-scope';
import { TurnProvider, useTurnSelector, type TurnContextValue } from './turn-context';
import { turnDisclosureStore } from './turn-disclosure-store';
import { useLiveChildren } from './use-live-children';
import { useTurnState } from './use-turn-state';

/** A message another element stands for renders nothing (T1f, T1a). */
function useAbsorbed(): boolean {
  const id = useAuiState((s) => s.message.id);
  return useTurnSelector(({ model }) => model.absorbed.has(id), false);
}

function AssistantSlice() {
  const id = useAuiState((s) => s.message.id);
  // The cache keeps an untouched message's slice identical, so a chunk
  // re-renders only the slice whose message moved.
  const slice = useTurnSelector(({ model }) => model.slices.get(id), undefined);
  const failed = useAuiState((s) => hasErrorText(s.message.metadata));
  return (
    <MessageRenderBoundary>
      <DisclosureScope id={id}>{!slice || failed ? <AssistantMessage /> : <TurnSlice slice={slice} />}</DisclosureScope>
    </MessageRenderBoundary>
  );
}

function hasErrorText(metadata: { custom?: Record<string, unknown> } | undefined): boolean {
  return Boolean((metadata?.custom?.mainframe as { errorText?: string } | undefined)?.errorText);
}

/** The virtualized list can't measure a zero-height row. */
const absorbed = <div data-testid="chat-absorbed-message" className="h-px" />;

function UserSlice() {
  return useAbsorbed() ? absorbed : <boundedMessageComponents.UserMessage />;
}
function SystemSlice() {
  return useAbsorbed() ? absorbed : <boundedMessageComponents.SystemMessage />;
}
const components = { UserMessage: UserSlice, AssistantMessage: AssistantSlice, SystemMessage: SystemSlice };

/** A jump opens the turn it lands in: the call's when it names one, else every turn of its message. */
function useJumps(model: TurnModel, chatId: string | undefined): void {
  useEffect(() => {
    const onJump = (event: Event) => {
      const { chatId: target, source } = (event as CustomEvent<{ chatId: string; source: ActivitySource }>).detail;
      const slice = target === chatId ? model.slices.get(source.messageId) : undefined;
      if (!slice?.work.length) return;
      const holds = slice.work.some(({ part }) => part.type === 'tool-call' && part.toolCallId === source.toolCallId);
      if (!source.toolCallId || holds) turnDisclosureStore.set(slice.turnKey, 'open');
    };
    window.addEventListener(ACTIVITY_JUMP_EVENT, onJump);
    return () => window.removeEventListener(ACTIVITY_JUMP_EVENT, onJump);
  }, [model, chatId]);
}

export function TurnTranscript() {
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const scope = useTranscriptScope();
  const chatId = useChatExtrasSelector((extras) => extras?.state.chatId);
  const root = useRef<HTMLDivElement>(null);
  const cache = useMemo(() => new TurnCache(), []);
  const model = useMemo(
    () => buildTurns(messages, { ...scope, isRunning }, cache),
    [messages, scope, isRunning, cache],
  );
  const children = useLiveChildren(model, chatId);
  useJumps(model, chatId);
  const state = useTurnState(model, children, root);
  const value: TurnContextValue = { model, children, ...state };
  return (
    <TurnProvider value={value}>
      <div ref={root} data-testid="chat-transcript">
        <VirtualMessages components={components} />
      </div>
    </TurnProvider>
  );
}
