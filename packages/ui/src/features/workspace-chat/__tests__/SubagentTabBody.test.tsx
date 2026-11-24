/**
 * SubagentTabBody — a sub-agent in a workspace tab (W8): title, kind, status,
 * Stop while live, brief, steps and result, read from the parent's transcript.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

interface Call {
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  messages?: Partial<ThreadMessage>[];
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
    permissions: {} as Record<string, { request: { toolUseId: string } }>,
    tasks: [] as Partial<BackgroundTask>[],
    hasMore: false,
    adapterId: 'claude',
    stop: vi.fn(async () => undefined),
  },
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => controller },
}));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: async () => world.tasks,
  stopBackgroundTask: (chatId: string, taskId: string) => {
    (world.stop as (...args: string[]) => Promise<void>)(chatId, taskId);
    return Promise.resolve();
  },
}));
vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  useControllerState: () => ({
    loadState: { type: 'ready' },
    runState: { type: world.running ? 'running' : 'idle' },
    historyWindow: { hasMore: world.hasMore },
    interactions: { permissions: world.permissions },
    backgroundTasks: undefined,
    chatConfig: { adapterId: world.adapterId },
  }),
  CHAT_ATTACHMENT_ADAPTER: {},
}));
vi.mock('@/features/chat/runtime/use-native-thread-messages', () => ({
  useNativeThreadMessages: () => messages(),
}));
vi.mock('@/features/chat/tools/cards/SubagentTranscript', () => ({
  SubagentTranscript: ({ messages: steps }: { messages: readonly ThreadMessage[] }) => (
    <div data-testid="steps">{steps.map((step) => step.id).join(',')}</div>
  ),
}));

let cached: { call: Call | null; list: ThreadMessage[] } = { call: null, list: [] };
/** Identity-stable per call, like the projector. */
function messages(): ThreadMessage[] {
  if (cached.call !== world.call) {
    const part = world.call && { type: 'tool-call', toolCallId: 'call-1', toolName: 'Task', ...world.call };
    cached = {
      call: world.call,
      list: part ? ([{ id: 'm-1', role: 'assistant', content: [part] }] as unknown as ThreadMessage[]) : [],
    };
  }
  return cached.list;
}

import { useMountedConversations } from '../mounted-conversations';
import { SubagentTabBody } from '../SubagentTabBody';

async function show(call: Call | null) {
  world.call = call;
  const view = render(
    <TooltipProvider>
      <SubagentTabBody chatId="parent" toolCallId="call-1" messageId="m-1" title="reviewer" />
    </TooltipProvider>,
  );
  await act(async () => undefined);
  return view;
}

const ARGS = {
  subagent_type: 'code-reviewer',
  model: 'sonnet',
  description: 'Review the diff',
  prompt: 'Look for **races**.',
};
const status = () => screen.getByTestId('workspace-agent-status-call-1').dataset.status;
const step = (id: string, toolCallId: string) =>
  ({
    id,
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName: 'Bash' }],
  }) as unknown as ThreadMessage;

beforeEach(() => {
  Object.assign(world, { call: null, running: false, permissions: {}, tasks: [], hasMore: false, adapterId: 'claude' });
  world.stop.mockClear();
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
    ['stopped', { args: ARGS }, false],
    ['completed', { args: ARGS, result: 'ok' }, false],
    ['failed', { args: ARGS, result: 'boom', isError: true }, false],
  ] as const)('is %s', async (expected, call, running) => {
    world.running = running;
    await show(call);
    expect(status()).toBe(expected);
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

  it('shows a finished background task’s own summary as the result', async () => {
    world.tasks = [{ id: 'bg-1', toolUseId: 'call-1', status: 'completed', summary: 'Two races.' }];
    await show({ args: ARGS, result: 'Async agent launched' });
    expect(screen.getByTestId('workspace-agent-result-call-1')).toHaveTextContent('Two races.');
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
