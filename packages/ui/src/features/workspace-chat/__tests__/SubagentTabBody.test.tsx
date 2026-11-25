/**
 * SubagentTabBody — a sub-agent in a workspace tab (W8): title, kind, status,
 * Stop while live, brief, steps and result, read from the parent's transcript.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
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
  providerMetadata?: { mainframe: { acpStatus: string } };
}

const { controller, world } = vi.hoisted(() => ({
  controller: {
    load: vi.fn(async () => undefined),
    loadEarlier: vi.fn(async () => true),
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
    /** The turn the call was made in, as its part's own source says. */
    turn: undefined as string | undefined,
    hasMore: false,
    adapterId: 'claude',
    /** What follows the call in the parent's transcript. */
    after: [] as Partial<ThreadMessage>[],
    /** A new object per background event, as the reducer's. */
    backgroundTasks: undefined as object | undefined,
    list: vi.fn(),
    stop: vi.fn(async () => undefined),
  },
}));

vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  // The chat column's thread, which is another chat's.
  useAuiState: (select: (s: unknown) => unknown) =>
    select({
      thread: {},
      threads: {
        threadItems: [
          { id: 'column', custom: { projectId: 'p1', worktreePath: '/wt/column' } },
          { id: 'parent', custom: { projectId: 'p1', worktreePath: '/wt/parent' } },
        ],
      },
    }),
}));
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'p1', path: '/proj' }] }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
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
    interactions: { permissions: world.permissions },
    backgroundTasks: world.backgroundTasks,
    chatConfig: { adapterId: world.adapterId },
  }),
  CHAT_ATTACHMENT_ADAPTER: {},
}));
vi.mock('@/features/chat/runtime/use-native-thread-messages', () => ({
  useNativeThreadMessages: () => messages(),
}));
vi.mock('@/features/chat/tools/cards/SubagentTranscript', () => ({
  SubagentTranscript: ({ messages: steps }: { messages: readonly ThreadMessage[] }) => {
    const { openFile } = useOpenFile();
    return (
      <button type="button" data-testid="steps" data-chat={useChatId()} onClick={() => openFile('src/step.ts')}>
        {steps.map((step) => step.id).join(',')}
      </button>
    );
  },
}));

/** Where a part came from: a Codex turn of the parent, or of a sub-agent's own thread. */
const source = (thread: string, turn: string, state: string, parentToolUseId?: string) => ({
  sourceMessageId: `${thread}-${turn}`,
  sourceBlockIndex: 0,
  presentation: {
    version: 1,
    provider: 'codex',
    turnId: JSON.stringify([thread, turn]),
    state,
    phase: parentToolUseId ? 'final_answer' : undefined,
    finalEligible: Boolean(parentToolUseId),
    parentToolUseId,
  },
});
const sourced = (...sources: object[]) => ({
  custom: { mainframe: { partSources: Object.fromEntries(sources.map((entry, i) => [i, [entry]])) } },
});

let cached: { call: Call | null; after: unknown; list: ThreadMessage[] } = { call: null, after: null, list: [] };
/** Identity-stable per call, like the projector. */
function messages(): ThreadMessage[] {
  if (cached.call !== world.call || cached.after !== world.after) {
    const part = world.call && { type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', ...world.call };
    cached = {
      call: world.call,
      after: world.after,
      list: part
        ? ([
            {
              id: 'm-1',
              role: 'assistant',
              content: [part],
              metadata: world.turn ? sourced(source('parent', 'p-1', world.turn)) : undefined,
            },
            ...world.after,
          ] as unknown as ThreadMessage[])
        : [],
    };
  }
  return cached.list;
}

import { registerSideChat, __resetSideChatRegistryForTests } from '@/features/side-chat/side-chat-ids';
import { useChatId, useOpenFile } from '@/features/chat/tools/chat-tool-context';
import { useMountedConversations } from '../mounted-conversations';
import { SubagentTabBody } from '../SubagentTabBody';

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
const status = () => screen.getByTestId('workspace-agent-status-call-1').dataset.status;
const step = (id: string, toolCallId: string) =>
  ({
    id,
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName: 'Bash' }],
  }) as unknown as ThreadMessage;

