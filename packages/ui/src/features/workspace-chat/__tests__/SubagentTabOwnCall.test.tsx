/**
 * SubagentTabBody reads its own call (todo #460, #451): below the parent's history floor it asks
 * `history_around` for that one item, never pages the parent, and keeps the snapshot current.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { HistoryAroundResult, SessionUpdate } from '@qlan-ro/mainframe-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const { controller, world } = vi.hoisted(() => ({
  controller: {
    load: vi.fn(async () => undefined),
    loadEarlier: vi.fn(async () => true),
    historyGeneration: 0,
    subagentHistory: { page: vi.fn(async () => ({ hasMore: false, updates: [] })), around: vi.fn() },
    isHistoryContext: vi.fn(() => false),
    subscribeLive: vi.fn(() => vi.fn()),
    holdActive: vi.fn(() => vi.fn()),
  },
  world: {
    state: {} as Record<string, unknown>,
    live: [] as unknown[],
  },
}));

vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  useAuiState: (select: (s: unknown) => unknown) =>
    select({ thread: {}, threads: { threadItems: [{ id: 'parent', custom: {} }] } }),
}));
vi.mock('@/features/sessions/use-projects', () => ({ useProjects: () => ({ projects: [] }) }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
  useKnownDaemonPort: () => 31415,
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => controller },
}));
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: async () => [], stopBackgroundTask: vi.fn() }));
vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  useControllerState: () => world.state,
  CHAT_ATTACHMENT_ADAPTER: {},
}));
vi.mock('@/features/chat/runtime/use-native-thread-messages', () => ({
  useNativeThreadMessages: () => world.live as ThreadMessage[],
}));
vi.mock('@/features/chat/messages/turn/AgentSteps', () => ({
  AgentSteps: ({ messages }: { messages: readonly ThreadMessage[] }) => (
    <div data-testid="steps">
      {messages
        .flatMap((step) => step.content as readonly { type: string; toolCallId?: string }[])
        .flatMap((part) => (part.type === 'tool-call' ? [part.toolCallId] : []))
        .join(',')}
    </div>
  ),
}));
vi.mock('@/features/chat/messages/turn/HistoricalAgentSteps', () => ({
  HistoricalAgentSteps: () => <div data-testid="steps">history</div>,
}));

import { SubagentTabBody } from '../SubagentTabBody';

const STATUS = 'workspace-agent-status-call-1';
const status = () => screen.queryByTestId(STATUS)?.textContent ?? null;

function state(over: Record<string, unknown> = {}) {
  return {
    loadState: { type: 'ready' },
    runState: { type: 'idle' },
    historyWindow: { hasMore: true, floorItemId: 'floor' },
    run: null,
    compacting: false,
    interactions: { permissions: {} },
    backgroundTasks: undefined,
    chatConfig: { adapterId: 'claude' },
    ...over,
  };
}

const META = '_mainframe.dev';
interface Shape {
  done?: boolean;
  /** The steps under the call, as the daemon returns them with `includeDescendants`. */
  steps?: string[];
  facts?: boolean;
  title?: string;
  /** The daemon cut the oldest steps short. */
  more?: boolean;
  /** When the call's message was made. */
  at?: string;
}
function around({
  done = false,
  steps = ['s1', 's2'],
  facts = false,
  title = 'Agent',
  more = false,
  at,
}: Shape = {}): HistoryAroundResult {
  const subagentFacts = facts
    ? { 'call-1': { status: 'completed', summary: 'Found two races.', nativeAgentId: 'a1', title: 'Review the diff' } }
    : undefined;
  const call = {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'item-1',
    title,
    status: done ? 'completed' : 'in_progress',
    rawInput: { description: 'Review the diff', prompt: 'Look for **races**.', subagent_type: 'reviewer' },
    ...(done && !facts && { content: [{ type: 'content', content: { type: 'text', text: 'Found two races.' } }] }),
    _meta: {
      [META]: {
        created: true,
        subagent: true,
        ...(at && { timestamp: at }),
        sourceToolCallId: 'call-1',
        ...(subagentFacts && { messageMeta: { subagentFacts } }),
      },
    },
  };
  const stepUpdates = steps.map((id) => ({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    title: 'Read',
    status: 'completed',
    rawInput: {},
    _meta: { [META]: { created: true, parentToolCallId: 'item-1' } },
  }));
  return {
    updates: [call, ...stepUpdates] as unknown as SessionUpdate[],
    hasBefore: true,
    hasAfter: true,
    targetItemId: 'item-1',
    ...(more && { hasMoreDescendants: true }),
  };
}

