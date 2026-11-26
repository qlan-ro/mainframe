import {
  assistant as turnAssistant,
  bash,
  failed,
  TurnFixture,
  user,
} from '@/features/chat/messages/turn/__tests__/fixtures';
/**
 * SubagentTabBody — a sub-agent in a workspace tab (W8): title, kind, status,
 * Stop while live, brief, steps and result, read from the parent's transcript.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask, HistoryPageResult } from '@qlan-ro/mainframe-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatusProvider } from '@/app/ConnectionStatusContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { onSurfaceIntent } from '@/store/surface-intents';

interface Call {
  toolName?: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  messages?: Partial<ThreadMessage>[];
  providerMetadata?: { mainframe: { acpStatus?: string; subagentFact?: { status: string } } };
}

const { controller, world } = vi.hoisted(() => ({
  controller: {
    load: vi.fn(async () => undefined),
    loadEarlier: vi.fn(async () => true),
    subagentHistory: { page: vi.fn(async (): Promise<HistoryPageResult> => ({ hasMore: false, updates: [] })) },
    isHistoryContext: vi.fn(() => false),
    subscribeLive: vi.fn(() => vi.fn()),
    holdActive: vi.fn(() => vi.fn()),
  },
  world: {
    call: null as Call | null,
    running: false,
    runState: undefined as string | undefined,
    permissions: {} as Record<string, { request: { toolUseId: string } }>,
    tasks: [] as Partial<BackgroundTask>[],
    /** Whether the daemon answers the task list, refuses it, or hasn't answered yet. */
    listing: 'answered' as 'answered' | 'refused' | 'pending',
    hasMore: false,
    adapterId: 'claude',
    /** A new object per background event, as the reducer's. */
    backgroundTasks: undefined as object | undefined,
    list: vi.fn(),
    stop: vi.fn(async () => undefined),
  },
}));

vi.mock('@assistant-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@assistant-ui/react')>();
  return {
    ...actual,
    // The chat column's thread, which is another chat's.
    useAuiState: (select: (s: unknown) => unknown) =>
      world.call?.messages?.some((step) => step.role === 'user')
        ? actual.useAuiState(select)
        : select({
            thread: {},
            threads: {
              threadItems: [
                { id: 'column', custom: { projectId: 'p1', worktreePath: '/wt/column' } },
                { id: 'parent', custom: { projectId: 'p1', worktreePath: '/wt/parent' } },
              ],
            },
          }),
  };
});
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'p1', path: '/proj' }] }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
  useKnownDaemonPort: () => 31415,
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => controller },
}));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: async (chatId: string) => {
    world.list(chatId);
    if (world.listing === 'refused') throw new Error('daemon is away');
    if (world.listing === 'pending') await new Promise(() => undefined);
    return world.tasks;
  },
  stopBackgroundTask: (chatId: string, taskId: string) => {
    (world.stop as (...args: string[]) => Promise<void>)(chatId, taskId);
    return Promise.resolve();
  },
}));
vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  useControllerState: () => ({
    loadState: { type: 'ready' },
    runState: { type: world.runState ?? (world.running ? 'running' : 'idle') },
    historyWindow: { hasMore: world.hasMore },
    run: null,
    interactions: { permissions: world.permissions },
    backgroundTasks: world.backgroundTasks,
    chatConfig: { adapterId: world.adapterId },
  }),
  CHAT_ATTACHMENT_ADAPTER: {},
}));
vi.mock('@/features/chat/runtime/use-native-thread-messages', () => ({
  useNativeThreadMessages: () => messages(),
}));
vi.mock('@/features/chat/messages/turn/AgentSteps', async (original) => {
  const { AgentSteps } = await original<typeof import('@/features/chat/messages/turn/AgentSteps')>();
  return {
    AgentSteps: (props: React.ComponentProps<typeof AgentSteps>) =>
      props.messages.some((step) => step.role === 'user') ? (
        <AgentSteps {...props} />
      ) : (
        <StubSteps messages={props.messages} />
      ),
  };
});

function StubSteps({ messages: steps }: { messages: readonly ThreadMessage[] }) {
  const { openFile } = useOpenFile();
  return (
    <button type="button" data-testid="steps" data-chat={useChatId()} onClick={() => openFile('src/step.ts')}>
      {steps.map((step) => step.id).join(',')}
    </button>
  );
}