beforeEach(() => {
  Object.assign(world, {
    call: null,
    running: false,
    runState: undefined,
    permissions: {},
    tasks: [],
    listing: 'answered',
    turn: undefined,
    hasMore: false,
    adapterId: 'claude',
    after: [],
    backgroundTasks: undefined,
  });
  world.stop.mockClear();
  world.list.mockClear();
  __resetSideChatRegistryForTests();
  controller.loadEarlier.mockClear().mockResolvedValue(true);
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
    ['no-result', { args: ARGS }, false],
    ['completed', { args: ARGS, result: 'ok' }, false],
    ['failed', { args: ARGS, result: 'boom', isError: true }, false],
  ] as const)('is %s', async (expected, call, running) => {
    world.running = running;
    await show(call);
    expect(status()).toBe(expected);
  });

  const said = (custom: object = {}) =>
    ({
      id: 'm-2',
      role: 'user',
      content: [{ type: 'text', text: 'next' }],
      metadata: { custom },
    }) as unknown as ThreadMessage;

  const later: [string, Partial<ThreadMessage>[]][] = [
    ['right after it', [said()]],
    ['after more work', [{ id: 'a', role: 'assistant', content: [] }, said()]],
  ];

  it.each(later)('says only that there is no result when the user spoke %s', async (_, after) => {
    world.running = true;
    world.after = after;
    await show({ args: ARGS });
    expect(status()).toBe('no-result');
    expect(screen.getByTestId('workspace-agent-status-call-1')).toHaveTextContent('no result');
  });

  it.each(later)('is running while its task is, though the user spoke %s', async (_, after) => {
    world.running = true;
    world.after = after;
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'running' }];
    await show({ args: ARGS, toolName: 'CollabAgent' });
    expect(status()).toBe('running');
  });

  it('shows no result when an idle call has no cancellation evidence', async () => {
    world.after = [said()];
    await show({ args: ARGS });
    expect(status()).toBe('no-result');
  });

  it.each([
    ['queued', { mainframe: { queued: true } }],
    ['on its way', { mainframe: { pending: true } }],
  ])('stays running while a message is %s behind it', async (_, custom) => {
    world.running = true;
    world.after = [said(custom)];
    await show({ args: ARGS });
    expect(status()).toBe('running');
  });

  it('stays running until a cancelled turn has ended', async () => {
    world.runState = 'cancelling';
    await show({ args: ARGS });
    expect(status()).toBe('running');
  });

  it('stays running while another call waits for an answer', async () => {
    world.running = true;
    world.permissions = { req: { request: { toolUseId: 'elsewhere' } } };
    await show({ args: ARGS });
    expect(status()).toBe('running');
  });

  it('takes the daemon’s word that the call was cancelled', async () => {
    world.running = true;
    await show({ args: ARGS, providerMetadata: { mainframe: { acpStatus: 'cancelled' } } });
    expect(status()).toBe('stopped');
  });

  it('needs you while one of its own calls waits for an answer', async () => {
    world.permissions = { req: { request: { toolUseId: 't-2' } } };
    await show({ args: ARGS, messages: [step('s-1', 't-1'), step('s-2', 't-2')] });
    expect(status()).toBe('needs-you');
  });

  it('follows the background task, not the launch receipt', async () => {
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'running', summary: null }];
    await show({ args: ARGS, result: 'Async agent launched' });
    expect(status()).toBe('running');
    expect(screen.queryByTestId('workspace-agent-result-call-1')).toBeNull();
  });

  const ended = { id: 'bg-1', toolUseId: 'call-1', status: 'completed' as const, startedAt: 1, summary: '' };
  const going = { id: 'bg-2', toolUseId: 'call-1', status: 'running' as const, startedAt: 2 };

  it.each([
    ['', [ended, going]],
    [', listed first', [going, ended]],
  ])('follows the task still running, for an agent talked to again%s', async (_, tasks) => {
    world.tasks = tasks;
    await show({ args: ARGS, toolName: 'CollabAgent', result: 'First answer.' });
    expect(status()).toBe('running');
  });

  it.each([
    ['stopped', 'completed', 'stopped'],
    ['completed', 'stopped', 'stopped'],
    ['stopped', 'failed', 'failed'],
    ['completed', 'completed', 'completed'],
  ] as const)('is as bad as the worst of its tasks once all have ended: %s and %s', async (first, second, worst) => {
    world.tasks = [
      { ...ended, status: first },
      { ...ended, id: 'bg-2', startedAt: 2, status: second },
    ];
    await show({ args: ARGS, result: RECEIPT });
    expect(status()).toBe(worst);
  });

  it('reads a Codex agent’s end from its result, which its task has no word of', async () => {
    world.tasks = [ended];
    await show({ args: ARGS, toolName: 'CollabAgent', result: 'Sub-agent interrupted', isError: true });
    expect(status()).toBe('failed');
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Sub-agent interrupted');
  });

  it('says only that there is no result for a Codex agent that was closed', async () => {
    world.running = true;
    world.tasks = [ended];
    await show({ args: ARGS, toolName: 'CollabAgent' });
    expect(status()).toBe('no-result');
  });

  it('takes no word from another call’s task', async () => {
    world.tasks = [{ ...going, toolUseId: 'call-2' }];
    await show({ args: ARGS, result: 'No races found.' });
    expect(status()).toBe('completed');
  });

  it('shows a finished background task’s own summary as the result', async () => {
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'completed', summary: 'Two races.' }];
    await show({ args: ARGS, result: 'Async agent launched' });
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Two races.');
  });
});