const tab = (active = true) => (
  <TooltipProvider>
    <SubagentTabBody chatId="parent" toolCallId="call-1" title="reviewer" active={active} />
  </TooltipProvider>
);

async function settle() {
  await act(async () => undefined);
}

beforeEach(() => {
  world.state = state();
  world.live = [];
  controller.historyGeneration = 0;
  controller.loadEarlier.mockClear();
  controller.isHistoryContext.mockReturnValue(false);
  controller.subagentHistory.around.mockReset().mockResolvedValue(around({ done: false }));
});

describe('a call below the history floor', () => {
  it('shows the brief and status from its own item, and pages nothing in the parent', async () => {
    world.state = state({ runState: { type: 'running' } });
    render(tab());
    await settle();
    expect(controller.subagentHistory.around).toHaveBeenCalledTimes(1);
    expect(controller.subagentHistory.around).toHaveBeenCalledWith('call-1');
    expect(controller.loadEarlier).not.toHaveBeenCalled();
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toHaveTextContent('Look for races.');
    expect(screen.getByTestId('workspace-agent-header-call-1')).toHaveTextContent('Review the diff');
    // An earlier turn's copy: a running turn after it does not make it running.
    expect(status()).not.toBe('running');
  });

  it('reads a finished agent from its facts: status, title, summary and its saved steps', async () => {
    controller.subagentHistory.around.mockResolvedValue(around({ done: true, facts: true }));
    render(tab());
    await settle();
    expect(controller.loadEarlier).not.toHaveBeenCalled();
    expect(status()).toBeNull();
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Found two races.');
    expect(screen.getByTestId('steps')).toHaveTextContent('history');
  });

  it.each([
    ['the turn ends', () => (world.state = state({ runState: { type: 'running' } })), () => (world.state = state())],
    ['compaction ends', () => (world.state = state({ compacting: true })), () => (world.state = state())],
    [
      'the transcript is reloaded',
      () => undefined,
      () => {
        controller.historyGeneration += 1;
        world.state = state();
      },
    ],
  ])('moves from running to finished when %s', async (_name, before, after) => {
    before();
    const view = render(tab());
    await settle();
    expect(screen.queryByTestId('workspace-agent-result-call-1')).toBeNull();
    controller.subagentHistory.around.mockResolvedValue(around({ done: true, facts: true }));
    after();
    view.rerender(tab());
    await settle();
    expect(controller.subagentHistory.around).toHaveBeenCalledTimes(2);
    expect(status()).toBeNull();
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Found two races.');
    expect(controller.loadEarlier).not.toHaveBeenCalled();
  });

  it('is fetched again when its tab comes to the front, and not for an unrelated render', async () => {
    const view = render(tab(false));
    await settle();
    view.rerender(tab(false));
    await settle();
    expect(controller.subagentHistory.around).toHaveBeenCalledTimes(1);
    controller.subagentHistory.around.mockResolvedValue(around({ done: true, facts: true }));
    view.rerender(tab(true));
    await settle();
    expect(controller.subagentHistory.around).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Found two races.');
  });

  it('keeps what it shows when a refresh fails', async () => {
    const view = render(tab());
    await settle();
    controller.subagentHistory.around.mockRejectedValue(new Error('daemon is away'));
    world.state = state({ runState: { type: 'running' } });
    view.rerender(tab());
    world.state = state();
    view.rerender(tab());
    await settle();
    expect(controller.subagentHistory.around).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toBeVisible();
    expect(screen.getByTestId('steps')).toHaveTextContent('s1,s2');
  });

  it('says so when the daemon has no such call, and when it cannot answer', async () => {
    controller.subagentHistory.around.mockResolvedValue({ hasBefore: false, hasAfter: false, stale: true });
    const view = render(tab());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not in this transcript'));
    view.unmount();
    controller.subagentHistory.around.mockRejectedValue(new Error('daemon is away'));
    render(tab());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('daemon is away'));
    expect(controller.loadEarlier).not.toHaveBeenCalled();
  });
});

describe('a call in the live window', () => {
  it('is read from the stream, with no fetch at all', async () => {
    world.live = [
      {
        id: 'm-1',
        role: 'assistant',
        status: { type: 'complete', reason: 'stop' },
        metadata: { custom: {} },
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', args: { prompt: 'Live brief.' } }],
      },
    ];
    render(tab());
    await settle();
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toHaveTextContent('Live brief.');
    expect(controller.subagentHistory.around).not.toHaveBeenCalled();
    expect(controller.loadEarlier).not.toHaveBeenCalled();
  });
});

