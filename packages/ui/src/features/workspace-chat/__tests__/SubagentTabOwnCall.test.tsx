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
    <div data-testid="steps">{messages.length} steps</div>
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
function around(over: { done: boolean; prompt?: string }): HistoryAroundResult {
  const facts = over.done
    ? { 'call-1': { status: 'completed', summary: 'Found two races.', nativeAgentId: 'a1', title: 'Review the diff' } }
    : undefined;
  const update = {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'item-1',
    title: 'Agent',
    status: over.done ? 'completed' : 'in_progress',
    rawInput: {
      description: 'Review the diff',
      prompt: over.prompt ?? 'Look for **races**.',
      subagent_type: 'reviewer',
    },
    _meta: {
      [META]: {
        created: true,
        subagent: true,
        sourceToolCallId: 'call-1',
        ...(facts && { messageMeta: { subagentFacts: facts } }),
      },
    },
  } as unknown as SessionUpdate;
  return { updates: [update], hasBefore: true, hasAfter: true, targetItemId: 'item-1' };
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
    expect(status()).toBe('running');
  });

  it('reads a finished agent from its facts: status, title, summary and its saved steps', async () => {
    controller.subagentHistory.around.mockResolvedValue(around({ done: true }));
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
    controller.subagentHistory.around.mockResolvedValue(around({ done: true }));
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
    controller.subagentHistory.around.mockResolvedValue(around({ done: true }));
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
    expect(screen.getByTestId('workspace-agent-brief-call-1')).toBeVisible();
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