describe('an agent in the background, whose result is only the launch receipt', () => {
  const flagged = { args: { ...ARGS, run_in_background: true }, result: 'Launched.' };

  it.each([['flagged', flagged]])('has no result and no receipt when no task is listed for it: %s', async (_, call) => {
    await show(call);
    expect(status()).toBe('no-result');
    expect(screen.queryByTestId(RESULT)).toBeNull();
  });

  it.each([RECEIPT, 'Spawned successfully. The deployment is healthy.', 'Launch wording changed.'])(
    'shows unclassified text without claiming an outcome: %s',
    async (result) => {
      await show({ args: { ...ARGS, run_in_background: undefined }, result });
      expect(screen.queryByTestId(STATUS)).toBeNull();
      expect(screen.getByTestId(RESULT)).toHaveTextContent(result.replace('\n', ' '));
    },
  );

  it.each(['pending', 'refused'] as const)('claims nothing while the list is %s', async (listing) => {
    world.listing = listing;
    await show(flagged);
    expect(screen.queryByTestId(STATUS)).toBeNull();
    expect(screen.queryByTestId(RESULT)).toBeNull();
  });

  it.each(['pending', 'refused'] as const)('is not called stopped while the list is %s', async (listing) => {
    world.listing = listing;
    await show({ args: flagged.args });
    expect(screen.queryByTestId(STATUS)).toBeNull();
  });

  it('is not called stopped by a turn that ended without it', async () => {
    await show({ args: flagged.args });
    expect(status()).toBe('no-result');
  });

  it('says why it could not be launched', async () => {
    world.listing = 'refused';
    await show({ ...flagged, result: 'No such agent type', isError: true });
    expect(status()).toBe('failed');
    expect(screen.getByTestId(RESULT)).toHaveTextContent('No such agent type');
  });

  it('withdraws running and Stop when the next request fails', async () => {
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'running', startedAt: 1 }];
    const view = await show(flagged);
    world.listing = 'refused';
    world.backgroundTasks = {};
    view.rerender(body());
    await act(async () => undefined);
    expect(screen.queryByTestId(STATUS)).toBeNull();
    expect(screen.queryByTestId('workspace-agent-stop-call-1')).toBeNull();
  });

  it('withdraws running and Stop until a reconnect refresh succeeds', async () => {
    const at = (state: 'connected' | 'reconnecting') => (
      <ConnectionStatusProvider value={{ state, daemonStatus: '' } as never}>{body()}</ConnectionStatusProvider>
    );
    world.call = flagged;
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'running' }];
    const view = render(at('connected'));
    await act(async () => undefined);
    expect(status()).toBe('running');
    view.rerender(at('reconnecting'));
    expect(screen.queryByTestId(STATUS)).toBeNull();
    expect(screen.queryByTestId('workspace-agent-stop-call-1')).toBeNull();
    world.listing = 'pending';
    view.rerender(at('connected'));
    expect(screen.queryByTestId(STATUS)).toBeNull();
    expect(screen.queryByTestId('workspace-agent-stop-call-1')).toBeNull();
    world.listing = 'answered';
    world.backgroundTasks = {};
    view.rerender(at('connected'));
    await act(async () => undefined);
    expect(status()).toBe('running');
    expect(screen.getByTestId('workspace-agent-stop-call-1')).toBeVisible();
  });

  it('is asked about again on reconnecting', async () => {
    const at = (state: 'connected' | 'reconnecting') => (
      <ConnectionStatusProvider value={{ state, daemonStatus: '' } as never}>{body()}</ConnectionStatusProvider>
    );
    world.call = flagged;
    world.listing = 'refused';
    const view = render(at('connected'));
    await act(async () => undefined);
    view.rerender(at('reconnecting'));
    await act(async () => undefined);
    world.listing = 'answered';
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'completed', startedAt: 1, summary: 'Two races.' }];
    view.rerender(at('connected'));
    await act(async () => undefined);
    expect(status()).toBe('completed');
    expect(screen.getByTestId(RESULT)).toHaveTextContent('Two races.');
  });

  it('leaves a foreground agent’s own result alone when the list is refused', async () => {
    world.listing = 'refused';
    await show({ args: ARGS, result: 'No races found.' });
    expect(status()).toBe('completed');
    expect(screen.getByTestId(RESULT)).toHaveTextContent('No races found.');
  });
});

