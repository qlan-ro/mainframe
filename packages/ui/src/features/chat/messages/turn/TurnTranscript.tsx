/** The conversation as turns, in the message list (virtualized, or plain rows under the scroll owner). */
import { useEffect, useMemo, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { DisclosureScope } from '@/components/ui/disclosure-state';
import { ACTIVITY_JUMP_EVENT, type ActivityJump } from '@/features/session-panel/activity-source';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { TranscriptList } from '../../thread/TranscriptList';
import type { TurnModel } from '../../view-model/turn/types';
import { isPlaceholder } from '../../view-model/placeholder';
import { boundedMessageComponents } from '../bounded-messages';
import { MessageRenderBoundary } from '../MessageRenderBoundary';
import { AssistantMessage } from '../AssistantMessage';
import { AgentWorldProvider } from './agent-world';
import { TurnSlice } from './TurnSlice';
import { useTranscriptScope } from './transcript-scope';
import { TurnProvider, useTurnSelector, type TurnContextValue } from './turn-context';
import { turnDisclosureStore } from './turn-disclosure-store';
import { useLiveChildren } from './use-live-children';
import { useTranscriptTurns } from './use-transcript-turns';
import { useTurnState } from './use-turn-state';

/** The calls whose rows stand for this message, or undefined when it is drawn itself (T1f, T1a). */
function useAbsorbed(): readonly string[] | undefined {
  const id = useAuiState((s) => s.message.id);
  const calls = useTurnSelector(({ model }) => model.absorbedBy.get(id)?.join(' '), undefined);
  return useMemo(() => calls?.split(' '), [calls]);
}

function AssistantSlice() {
  const id = useAuiState((s) => s.message.id);
  // The cache keeps an untouched message's slice identical, so a chunk
  // re-renders only the slice whose message moved.
  const slice = useTurnSelector(({ model }) => model.slices.get(id), undefined);
  const failed = useAuiState((s) => hasErrorText(s.message.metadata));
  // Nothing to say yet: the status row above it does. Never zero-height, which the list can't measure.
  const placeholder = useAuiState((s) => isPlaceholder(s.message));
  if (placeholder) return <div data-testid="chat-reply-placeholder" aria-hidden className="h-px" />;
  return (
    <MessageRenderBoundary>
      <DisclosureScope id={id}>{!slice || failed ? <AssistantMessage /> : <TurnSlice slice={slice} />}</DisclosureScope>
    </MessageRenderBoundary>
  );
}

function hasErrorText(metadata: { custom?: Record<string, unknown> } | undefined): boolean {
  return Boolean((metadata?.custom?.mainframe as { errorText?: string } | undefined)?.errorText);
}

/**
 * Keeps the message's place: Find jumps to it, and is sent on to the rows that
 * show it. The virtualized list can't measure a zero-height row.
 */
function Absorbed({ calls }: { calls: readonly string[] }) {
  const id = useAuiState((s) => s.message.id);
  return (
    <div
      data-testid="chat-absorbed-message"
      data-message-id={id}
      data-absorbed-by={calls.join(' ')}
      aria-hidden
      className="h-px"
    />
  );
}

function UserSlice() {
  const calls = useAbsorbed();
  return calls ? <Absorbed calls={calls} /> : <boundedMessageComponents.UserMessage />;
}
function SystemSlice() {
  const calls = useAbsorbed();
  return calls ? <Absorbed calls={calls} /> : <boundedMessageComponents.SystemMessage />;
}
const components = { UserMessage: UserSlice, AssistantMessage: AssistantSlice, SystemMessage: SystemSlice };

/** A jump opens the turn it lands in: the call's when it names one, else every turn of its message. */
function useJumps(model: TurnModel, chatId: string | undefined): void {
  useEffect(() => {
    const onJump = (event: Event) => {
      const { chatId: target, source } = (event as CustomEvent<ActivityJump>).detail;
      if (target !== chatId) return;
      const slice = model.slices.get(source.messageId);
      if (!slice?.work.length) return;
      const holds = slice.work.some(({ part }) => part.type === 'tool-call' && part.toolCallId === source.toolCallId);
      if (!source.toolCallId || holds) turnDisclosureStore.set(slice.turnKey, 'open');
    };
    window.addEventListener(ACTIVITY_JUMP_EVENT, onJump);
    return () => window.removeEventListener(ACTIVITY_JUMP_EVENT, onJump);
  }, [model, chatId]);
}

/** A thread that waits on a request reports itself idle; its run state still says whether the agent works on. */
function useTurnRunning(): boolean {
  const running = useAuiState((s) => s.thread.isRunning);
  const runState = useChatExtrasSelector((extras) => extras?.state.runState.type);
  return running || runState === 'running' || runState === 'cancelling';
}

export function TurnTranscript() {
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useTurnRunning();
  const runAfter = useChatExtrasSelector((extras) => extras?.state.run?.after);
  const scope = useTranscriptScope();
  const chatId = useChatExtrasSelector((extras) => extras?.state.chatId);
  const root = useRef<HTMLDivElement>(null);
  const turnScope = useMemo(() => ({ ...scope, isRunning, runAfter }), [scope, isRunning, runAfter]);
  // Kept per chat across switches (`use-transcript-turns.ts`): coming back reuses the turns.
  const model = useTranscriptTurns(messages, turnScope, () =>
    chatId ? chatControllerRegistry.get(chatId) : undefined,
  );
  const { children, world } = useLiveChildren(model, chatId, isRunning);
  useJumps(model, chatId);
  const state = useTurnState(model, children, root);
  const value: TurnContextValue = { model, children, ...state };
  return (
    <TurnProvider value={value}>
      <AgentWorldProvider value={world}>
        <div ref={root} data-testid="chat-transcript">
          <TranscriptList components={components} />
        </div>
      </AgentWorldProvider>
    </TurnProvider>
  );
}