describe('a daemon that cannot answer history_around', () => {
  it('pages the parent back to the call, as before', async () => {
    controller.subagentHistory.around.mockResolvedValue(null);
    render(tab());
    await settle();
    expect(controller.loadEarlier).toHaveBeenCalledWith('call-1');
  });
});

const permission = (toolUseId: string) => ({ r: { request: { toolUseId } } });
const steps = () => screen.getByTestId('steps').textContent;

describe('the steps under the call, which the window never holds', () => {
  it('shows a running Claude agent’s steps, and that one of them needs you', async () => {
    world.state = state({ runState: { type: 'running' }, interactions: { permissions: permission('s2') } });
    render(tab());
    await settle();
    expect(steps()).toBe('s1,s2');
    expect(status()).toBe('needs you');
    expect(controller.subagentHistory.around).toHaveBeenCalledWith('call-1');
  });

  it('shows the steps of an agent that finished after the chat loaded and has no facts', async () => {
    controller.subagentHistory.around.mockResolvedValue(around({ done: true }));
    render(tab());
    await settle();
    expect(steps()).toBe('s1,s2');
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Found two races.');
  });

  it('shows a Codex agent’s steps', async () => {
    controller.subagentHistory.around.mockResolvedValue(around({ done: true, title: 'CollabAgent', steps: ['c1'] }));
    render(tab());
    await settle();
    expect(screen.getByTestId('workspace-agent-header-call-1')).toHaveTextContent('Sub-agent · Codex agent');
    expect(steps()).toBe('c1');
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Found two races.');
  });

  it('keeps a finished agent with facts on its own pages', async () => {
    controller.subagentHistory.around.mockResolvedValue(around({ done: true, facts: true }));
    render(tab());
    await settle();
    expect(steps()).toBe('history');
  });
});

describe('a call that is a context item in the live window', () => {
  const live = (over: { result?: string; steps: string[] }) => [
    {
      id: 'm-1',
      role: 'assistant',
      status: { type: 'complete', reason: 'stop' },
      metadata: { custom: {} },
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'Task',
          args: { prompt: 'Look for **races**.' },
          ...(over.result && { result: over.result }),
          messages: [
            {
              id: 'item-1:transcript',
              role: 'assistant',
              metadata: { custom: { mainframe: { partKeys: over.steps.map((id) => `${id}#call`) } } },
              content: over.steps.map((id) => ({ type: 'tool-call', toolCallId: id, toolName: 'Read', args: {} })),
            },
          ],
        },
      ],
    },
  ];

  it('is read from the stream, which finishes it mid-turn, with the steps above the floor added', async () => {
    controller.isHistoryContext.mockReturnValue(true);
    world.state = state({ runState: { type: 'running' } });
    world.live = live({ steps: ['s2', 's3'] });
    const view = render(tab());
    await settle();
    expect(screen.queryByTestId('workspace-agent-result-call-1')).toBeNull();
    expect(status()).toBe('running');
    expect(steps()).toBe('s1,s2,s3');

    world.live = live({ steps: ['s2', 's3', 's4'], result: 'Found two races.' });
    view.rerender(tab());
    await settle();
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Found two races.');
    expect(status()).toBeNull();
    expect(steps()).toBe('s1,s2,s3,s4');
    expect(controller.loadEarlier).not.toHaveBeenCalled();
  });

  it('is never replaced by an older fetched copy of the call', async () => {
    controller.isHistoryContext.mockReturnValue(true);
    world.live = live({ steps: ['s3'], result: 'Live result.' });
    render(tab());
    await settle();
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Live result.');
  });
});

describe('before the parent has loaded', () => {
  it('asks nothing until it is known whether the call is in the window', async () => {
    world.state = state({ loadState: { type: 'loading' } });
    const view = render(tab());
    await settle();
    expect(controller.subagentHistory.around).not.toHaveBeenCalled();
    expect(controller.loadEarlier).not.toHaveBeenCalled();
    world.state = state();
    view.rerender(tab());
    await settle();
    expect(controller.subagentHistory.around).toHaveBeenCalledTimes(1);
  });

  it('does not ask at all when the window turns out to hold the call', async () => {
    world.state = state({ loadState: { type: 'loading' } });
    const view = render(tab());
    await settle();
    world.state = state();
    world.live = [
      {
        id: 'm-1',
        role: 'assistant',
        status: { type: 'complete', reason: 'stop' },
        metadata: { custom: {} },
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', args: { prompt: 'Live.' } }],
      },
    ];
    view.rerender(tab());
    await settle();
    expect(controller.subagentHistory.around).not.toHaveBeenCalled();
  });
});