describe('Codex agents sharing one call', () => {
  const task = (id: string, status: 'running' | 'completed', startedAt: number) => ({
    id,
    toolUseId: 'call-1',
    status,
    startedAt,
  });
  /** The agents' steps, one per thread, each from a turn of its own in the given state. */
  const agents = (...turns: string[]) => [
    {
      id: 'steps',
      role: 'assistant',
      content: turns.map((_, i) => ({ type: 'text', text: `step ${i}` })),
      metadata: sourced(...turns.map((state, i) => source(`agent-${i}`, 't', state, 'call-1'))),
    } as unknown as ThreadMessage,
  ];
  const codex = { args: ARGS, toolName: 'CollabAgent', result: 'Answer.' };

  it('is running while any is, though the one started last has ended', async () => {
    world.running = true;
    world.tasks = [task('a', 'running', 1), task('b', 'completed', 2)];
    await show(codex);
    expect(status()).toBe('running');
    expect(screen.getByTestId(STATUS)).toHaveTextContent(/^running$/);
  });

  it('counts those running', async () => {
    world.running = true;
    world.tasks = [task('a', 'running', 1), task('b', 'running', 2), task('c', 'completed', 3)];
    await show(codex);
    expect(status()).toBe('running');
    expect(screen.getByTestId(STATUS)).toHaveTextContent('2 running');
  });

  it.each([['failed']])('counts those that ended badly: %s', async (bad) => {
    world.tasks = [task('a', 'completed', 1), task('b', 'completed', 2)];
    await show({ ...codex, messages: agents(bad, 'completed') });
    expect(status()).toBe('failed');
    expect(screen.getByTestId(STATUS)).toHaveTextContent('1 of 2 failed');
  });

  it('is done when all are', async () => {
    await show({ ...codex, messages: agents('completed', 'completed') });
    expect(status()).toBe('completed');
  });

  it('goes by an agent’s last turn, not the one it was interrupted in', async () => {
    const [steps] = agents('cancelled', 'completed', 'completed');
    const sources = [
      source('agent-0', 't1', 'cancelled', 'call-1'),
      source('agent-0', 't2', 'completed', 'call-1'),
      source('agent-1', 't1', 'completed', 'call-1'),
    ];
    await show({ ...codex, messages: [{ ...steps, metadata: sourced(...sources) } as unknown as ThreadMessage] });
    expect(status()).toBe('completed');
  });

  it('does not call one agent’s answer the end while the list is unknown and the turn goes on', async () => {
    world.running = true;
    world.listing = 'refused';
    await show(codex);
    expect(screen.queryByTestId(STATUS)).toBeNull();
  });

  describe('when the turn that started them was cut short', () => {
    beforeEach(() => void (world.turn = 'cancelled'));

    it.each([
      ['cancelled', []],
      ['cancelled', agents('running')],
      ['cancelled', agents('unknown')],
      ['failed', agents('unknown')],
    ])('is not done just because the daemon closed it: %s', async (turn, messages) => {
      world.turn = turn;
      await show({ ...codex, result: 'Sub-agent completed', messages });
      expect(status()).toBe('no-result');
      expect(screen.queryByTestId(RESULT)).toBeNull();
    });

    it('keeps a completed child’s answer when another child was left open', async () => {
      world.tasks = [task('a', 'completed', 1), task('b', 'completed', 2)];
      await show({ ...codex, result: 'Sub-agent completed', messages: agents('completed', 'unknown') });
      expect(screen.queryByTestId(STATUS)).toBeNull();
      expect(screen.getByTestId(RESULT)).toHaveTextContent('step 0');
    });

    it('shows the known child result when another agent left no step', async () => {
      world.tasks = [task('a', 'completed', 1), task('b', 'completed', 2)];
      await show({ ...codex, messages: agents('completed') });
      expect(screen.queryByTestId(STATUS)).toBeNull();
      expect(screen.getByTestId(RESULT)).toHaveTextContent('step 0');
    });

    it('is done when its own turn completed', async () => {
      world.tasks = [task('a', 'completed', 1)];
      await show({ ...codex, messages: agents('completed') });
      expect(status()).toBe('completed');
      expect(screen.getByTestId(RESULT)).toHaveTextContent('Answer.');
    });

    it('stays failed when it failed', async () => {
      await show({ ...codex, isError: true });
      expect(status()).toBe('failed');
    });

    it('is known from the turn’s other messages, when the call’s own part says nothing', async () => {
      world.turn = undefined;
      world.after = [
        {
          id: 'm-2',
          role: 'assistant',
          content: [{ type: 'text', text: 'Waiting.' }],
          metadata: sourced(source('parent', 'p-1', 'cancelled')),
        } as unknown as ThreadMessage,
      ];
      await show(codex);
      expect(status()).toBe('no-result');
    });

    it('says nothing of the turn after it', async () => {
      world.turn = undefined;
      world.after = [
        { id: 'u', role: 'user', content: [{ type: 'text', text: 'next' }] } as unknown as ThreadMessage,
        {
          id: 'm-2',
          role: 'assistant',
          content: [{ type: 'text', text: 'Sure.' }],
          metadata: sourced(source('parent', 'p-2', 'cancelled')),
        } as unknown as ThreadMessage,
      ];
      await show(codex);
      expect(status()).toBe('completed');
    });
  });
});

