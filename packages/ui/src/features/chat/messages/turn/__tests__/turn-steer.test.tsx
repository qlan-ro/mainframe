/**
 * Writing into a run, over the runtime the app mounts: the controller's state,
 * its projector and a `messageRepository`. assistant-ui adds its stand-in for
 * the coming reply there, which a list of messages never shows.
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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { createChatThreadState, type ChatThreadState } from '../../../controller/chat-thread-state';
import { TranscriptProjector } from '../../../controller/transcript-projector';
import { buildChatExtras, isRunningFromState } from '../../../runtime/chat-extras';
import { TranscriptScrollProvider } from '../../../thread/transcript-scroll-context';
import { TranscriptScopeProvider } from '../transcript-scope';
import { TurnTranscript } from '../TurnTranscript';
import { assistant, bash, running, text, tool, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue({ text: '', truncated: false }),
}));

const controller = {} as AcpChatController;

function Thread({ state, rootId }: { state: ChatThreadState; rootId: string }) {
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

const RUNNING = { type: 'running' } as const;
const IDLE = { type: 'idle' } as const;
const likes = (messages: ThreadMessage[]) => messages as unknown as ThreadMessageLike[];
const stateOf = (messages: ThreadMessage[], over: Partial<ChatThreadState> = {}): ChatThreadState => ({
  ...createChatThreadState('chat'),
  authoritativeItemStreaming: true,
  loadState: { type: 'ready' },
  runState: RUNNING,
  messages: likes(messages),
  ...over,
});
const pending = (error?: string): Partial<ChatThreadState> => ({
  pendingUserMessages: {
    p: {
      clientId: 'p',
      chatId: 'chat',
      text: 'also the tests',
      createdAt: Date.now(),
      status: error ? 'failed' : 'pending',
      ...(error && { error: new Error(error) }),
    } as never,
  },
});
const queued = (): Partial<ChatThreadState> => ({
  interactions: {
    permissions: {},
    queued: {
      q: {
        messageId: 'u2',
        chatId: 'chat',
        uuid: 'q',
        content: 'also the tests',
        timestamp: new Date().toISOString(),
      },
    },
  },
});

let roots = 0;
function open(first: ChatThreadState) {
  const rootId = `steer-${++roots}`;
  const view = render(<Thread state={first} rootId={rootId} />);
  return (next: ChatThreadState) => act(async () => view.rerender(<Thread state={next} rootId={rootId} />));
}
const headers = () => screen.getAllByTestId(/^chat-work-toggle-/);
const names = () => headers().map((header) => header.getAttribute('aria-label')!.split(/[:,]/)[0]);
const opened = () => headers().map((header) => header.getAttribute('aria-expanded'));

/** What each provider says about a part of a turn that goes on. */
const PROVIDERS = [
  ['codex', { provider: 'codex', turnId: 't1', state: 'running' }],
  // A message in the middle of Claude's turn makes its presentation invalid, for the rest of the turn.
  ['claude', { provider: 'claude', turnId: 't1', state: 'invalid' }],
  ['a provider that says nothing', undefined],
] as const;

beforeEach(() => useUiPrefs.setState({ finishedWork: 'fold' }));

describe.each(PROVIDERS)('a message sent into a run of %s', (_name, presentation) => {
  const shell = bash('b', 'pnpm test', running);
  const agent = tool({ toolCallId: 'agent', toolName: 'CollabAgent', args: { prompt: 'Look' }, ...running });
  const started = [user('Go', 'u1'), assistant([shell, agent], 'a1', { presentation })];
  const steer = user('also the tests', 'u2');
  const stillGoes = () => {
    expect(names()[0]).not.toMatch(/Stopped|Finished|Ended/);
    expect(opened()[0]).toBe('true');
    expect(screen.getByTestId('chat-row-b')).not.toHaveTextContent(/stopped/i);
    expect(screen.getByTestId('chat-row-agent-receipt')).toHaveTextContent('running');
  };

  it('leaves a running command and agent running, from the send until the reply', async () => {
    const show = open(stateOf(started));
    stillGoes();
    await show(stateOf(started, pending()));
    stillGoes();
    await show(stateOf(started, queued()));
    stillGoes();
    await show(stateOf([...started, steer]));
    stillGoes();
    // Each update gives the stand-in another id.
    await show(stateOf([...started, steer]));
    stillGoes();
    if (!presentation) return; // nothing says which turn the reply belongs to
    await show(stateOf([...started, steer, assistant([text('Sure')], 'a2', { presentation })]));
    stillGoes();
    await show(stateOf([...started, steer, assistant([bash('c', 'ls', running)], 'a2', { presentation })]));
    expect(names()).toEqual(['Still going', 'Running']);
  });

  it('does not fold a turn between two steps when the message is on its way', async () => {
    const between = [user('Go', 'u1'), assistant([bash('b', 'ls')], 'a1', { presentation })];
    const show = open(stateOf(between));
    expect([names(), opened()]).toEqual([['Running'], ['true']]);
    for (const step of [pending(), queued(), pending('offline')]) {
      await show(stateOf(between, step));
      expect([names(), opened()]).toEqual([['Running'], ['true']]);
    }
  });

  it('never wakes a turn that had ended', async () => {
    const ended = presentation && { ...presentation, state: 'completed' as const };
    const done = [
      user('Go', 'u1'),
      assistant([bash('b', 'ls'), shellCut, text('Done')], 'a1', { presentation: ended }),
    ];
    const show = open(stateOf(done, { runState: IDLE }));
    const before = [names(), opened()];
    expect(before[0]).not.toContain('Running');
    for (const next of [
      stateOf(done, { runState: IDLE, ...pending() }),
      stateOf(done, pending()),
      stateOf([...done, steer]),
      stateOf([...done, steer, assistant([text('Hi')], 'a2')]),
    ]) {
      await show(next);
      expect([names().slice(0, 1), opened().slice(0, 1)]).toEqual(before);
    }
  });
});

