/**
 * A sub-agent's transcript row and its Agent tab, drawn side by side for the same
 * call (T1c, W8): in every state the tab's rule knows, what one says never
 * contradicts the other, and one says "running" exactly when the other does.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
  type ToolCallMessagePart,
} from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { ConnectionStatusProvider, type ConnectionStatus } from '@/app/ConnectionStatusContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { createChatThreadState, type ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { RootTranscriptScope } from '@/features/chat/messages/turn/transcript-scope';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { assistant, bash, running, text, tool, user } from '@/features/chat/messages/turn/__tests__/fixtures';
import { STATUS_WORDS } from '@/features/chat/messages/turn/tool-icons';
import { buildChatExtras, isRunningFromState } from '@/features/chat/runtime/chat-extras';
import { TranscriptScrollProvider } from '@/features/chat/thread/transcript-scroll-context';
import { useUiPrefs } from '@/store/ui-prefs';
import { NOTHING_LISTED, type ChatTasksState } from '../chat-tasks';

const { world, controller } = vi.hoisted(() => ({
  world: {
    state: null as unknown,
    messages: [] as unknown[],
    list: null as unknown,
  },
  controller: {
    load: vi.fn(async () => undefined),
    loadEarlier: vi.fn(async () => true),
    isHistoryContext: () => false,
    subscribeLive: () => () => undefined,
    holdActive: () => () => undefined,
  },
}));

vi.mock('@/features/chat/messages/AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn(async () => []),
  readBackgroundTaskOutput: vi.fn(),
  stopBackgroundTask: vi.fn(),
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => controller },
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
  useKnownDaemonPort: () => 31415,
}));
vi.mock('@/features/sessions/use-projects', () => ({ useProjects: () => ({ projects: [] }) }));
vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  useControllerState: () => world.state,
  CHAT_ATTACHMENT_ADAPTER: {},
}));
vi.mock('@/features/chat/runtime/use-native-thread-messages', () => ({
  useNativeThreadMessages: () => world.messages,
}));
// The store both read, at the point where they read it: each on its own hook, as in the app.
vi.mock('../chat-tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chat-tasks')>()),
  openChatTasks: () => ({ subscribe: () => () => undefined }),
  findChatTasks: () => ({
    state: world.list,
    setConnected: () => undefined,
    setEvents: () => undefined,
    watch: () => () => undefined,
  }),
}));

import { SubagentTabBody } from '../SubagentTabBody';

interface Scene {
  messages: readonly ThreadMessage[];
  session?: 'idle' | 'running' | 'cancelling';
  pending?: string;
  list?: ChatTasksState;
  connected?: boolean;
  run?: ChatThreadState['run'];
}

let roots = 0;

function Both({ scene, toolCallId }: { scene: Scene; toolCallId: string }) {
  const { messages, connected = true } = scene;
  const state = world.state as ChatThreadState;
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    isRunning: isRunningFromState(state),
    extras: buildChatExtras(controller as unknown as AcpChatController, 31415, state),
    onNew: async () => undefined,
  });
  return (
    <ConnectionStatusProvider
      value={{ state: connected ? 'connected' : 'reconnecting', daemonStatus: '' } as ConnectionStatus}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <TooltipProvider>
          <TranscriptScrollProvider value={null}>
            <RootTranscriptScope>
              <ThreadPrimitive.Root>
                <TurnTranscript />
              </ThreadPrimitive.Root>
            </RootTranscriptScope>
          </TranscriptScrollProvider>
          <SubagentTabBody chatId={state.chatId} toolCallId={toolCallId} title="agent" active />
        </TooltipProvider>
      </AssistantRuntimeProvider>
    </ConnectionStatusProvider>
  );
}

/** What the row and the tab say, by their own elements. */
async function draw(scene: Scene, toolCallId = 'call-1'): Promise<{ row: string; tab: string | null; spins: boolean }> {
  world.messages = [...scene.messages];
  world.list = scene.list ?? NOTHING_LISTED;
  world.state = {
    ...createChatThreadState(`chat-${++roots}`),
    loadState: { type: 'ready' },
    runState: { type: scene.session ?? 'idle' },
    run: scene.run ?? null,
    interactions: {
      permissions: scene.pending ? { r: { request: { toolUseId: scene.pending } } } : {},
      queued: {},
    },
  } as unknown as ChatThreadState;
  render(<Both scene={scene} toolCallId={toolCallId} />);
  // The virtualized list draws its first rows a task later.
  await act(async () => new Promise((resolve) => setTimeout(resolve)));
  const outer = screen.queryByTestId('chat-row-call-1-toggle');
  if (toolCallId !== 'call-1' && outer?.getAttribute('aria-expanded') === 'false') fireEvent.click(outer);
  const line = screen.getAllByTestId(`chat-row-${toolCallId}`)[0]!.firstElementChild!;
  const tab = screen.queryByTestId(`workspace-agent-status-${toolCallId}`);
  const word = line.querySelector('.sr-only')!.textContent!.replace(': ', '');
  const [row] = Object.entries(STATUS_WORDS).find(([, said]) => said === word)!;
  return { row, tab: tab?.dataset.status ?? null, spins: line.querySelector('.animate-spin') !== null };
}