describe('a call that left the window, or sits outside it', () => {
  it('keeps the last live copy while the fetch is on its way', async () => {
    let resolve!: (value: HistoryAroundResult) => void;
    controller.subagentHistory.around.mockReturnValue(new Promise<HistoryAroundResult>((r) => (resolve = r)));
    world.live = [
      {
        id: 'm-1',
        role: 'assistant',
        status: { type: 'complete', reason: 'stop' },
        metadata: { custom: {} },
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', args: { prompt: 'Live brief.' } }],
      },
    ];
    const view = render(tab());
    await settle();
    world.live = [];
    view.rerender(tab());
    await settle();
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toHaveTextContent('Live brief.');
    expect(screen.queryByText('Loading the sub-agent…')).toBeNull();
    await act(async () => resolve(around({ done: true })));
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toHaveTextContent('Look for races.');
  });

  it('is not running because an unrelated later turn is', async () => {
    world.live = [{ id: 'u-late', role: 'user', content: [], metadata: { custom: {} } }];
    world.state = state({ runState: { type: 'running' }, run: { after: 'u-late' } });
    render(tab());
    await settle();
    expect(status()).not.toBe('running');
  });
});

describe('steps over the daemon’s cap', () => {
  it('says the earliest steps are left out of a running agent’s copy', async () => {
    controller.subagentHistory.around.mockResolvedValue(around({ more: true }));
    render(tab());
    await settle();
    expect(screen.getByTestId('workspace-agent-steps-omitted-call-1')).toHaveTextContent(
      'Earlier steps are not shown.',
    );
    expect(steps()).toBe('s1,s2');
  });

  it('says nothing when the copy is whole, or when the saved steps are paged in', async () => {
    controller.subagentHistory.around.mockResolvedValue(around());
    const view = render(tab());
    await settle();
    expect(screen.queryByTestId('workspace-agent-steps-omitted-call-1')).toBeNull();
    view.unmount();
    controller.subagentHistory.around.mockResolvedValue(around({ done: true, facts: true, more: true }));
    render(tab());
    await settle();
    expect(screen.queryByTestId('workspace-agent-steps-omitted-call-1')).toBeNull();
    expect(steps()).toBe('history');
  });
});

describe('a daemon without history_around, once the call leaves the window', () => {
  it('pages the parent back to it again', async () => {
    controller.subagentHistory.around.mockResolvedValue(null);
    world.live = [
      {
        id: 'm-1',
        role: 'assistant',
        status: { type: 'complete', reason: 'stop' },
        metadata: { custom: {} },
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', args: { prompt: 'Live.' } }],
      },
    ];
    const view = render(tab());
    await settle();
    expect(controller.loadEarlier).not.toHaveBeenCalled();
    world.live = [];
    view.rerender(tab());
    await settle();
    expect(controller.loadEarlier).toHaveBeenCalledWith('call-1');
  });
});

describe('a copy outside the window and the run in progress', () => {
  const started = Date.parse('2026-01-01T00:00:10Z');
  const running = (run: object | null) =>
    (world.state = state({ runState: { type: 'running', startedAtMs: started }, run }));

  it('is running when the whole chat is the run', async () => {
    running({ after: null, confirmed: true });
    render(tab());
    await settle();
    expect(status()).toBe('running');
  });

  it('is not running when the run began after a message the window holds', async () => {
    world.live = [{ id: 'u-late', role: 'user', content: [], metadata: { custom: {} } }];
    running({ after: 'u-late', confirmed: true });
    // Dated after the turn's start, so only the window check can say "not running".
    controller.subagentHistory.around.mockResolvedValue(around({ at: '2026-01-01T00:00:12Z' }));
    render(tab());
    await settle();
    expect(status()).not.toBe('running');
  });

  it('is told by its own time against the turn’s start when the run cannot be placed', async () => {
    running({ after: 'gone', confirmed: true });
    controller.subagentHistory.around.mockResolvedValue(around({ at: '2026-01-01T00:00:12Z' }));
    const view = render(tab());
    await settle();
    expect(status()).toBe('running');
    view.unmount();
    controller.subagentHistory.around.mockResolvedValue(around({ at: '2026-01-01T00:00:03Z' }));
    render(tab());
    await settle();
    expect(status()).not.toBe('running');
  });

  it('is not running when either time is unknown', async () => {
    running(null);
    render(tab());
    await settle();
    expect(status()).not.toBe('running');
  });
});