/** What a killed session left behind. */
const shellCut = bash('cut', 'sleep 60', running);

it('never wakes a turn a killed session left half-way, whatever the provider last said of it', async () => {
  const presentation = { provider: 'codex', turnId: 't1', state: 'running' } as const;
  const killed = [user('Go', 'u1'), assistant([shellCut], 'a1', { presentation })];
  const show = open(stateOf(killed, { runState: IDLE }));
  expect(names()).toEqual(['Stopped']);
  await show(stateOf(killed, { runState: IDLE, ...pending() }));
  await show(stateOf(killed, pending()));
  expect([names(), opened()]).toEqual([['Stopped'], ['false']]);
  await show(stateOf([...killed, user('Again', 'u2')]));
  expect([names(), opened()]).toEqual([['Stopped'], ['false']]);
});

it('lets a turn the provider has ended go, when the next one starts at once', async () => {
  const at = (state: 'running' | 'completed') => [
    user('Go', 'u1'),
    assistant([shellCut], 'a1', { presentation: { provider: 'codex', turnId: 't1', state } }),
  ];
  const show = open(stateOf(at('running')));
  // Its end and the queued prompt that starts the next turn arrive in one update: no idle between.
  await show(stateOf([...at('completed'), user('also the tests', 'u2')]));
  expect([names(), opened()]).toEqual([['Stopped'], ['false']]);
});

it('keeps a turn running under a second message sent before its first words', async () => {
  const show = open(stateOf([user('Go', 'u1')], pending()));
  await show(stateOf([user('Go', 'u1'), assistant([bash('b', 'ls')], 'a1')], pending()));
  expect([names(), opened()]).toEqual([['Running'], ['true']]);
});

it('runs on over a send that failed while it was idle', async () => {
  const done = [user('Go', 'u1'), assistant([bash('b', 'ls'), text('Done')], 'a1')];
  const show = open(stateOf(done, { runState: IDLE }));
  await show(stateOf(done, { runState: IDLE, ...pending('offline') }));
  // A background agent came back and the turn goes on, with no message from the viewer.
  await show(stateOf([...done, assistant([bash('c', 'ls', running)], 'a2')], pending('offline')));
  expect([names(), opened()]).toEqual([['Running'], ['true']]);
});

it('knows a steered turn of Codex after a reload', () => {
  const presentation = { provider: 'codex', turnId: 't1', state: 'running' } as const;
  open(stateOf([user('Go', 'u1'), assistant([shellCut], 'a1', { presentation }), user('More', 'u2')]));
  expect([names(), opened()]).toEqual([['Still going'], ['true']]);
});

describe('the stand-in for the coming reply', () => {
  it('is no turn and no message: nothing to copy, no time, no footer', async () => {
    open(stateOf([user('Go', 'u1')]));
    expect(screen.getByTestId('chat-reply-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId(/^chat-work-header-/)).toBeNull();
    expect(screen.queryByTestId('chat-assistant-message')).toBeNull();
    expect(screen.getAllByTestId('chat-message-footer')).toHaveLength(1);
  });

  it('claims no gap in the conversation, and does not take the status row from the message sent', async () => {
    const asked = { ...user('Go', 'u1'), createdAt: new Date(Date.now() - 3 * 60 * 60_000) } as ThreadMessage;
    const show = open(stateOf([asked]));
    expect(screen.getAllByTestId('chat-time-marker')).toHaveLength(1);
    const status = screen.getByTestId('chat-turn-status');
    // The row is not mounted again, which would restart its clock and its fade.
    await show(stateOf([asked], { contextUsage: { percentage: 1, totalTokens: 1, maxTokens: 2 } }));
    await show(stateOf([asked]));
    expect(screen.getByTestId('chat-turn-status')).toBe(status);
  });

  it('leaves the status row above a queued prompt', () => {
    open(stateOf([user('Go', 'u1')], queued()));
    const order = screen.getByTestId('chat-turn-status').compareDocumentPosition(screen.getByText('also the tests'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