describe('Stop', () => {
  it('stops a running background agent at once', async () => {
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'running' }];
    await show({ args: ARGS, result: 'Async agent launched' });
    fireEvent.click(screen.getByTestId('workspace-agent-stop-call-1'));
    expect(world.stop).toHaveBeenCalledWith('parent', 'bg-1');
  });

  it.each([
    ['has ended', { status: 'completed' as const }, 'claude'],
    ['runs on a CLI that cannot stop one agent', { status: 'running' as const }, 'codex'],
  ])('is not offered for one that %s', async (_, task, adapterId) => {
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', ...task }];
    world.adapterId = adapterId;
    await show({ args: ARGS, result: 'launched' });
    expect(screen.queryByTestId('workspace-agent-stop-call-1')).toBeNull();
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

describe('its background task', () => {
  it('is read again on every event, while the tab is in front', async () => {
    const view = await show({ args: ARGS });
    expect(world.list).toHaveBeenCalledTimes(1);
    world.backgroundTasks = {};
    view.rerender(body());
    await act(async () => undefined);
    expect(world.list).toHaveBeenCalledTimes(2);
  });

  it('is not read behind another tab, and is brought up to date in front', async () => {
    const view = await show({ args: ARGS }, false);
    world.backgroundTasks = {};
    view.rerender(body(false));
    await act(async () => undefined);
    expect(world.list).not.toHaveBeenCalled();

    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'running' }];
    view.rerender(body(true));
    await act(async () => undefined);
    expect(world.list).toHaveBeenCalledTimes(1);
    expect(status()).toBe('running');
  });
});