const step = () => assistant([bash('t-1', 'ls', running)], 'step') as ThreadMessage;
const agent = (over: Partial<ToolCallMessagePart> = {}) =>
  tool({
    toolCallId: 'call-1',
    toolName: 'Task',
    args: { subagent_type: 'reviewer', description: 'Review', prompt: 'Look' },
    result: undefined,
    providerMetadata: undefined,
    messages: [step()],
    ...over,
  });
const inTurn = (part: ToolCallMessagePart, isRunning = false) => [
  user('Go', 'u1'),
  assistant([part], 'm-1', { running: isRunning }),
];

type Status = BackgroundTask['status'];
const tasks = (...statuses: Status[]) =>
  statuses.map(
    (status, id) => ({ id: `bg-${id}`, kind: 'agent', toolUseId: 'call-1', status, startedAt: id }) as never,
  );
const LISTS: Record<string, BackgroundTask[] | null> = {
  null: null,
  empty: [],
  running: tasks('running'),
  completed: tasks('completed'),
  failed: tasks('failed'),
  stopped: tasks('stopped'),
  mixed: tasks('failed', 'running', 'completed', 'running'),
  'mixed, settled': tasks('completed', 'stopped', 'failed', 'stopped'),
};
const RESULTS: Record<string, Partial<ToolCallMessagePart>> = {
  none: {},
  text: { result: 'Two races.' },
  error: { result: 'It broke.', isError: true },
  'error, no result yet': { isError: true },
};
const BOTH = [true, false];

/** What a row may say next to each word of its tab's. A silent tab leaves the row anything that claims no work. */
const AGREES: Record<string, readonly string[]> = {
  running: ['running'],
  'needs-you': ['needs-you', 'awaiting-approval'],
  failed: ['failed'],
  stopped: ['stopped'],
  none: ['success', 'stopped', 'unknown', 'failed'],
};

beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'open' });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(Object.keys(RESULTS))('a call whose result is %s', (result) => {
  describe.each(Object.keys(LISTS))('with the list %s', (list) => {
    it.each(
      (
        [
          { live: true, connected: true },
          { live: false, connected: true },
          { live: true, connected: false },
        ] as const
      ).flatMap((list) =>
        (['idle', 'running', 'cancelling'] as const).flatMap((session) =>
          BOTH.flatMap((pending) => BOTH.map((cancelled) => ({ ...list, session, pending, cancelled }))),
        ),
      ),
    )('%j', async ({ live, connected, session, pending, cancelled }) => {
      const part = agent({
        ...RESULTS[result],
        ...(cancelled && { providerMetadata: { mainframe: { acpStatus: 'cancelled' } } }),
      });
      const { row, tab, spins } = await draw({
        messages: inTurn(part, session !== 'idle'),
        session,
        pending: pending ? 't-1' : undefined,
        list: { tasks: LISTS[list]!, live },
        connected,
      });
      expect(AGREES[tab ?? 'none']).toContain(row);
      expect(row === 'running').toBe(tab === 'running');
      expect(spins).toBe(tab === 'running');
    });
  });
});

describe('a call that is not the last thing the session does', () => {
  const left = agent(running);
  const next = [user('Next', 'u2'), assistant([text('Hi')], 'm-2', { running: true })];

  it('runs for neither in an earlier part the run is not in', async () => {
    const messages = [...inTurn(left), ...next];
    expect(await draw({ messages, session: 'running' })).toEqual({ row: 'stopped', tab: null, spins: false });
    cleanup();
    const run = { after: 'm-1', confirmed: true } as never;
    expect((await draw({ messages, session: 'running', run })).tab).toBeNull();
  });

  it('runs for both in an earlier part of the run in progress', async () => {
    const run = { after: null, confirmed: true } as never;
    const both = await draw({ messages: [...inTurn(left), ...next], session: 'running', run });
    expect(both).toEqual({ row: 'running', tab: 'running', spins: true });
  });

  it('runs for both once the list names a task of it, and stops for both with the session idle', async () => {
    const launched = agent({ result: 'Async agent launched successfully.' });
    const messages = [...inTurn(launched), ...next];
    const list = { tasks: tasks('running'), live: true };
    expect(await draw({ messages, list })).toEqual({ row: 'running', tab: 'running', spins: true });
    cleanup();
    expect(await draw({ messages: inTurn(left) })).toEqual({ row: 'stopped', tab: null, spins: false });
  });
});

it('waits for both while the call itself asks to be allowed', async () => {
  const both = await draw({ messages: inTurn(agent(running), true), session: 'running', pending: 'call-1' });
  expect(both).toEqual({ row: 'awaiting-approval', tab: 'needs-you', spins: false });
});

describe('an agent another agent started', () => {
  const inner = agent({ toolCallId: 'inner', ...running });
  const around = (over: Partial<ToolCallMessagePart>) =>
    inTurn(agent({ ...over, messages: [assistant([inner], 'n') as ThreadMessage] }), true);
  const open = (scene: Scene) => draw(scene, 'inner');

  it('runs for both while the one around it does', async () => {
    const both = await open({ messages: around(running), session: 'running' });
    expect(both).toMatchObject({ row: 'running', tab: 'running' });
  });

  it('runs for neither once the one around it came back', async () => {
    const both = await open({ messages: around({ result: 'Done.' }), session: 'running' });
    expect(both).toMatchObject({ row: 'stopped', tab: null });
  });
});
