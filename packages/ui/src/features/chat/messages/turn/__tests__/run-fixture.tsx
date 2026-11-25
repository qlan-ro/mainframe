/**
 * A session over the runtime the app mounts: events through the controller's
 * reducer, its projector and a `messageRepository`. assistant-ui adds its
 * stand-in for the coming reply there, which a list of messages never shows.
 */
import { act, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { StopReason, TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatStateEvent,
  type ChatThreadState,
} from '../../../controller/chat-thread-state';
import { TranscriptProjector } from '../../../controller/transcript-projector';
import { buildChatExtras, isRunningFromState } from '../../../runtime/chat-extras';
import { TranscriptScrollProvider } from '../../../thread/transcript-scroll-context';
import { TranscriptScopeProvider } from '../transcript-scope';
import { TurnTranscript } from '../TurnTranscript';

const controller = {} as AcpChatController;

export function RunThread({ state, rootId }: { state: ChatThreadState; rootId: string }) {
  const projector = useMemo(() => new TranscriptProjector(), []);
  const messageRepository = useMemo(() => projector.projectRepository(state), [projector, state]);
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messageRepository,
    isRunning: isRunningFromState(state),
    extras: buildChatExtras(controller, 31415, state),
    onNew: async () => {},
  });
  const scope = useMemo(
    () => ({ rootThreadId: rootId, chatId: 'chat', ancestors: [], pendingToolIds: new Set<string>() }),
    [rootId],
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TranscriptScopeProvider value={scope}>
          <TranscriptScrollProvider value={null}>
            <ThreadPrimitive.Root>
              <TurnTranscript />
            </ThreadPrimitive.Root>
          </TranscriptScrollProvider>
        </TranscriptScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

export const transcript = (messages: readonly ThreadMessage[]): ChatStateEvent => ({
  type: 'transcript.updated',
  messages: messages as unknown as ThreadMessageLike[],
});
export const START: ChatStateEvent = { type: 'run.started' };
/** The daemon's idle frame, and the settled stop behind it. */
export const idle = (stopReason?: StopReason): ChatStateEvent[] => [
  { type: 'run.ended', stopReason },
  { type: 'run.stopped' },
];
/** A send of this client's, not yet echoed. */
export const send = (clientId = 'p'): ChatStateEvent[] => [
  {
    type: 'local.message.queued',
    pending: { clientId, chatId: 'chat', text: 'also the tests', createdAt: 1, status: 'pending' },
  },
  { type: 'run.started', optimistic: true },
];
export const echoed = (clientId = 'p'): ChatStateEvent => ({ type: 'local.message.reconciled', clientId });
export const sendFailed = (clientId = 'p'): ChatStateEvent => ({
  type: 'local.message.failed',
  clientId,
  error: new Error('offline'),
  stage: 'send',
});
export const queued = (): ChatStateEvent => ({
  type: 'queued.snapshot',
  refs: [{ messageId: 'q', chatId: 'chat', uuid: 'q', content: 'also the tests', timestamp: new Date().toISOString() }],
});

let roots = 0;

export class Session {
  private readonly rootId = `session-${++roots}`;
  private view: ReturnType<typeof render>;

  private constructor(private state: ChatThreadState) {
    this.view = render(<RunThread state={state} rootId={this.rootId} />);
  }

  /** Opened over a loaded transcript, the session idle: what came before was not seen. */
  static open(messages: readonly ThreadMessage[], ...events: ChatStateEvent[]): Session {
    const loaded = [transcript(messages), ...events].reduce(reduceChatThreadState, {
      ...createChatThreadState('chat'),
      authoritativeItemStreaming: true,
      loadState: { type: 'ready' as const },
    });
    return new Session(loaded);
  }
  /** Reloaded while the session runs: the replay says so, and not since when. */
  static reload(messages: readonly ThreadMessage[]): Session {
    return Session.open(messages, { type: 'run.started', replayed: true });
  }

  async apply(...events: ChatStateEvent[]): Promise<void> {
    this.state = events.reduce(reduceChatThreadState, this.state);
    await act(async () => {
      this.view.rerender(<RunThread state={this.state} rootId={this.rootId} />);
      // The virtualized list draws its first rows a task later.
      await new Promise((resolve) => setTimeout(resolve));
    });
  }
  says(...messages: ThreadMessage[]): Promise<void> {
    return this.apply(transcript(messages));
  }
  /** The transcript is drawn again, over the controller that kept its state. */
  remount(): void {
    this.view.unmount();
    this.view = render(<RunThread state={this.state} rootId={this.rootId} />);
  }
  close(): void {
    this.view.unmount();
  }
}

const headers = () => screen.queryAllByTestId(/^chat-work-toggle-/);
export const names = () => headers().map((header) => header.getAttribute('aria-label')!.split(/[:,]/)[0]);
export const opened = () => headers().map((header) => header.getAttribute('aria-expanded') === 'true');
export const states = () => headers().map((header) => header.parentElement!.dataset.workState);

/** What each provider says about a part of a turn that goes on. */
export const PROVIDERS: [string, Partial<TranscriptPresentation> | undefined][] = [
  ['codex', { provider: 'codex', turnId: 't1', state: 'running' }],
  // A message in the middle of Claude's turn makes its presentation invalid, for the rest of the turn.
  ['claude', { provider: 'claude', turnId: 't1', state: 'invalid' }],
  ['a provider that says nothing', undefined],
];