const assistant = (id: string, content: ThreadMessage['content']) =>
  ({
    id,
    role: 'assistant',
    content,
    status: { type: 'complete', reason: 'stop' },
    metadata: { custom: {} },
  }) as unknown as ThreadMessage;

let cached: { call: Call | null; list: ThreadMessage[] } = { call: null, list: [] };
/** Identity-stable per call, like the projector. */
function messages(): ThreadMessage[] {
  if (cached.call !== world.call) {
    const part = world.call && { type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', ...world.call };
    cached = {
      call: world.call,
      list: part ? [assistant('m-1', [part as never])] : [],
    };
  }
  return cached.list;
}

import { registerSideChat, __resetSideChatRegistryForTests } from '@/features/side-chat/side-chat-ids';
import { useChatId, useOpenFile } from '@/features/chat/tools/chat-tool-context';
import { useMountedConversations } from '../mounted-conversations';
import { SubagentTabBody } from '../SubagentTabBody';
import { HistoricalAgentSteps } from '@/features/chat/messages/turn/HistoricalAgentSteps';
import {
  historyKey,
  loadSubagentPage,
  useSubagentHistoryStore,
} from '@/features/chat/messages/turn/subagent-history-store';
import { useLayoutStore } from '@/store/layout';
import { resetStops } from '@/features/session-panel/use-stop';

const body = (active = true, chatId = 'parent') => (
  <TooltipProvider>
    <SubagentTabBody chatId={chatId} toolCallId="call-1" messageId="m-1" title="reviewer" active={active} />
  </TooltipProvider>
);
async function show(call: Call | null, active = true, chatId = 'parent') {
  world.call = call;
  const view = render(body(active, chatId));
  await act(async () => undefined);
  return view;
}

const ARGS = {
  subagent_type: 'code-reviewer',
  model: 'sonnet',
  run_in_background: false,
  description: 'Review the diff',
  prompt: 'Look for **races**.',
};
const RECEIPT = 'Async agent launched successfully.\nagentId: a1';
const STATUS = 'workspace-agent-status-call-1';
const RESULT = 'workspace-agent-result-call-1';
const REPORT = 'workspace-agent-report-call-1';
const STOP = 'workspace-agent-stop-call-1';
/** What the header reads, or null. */
const status = () => screen.queryByTestId(STATUS)?.textContent ?? null;
const bg = (overrides: Partial<BackgroundTask> = {}): Partial<BackgroundTask> => ({
  id: 'bg-1',
  toolUseId: 'call-1',
  status: 'running',
  startedAt: 1,
  ...overrides,
});
/** A background event reaches the open tab. */
async function event(view: { rerender: (ui: React.ReactElement) => void }) {
  world.backgroundTasks = {};
  view.rerender(body());
  await act(async () => undefined);
}
const step = (id: string, toolCallId: string) =>
  ({
    id,
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName: 'Bash' }],
  }) as unknown as ThreadMessage;

