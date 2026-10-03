import { useMemo, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ExternalThread,
  ThreadPrimitive,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { TranscriptScrollProvider, type TranscriptScrollController } from '../../../thread/transcript-scroll-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TranscriptScopeProvider } from '../transcript-scope';
import { boundedMessageComponents } from '../../bounded-messages';
import { CompactTranscript } from '../CompactTranscript';
import { useUiPrefs } from '@/store/ui-prefs';
import { fixtureMessage } from './fixtures';
import type { NativePartSource } from '../../../view-model/transcript-presentation';

export const turnContext: TranscriptPresentation = {
  version: 1,
  provider: 'codex',
  turnId: 'turn',
  phase: 'work',
  state: 'completed',
  finalEligible: false,
};
export function turnSource(
  id: string,
  start: number,
  end: number,
  patch: Partial<TranscriptPresentation> = {},
): NativePartSource {
  return {
    sourceMessageId: id,
    sourceBlockIndex: 0,
    startUtf16: start,
    endUtf16: end,
    streaming: patch.state === 'running',
    presentation: { ...turnContext, ...patch },
  };
}
export function turnMessage(
  id: string,
  text: string,
  patch: Partial<TranscriptPresentation> = {},
  sources?: NativePartSource[],
) {
  const message = fixtureMessage([{ type: 'text', text }], id, patch.state === 'running');
  return {
    ...message,
    metadata: {
      ...message.metadata,
      custom: { mainframe: { partSources: { 0: sources ?? [turnSource(id, 0, text.length, patch)] } } },
    },
  };
}
export const finalMessage = (patch: Partial<TranscriptPresentation> = {}) =>
  turnMessage('final', 'Final answer', { phase: 'final_answer', finalEligible: true, ...patch });
interface Props {
  messages: ThreadMessage[];
  rootId: string;
  split?: boolean;
  children?: ReactNode;
  ancestors?: string[];
  extras?: unknown;
  pending?: string[];
  scroll?: TranscriptScrollController;
}
function Surface(props: Props) {
  const mode = useUiPrefs((state) => state.transcriptMode);
  const scope = useMemo(
    () => ({
      rootThreadId: props.rootId,
      chatId: 'chat-fixture',
      ancestors: props.ancestors ?? [],
      pendingToolIds: new Set(props.pending),
    }),
    [props.rootId, props.ancestors, props.pending],
  );
  return (
    <TooltipProvider>
      <TranscriptScopeProvider value={scope}>
        <TranscriptScrollProvider value={props.scroll ?? null}>
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Viewport data-testid="turn-viewport">
              {mode === 'compact' ? (
                <CompactTranscript />
              ) : (
                <ThreadPrimitive.Messages components={boundedMessageComponents} />
              )}
              {props.children}
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </TranscriptScrollProvider>
      </TranscriptScopeProvider>
    </TooltipProvider>
  );
}
function Split(props: Props) {
  const aui = useAui();
  const config = useMemo(
    () =>
      AuiConfig({
        thread: ExternalThread({
          messages: props.messages,
          isRunning: props.messages.some((message) => message.status?.type === 'running'),
          onNew: async () => {},
          extras: props.extras,
        }),
      }),
    [props.messages, props.extras],
  );
  return (
    <AuiProvider extends={aui} config={config}>
      <Surface {...props} />
    </AuiProvider>
  );
}
export function TurnFixture(props: Props) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: props.split ? [] : props.messages,
    extras: props.extras,
    isRunning: props.messages.some((message) => message.status?.type === 'running'),
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {props.split ? <Split {...props} /> : <Surface {...props} />}
    </AssistantRuntimeProvider>
  );
}