beforeEach(() => {
  resetStops();
  Object.assign(world, {
    call: null,
    running: false,
    runState: undefined,
    permissions: {},
    tasks: [],
    listing: 'answered',
    hasMore: false,
    adapterId: 'claude',
    backgroundTasks: undefined,
  });
  world.stop.mockClear();
  world.list.mockClear();
  __resetSideChatRegistryForTests();
  controller.loadEarlier.mockClear().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what it shows', () => {
  it('names the agent, its kind and model, and draws its brief, steps and result', async () => {
    await show({ args: ARGS, result: 'No races found.', messages: [step('s-1', 't-1'), step('s-2', 't-2')] });

    const header = screen.getByTestId('workspace-agent-header-call-1');
    expect(header).toHaveTextContent('Review the diff');
    expect(header).toHaveTextContent('Sub-agent · code-reviewer · sonnet');
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toHaveTextContent('Look for races.');
    expect(screen.getByTestId('steps')).toHaveTextContent('s-1,s-2');
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('No races found.');
  });

  it('scrolls by keyboard: its content is a named region that can take the focus', async () => {
    await show({ args: ARGS, result: 'ok' });
    const region = screen.getByRole('region', { name: 'Review the diff' });
    expect(region).toHaveAttribute('data-conversation-scroller');
    act(() => region.focus());
    expect(region).toHaveFocus();
  });

  it('has no composer', async () => {
    await show({ args: ARGS, result: 'ok' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('holds its parent’s controller without taking its composer', async () => {
    const view = await show({ args: ARGS });
    expect(useMountedConversations.getState().held.has('parent')).toBe(true);
    expect(useMountedConversations.getState().composing.has('parent')).toBe(false);
    view.unmount();
    expect(useMountedConversations.getState().held.has('parent')).toBe(false);
  });
});

describe('status', () => {
  it.each([
    ['running', { args: ARGS }, true],
    [null, { args: ARGS }, false],
    [null, { args: ARGS, result: 'ok' }, true],
    ['failed', { args: ARGS, result: 'boom', isError: true }, false],
    ['stopped', { args: ARGS, providerMetadata: { mainframe: { acpStatus: 'cancelled' } } }, true],
  ] as const)('is %s', async (expected, call, running) => {
    world.running = running;
    await show(call);
    expect(status()).toBe(expected);
  });

  it('is running while another call waits for an answer, and until a cancelled turn has ended', async () => {
    world.permissions = { req: { request: { toolUseId: 'elsewhere' } } };
    world.runState = 'cancelling';
    await show({ args: ARGS });
    expect(status()).toBe('running');
  });

  it('needs you while one of its own calls waits for an answer', async () => {
    world.permissions = { req: { request: { toolUseId: 't-2' } } };
    await show({ args: ARGS, messages: [step('s-1', 't-1'), step('s-2', 't-2')] });
    expect(status()).toBe('needs you');
  });

  it('keeps live steps when a restored background agent needs permission', async () => {
    world.tasks = [bg()];
    const call = {
      args: { ...ARGS, run_in_background: true },
      result: RECEIPT,
      providerMetadata: { mainframe: { subagentFact: { status: 'unknown' } } },
      messages: [step('live-step', 'permission-tool')],
    };
    const view = await show(call);
    expect(status()).toBe('running');
    world.permissions = { req: { request: { toolUseId: 'permission-tool' } } };
    await event(view);
    expect(status()).toBe('needs you');
    expect(screen.getByTestId('steps')).toHaveTextContent('live-step');
  });

  it.each([
    ['completed', null],
    ['failed', 'failed'],
    ['stopped', 'stopped'],
    ['running', 'running'],
  ] as const)('of a foreground call with an answer and a %s record is %s', async (record, expected) => {
    world.tasks = [bg({ status: record, summary: 'Summary.' })];
    await show({ args: ARGS, result: 'No races found.' });
    expect(status()).toBe(expected);
    expect(screen.getByTestId(RESULT)).toHaveTextContent('No races found.');
    expect(screen.queryByTestId(REPORT)).toBeNull();
  });

  it('counts the agents running', async () => {
    world.tasks = [bg(), bg({ id: 'bg-2' }), bg({ id: 'bg-3', status: 'completed' })];
    await show({ args: ARGS, toolName: 'CollabAgent' });
    expect(status()).toBe('2 running');
  });

  it('is not running once the list has a closed agent, though its call has no result', async () => {
    world.running = true;
    world.tasks = [bg({ status: 'completed' })];
    await show({ args: ARGS, toolName: 'CollabAgent' });
    expect(status()).toBeNull();
  });

  it('takes no word from another call’s task', async () => {
    world.tasks = [bg({ toolUseId: 'call-2' })];
    await show({ args: ARGS, result: 'No races found.' });
    expect(status()).toBeNull();
  });
});

describe('text', () => {
  const launched = { args: { ...ARGS, run_in_background: true }, result: RECEIPT };

  it.each(['answered', 'pending', 'refused'] as const)(
    'shows a launch receipt while the list is %s',
    async (listing) => {
      world.listing = listing;
      await show(launched);
      expect(screen.getByTestId(RESULT)).toHaveTextContent('agentId: a1');
      expect(status()).toBeNull();
    },
  );

  it('shows a background agent’s summary below the receipt, with its source', async () => {
    world.tasks = [bg({ status: 'completed', summary: 'Two races.' })];
    await show(launched);
    const receipt = screen.getByTestId(RESULT);
    const report = screen.getByTestId(REPORT);
    expect(report).toHaveTextContent('Task summaryTwo races.');
    expect(receipt.compareDocumentPosition(report)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(status()).toBeNull();
  });

  it('hides the summary of a call that is not in the background by its argument', async () => {
    world.tasks = [bg({ status: 'completed', summary: 'Two races.' })];
    await show({ args: { ...ARGS, run_in_background: undefined }, result: RECEIPT });
    expect(screen.getByTestId(RESULT)).toHaveTextContent('agentId: a1');
    expect(screen.queryByTestId(REPORT)).toBeNull();
  });

  it('shows the summary alone for a call with no text of its own', async () => {
    world.tasks = [bg({ status: 'stopped', summary: 'Half of it.' })];
    await show({ args: ARGS });
    expect(screen.queryByTestId(RESULT)).toBeNull();
    expect(screen.getByTestId(REPORT)).toHaveTextContent('Half of it.');
  });

  const MARKED = '# Not a heading\n\n**not bold** <b>not HTML</b>\n  [no link](src/a.ts)';

  it.each([
    ['of an error', { args: ARGS, result: MARKED, isError: true }],
    ['of a launch', { args: { ...ARGS, run_in_background: true }, result: MARKED }],
  ])('shows as text, not as Markdown or HTML, the result %s', async (_, call) => {
    await show(call);
    const text = screen.getByTestId(RESULT).querySelector('p')!;
    expect(text.textContent).toBe(MARKED);
    expect(text.childElementCount).toBe(0);
    expect(text).toHaveClass('whitespace-pre-wrap');
  });

  it('shows an answer as the Markdown it is, and no HTML', async () => {
    await show({ args: { ...ARGS, run_in_background: undefined }, result: '**Bold** <b>tag</b>\n\n- one\n- two' });
    const result = screen.getByTestId(RESULT);
    expect(result.querySelector('strong')).toHaveTextContent('Bold');
    expect(result.querySelectorAll('li')).toHaveLength(2);
    expect(result.querySelector('b')).toBeNull();
  });

  it('shows a task’s summary as text too', async () => {
    world.tasks = [bg({ status: 'completed', summary: MARKED })];
    await show({ args: ARGS });
    expect(screen.getByTestId(REPORT).querySelector('p')!.textContent).toBe(MARKED);
  });

  it('hides Running and Stop once no list has come for 30 s, and keeps the text', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    world.tasks = [bg()];
    const view = await show(launched);
    world.listing = 'refused';
    await event(view);
    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(status()).toBe('running');
    expect(screen.getByTestId(STOP)).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(status()).toBeNull();
    expect(screen.queryByTestId(STOP)).toBeNull();
    expect(screen.getByTestId(RESULT)).toHaveTextContent('agentId: a1');
  });

  it('shows no section with nothing to show', async () => {
    world.tasks = [bg({ status: 'completed', summary: '' })];
    await show({ args: ARGS, result: '\n' });
    expect(screen.queryByTestId(RESULT)).toBeNull();
    expect(screen.queryByTestId(REPORT)).toBeNull();
    expect(screen.queryByText(/no result/i)).toBeNull();
  });

  it('says why an agent could not be launched', async () => {
    world.listing = 'refused';
    await show({ ...launched, result: 'No such agent type', isError: true });
    expect(status()).toBe('failed');
    expect(screen.getByTestId(RESULT)).toHaveTextContent('No such agent type');
  });

  it('shows each Codex agent’s final answer when the call has none', async () => {
    const source = (thread: string) => ({
      presentation: {
        turnId: JSON.stringify([thread, 't']),
        state: 'completed',
        phase: 'final_answer',
        parentToolUseId: 'call-1',
      },
    });
    const steps = {
      id: 'steps',
      role: 'assistant',
      content: ['Answer **a**.', 'Answer b.'].map((text) => ({ type: 'text', text })),
      metadata: { custom: { mainframe: { partSources: { 0: [source('a')], 1: [source('b')] } } } },
    } as unknown as ThreadMessage;
    await show({ args: ARGS, toolName: 'CollabAgent', messages: [steps] });
    expect(screen.getAllByTestId(REPORT).map((el) => el.textContent)).toEqual([
      'Final answerAnswer a.',
      'Final answerAnswer b.',
    ]);
    // The agent's own prose, by its source.
    expect(screen.getAllByTestId(REPORT)[0]!.querySelector('strong')).toHaveTextContent('a');
  });
});

describe('the task list', () => {
  const call = { args: ARGS, result: RECEIPT };
  const at = (state: 'connected' | 'reconnecting') => (
    <ConnectionStatusProvider value={{ state, daemonStatus: '' } as never}>{body()}</ConnectionStatusProvider>
  );

  it.each(['pending', 'refused'] as const)('keeps running and Stop while the next answer is %s', async (listing) => {
    world.tasks = [bg()];
    const view = await show(call);
    world.listing = listing;
    await event(view);
    expect(status()).toBe('running');
    expect(screen.getByTestId(STOP)).toBeEnabled();
  });

  it('hides running and Stop without a connection, and until a list has come after it; the text stays', async () => {
    world.call = call;
    world.tasks = [bg()];
    const view = render(at('connected'));
    await act(async () => undefined);
    expect(status()).toBe('running');

    const away = () => {
      expect(status()).toBeNull();
      expect(screen.queryByTestId(STOP)).toBeNull();
      expect(screen.getByTestId(RESULT)).toHaveTextContent('agentId: a1');
    };
    view.rerender(at('reconnecting'));
    away();
    world.listing = 'refused';
    view.rerender(at('connected'));
    away();
    await act(async () => undefined);
    away();

    world.listing = 'answered';
    await waitFor(() => expect(status()).toBe('running'), { timeout: 3_000 });
    expect(screen.getByTestId(STOP)).toBeVisible();
  });

  it('hides a running call that no task reports on, until a list has come after the connection', async () => {
    world.call = { args: ARGS };
    world.running = true;
    const view = render(at('connected'));
    await act(async () => undefined);
    expect(status()).toBe('running');
    view.rerender(at('reconnecting'));
    expect(status()).toBeNull();
    world.listing = 'pending';
    view.rerender(at('connected'));
    await act(async () => undefined);
    expect(status()).toBeNull();
  });

  it('keeps a settled status without a connection', async () => {
    world.call = call;
    world.tasks = [bg({ status: 'failed' })];
    const view = render(at('connected'));
    await act(async () => undefined);
    view.rerender(at('reconnecting'));
    expect(status()).toBe('failed');
  });

  it('is read again on every event, while the tab is in front', async () => {
    const view = await show({ args: ARGS });
    expect(world.list).toHaveBeenCalledTimes(1);
    await event(view);
    expect(world.list).toHaveBeenCalledTimes(2);
  });

  it('is not read behind another tab, and is brought up to date in front', async () => {
    const view = await show({ args: ARGS }, false);
    world.backgroundTasks = {};
    view.rerender(body(false));
    await act(async () => undefined);
    expect(world.list).not.toHaveBeenCalled();

    world.tasks = [bg()];
    view.rerender(body(true));
    await act(async () => undefined);
    expect(world.list).toHaveBeenCalledTimes(1);
    expect(status()).toBe('running');
  });
});

describe('Stop', () => {
  const call = { args: ARGS, result: 'Async agent launched' };

  it('stops a running background agent at once', async () => {
    world.tasks = [bg()];
    await show(call);
    fireEvent.click(screen.getByTestId(STOP));
    expect(world.stop).toHaveBeenCalledWith('parent', 'bg-1');
  });

  it('is asked for once, however often the list is read again', async () => {
    world.tasks = [bg()];
    const view = await show(call);
    fireEvent.click(screen.getByTestId(STOP));
    for (const listing of ['answered', 'refused', 'pending'] as const) {
      world.listing = listing;
      await event(view);
      expect(screen.getByTestId(STOP)).toBeDisabled();
      fireEvent.click(screen.getByTestId(STOP));
    }
    expect(world.stop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['has ended', { status: 'completed' as const }, 'claude'],
    ['runs on a CLI that cannot stop one agent', {}, 'codex'],
  ])('is not offered for one that %s', async (_, task, adapterId) => {
    world.tasks = [bg(task)];
    world.adapterId = adapterId;
    await show(call);
    expect(screen.queryByTestId(STOP)).toBeNull();
  });

  it('is not offered for a running call that no task reports on', async () => {
    world.running = true;
    await show({ args: ARGS });
    expect(status()).toBe('running');
    expect(screen.queryByTestId(STOP)).toBeNull();
  });
});

describe('a call outside the loaded history', () => {
  it('loads the history that holds it', async () => {
    world.hasMore = true;
    await show(null);
    expect(controller.loadEarlier).toHaveBeenCalledWith('call-1');
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sub-agent…');
  });

  it('says so when there is none', async () => {
    await show(null);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not in this transcript'));
  });

  it('says why it could not be loaded', async () => {
    world.hasMore = true;
    controller.loadEarlier.mockRejectedValue(new Error('daemon is away'));
    await show(null);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('daemon is away'));
  });
});

describe('opened from a chat in another worktree than the conversation', () => {
  const paths: string[] = [];
  let stop: () => void;
  beforeEach(() => {
    paths.length = 0;
    useActiveBasesStore.setState({ bases: { worktreePath: '/wt/column', projectPath: '/proj' }, scopeKey: null });
    stop = onSurfaceIntent((intent) => intent.type === 'open-file' && paths.push(intent.path));
  });
  afterEach(() => stop());

  it('opens its parent’s files, from its steps and from its brief', async () => {
    await show({ args: { ...ARGS, prompt: 'Read [a.ts](src/a.ts).' }, messages: [step('s-1', 't-1')] });
    fireEvent.click(screen.getByTestId('steps'));
    fireEvent.click(screen.getByRole('link', { name: 'a.ts' }));
    expect(paths).toEqual(['/wt/parent/src/step.ts', '/wt/parent/src/a.ts']);
    expect(screen.getByTestId('steps').dataset.chat).toBe('parent');
  });

  it('opens the files a side chat shares with its parent', async () => {
    registerSideChat('side-1', 'parent');
    await show({ args: ARGS, messages: [step('s-1', 't-1')] }, true, 'side-1');
    fireEvent.click(screen.getByTestId('steps'));
    expect(paths).toEqual(['/wt/parent/src/step.ts']);
  });
});

it('opens the final failure in the workspace sub-agent transcript', async () => {
  world.call = {
    args: ARGS,
    result: 'Done',
    messages: [user('Review'), turnAssistant([bash('first', 'ls', failed), bash('last', 'pwd', failed)])],
  };
  render(
    <TurnFixture rootId="workspace-fixture" messages={[]}>
      {body()}
    </TurnFixture>,
  );
  await act(async () => undefined);
  expect(screen.getByTestId('chat-row-first-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByTestId('chat-row-last-toggle')).toHaveAttribute('aria-expanded', 'true');
});

it('offers Retry after eviction and chat-tab close while saved steps remain mounted', async () => {
  controller.subagentHistory.page.mockResolvedValue({
    hasMore: false,
    updates: [
      { sessionUpdate: 'agent_message', messageId: 'nested-step', content: [{ type: 'text', text: 'Saved step' }] },
    ],
  });
  const props = { chatId: 'parent', messageId: 'm-1', toolCallId: 'nested', outcome: 'done' as const, messages: [] };
  const view = render(
    <TooltipProvider>
      <HistoricalAgentSteps {...props} />
      <SubagentTabBody {...props} title="Saved nested agent" active savedNestedAgent />
    </TooltipProvider>,
  );
  const key = historyKey('parent', 'nested');
  await waitFor(() => expect(useSubagentHistoryStore.getState().entries.get(key)?.loading).toBe(false));
  expect(controller.subagentHistory.page).toHaveBeenCalledExactlyOnceWith('nested', undefined);
  expect(screen.getAllByTestId('steps').map((steps) => steps.textContent)).toEqual(['nested-step', 'nested-step']);
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

  await act(async () => {
    for (let index = 0; index < 64; index++) {
      await loadSubagentPage(historyKey('other', String(index)), async () => ({ hasMore: false, updates: [] }));
    }
  });
  expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());

  view.rerender(<HistoricalAgentSteps {...props} />);
  const original = useLayoutStore.getState();
  try {
    act(() => {
      original.addRunTab({ id: 'chat-parent', kind: 'chat', chatId: 'parent', title: 'Parent' });
      const layout = useLayoutStore.getState();
      const pane = layout.run!.panes.find(({ tabs }) => tabs.some(({ id }) => id === 'chat-parent'))!;
      layout.closeRunTab(pane.id, 'chat-parent');
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  } finally {
    useLayoutStore.setState(original);
    useSubagentHistoryStore.setState({ entries: new Map() });
  }
});
