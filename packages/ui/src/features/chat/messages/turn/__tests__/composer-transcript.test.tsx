import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { listBackgroundTasks, stopBackgroundTask } from '@/lib/api/background-tasks';
import { useUiPrefs } from '@/store/ui-prefs';
import { ComposerEditProvider } from '../../../composer/edit/composer-edit-context';
import { QueuedRows } from '../../../composer/queue/QueuedRows';
import { useHeldQueue } from '../../../composer/queue/held-queue-store';
import { ActivityStrip } from '../../../composer/strips/ActivityStrip';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatThreadState,
} from '../../../controller/chat-thread-state';
import { ChatGateMount } from '../../../gates/ChatGateMount';
import { assistant, bash, running, tool, user } from './fixtures';
import { RunThread, START, transcript, states } from './run-fixture';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn(),
  stopBackgroundTask: vi.fn().mockResolvedValue(undefined),
}));

function agent(id: string): BackgroundTask {
  return {
    id: `task-${id}`,
    kind: 'agent',
    toolName: 'Bash',
    toolUseId: id,
    description: id,
    command: '',
    outputPath: null,
    startedAt: Date.now(),
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
  };
}

it('keeps finished work, a pending gate, held input and two live agents distinct', async () => {
  vi.mocked(listBackgroundTasks).mockResolvedValue([agent('Review'), agent('Audit')]);
  useUiPrefs.setState({ finishedWork: 'fold', activityStripCollapsed: false });
  useHeldQueue.setState({
    byChat: { chat: [{ messageId: 'held', content: 'Run checks later', timestamp: '2026-11-24' }] },
  });
  const base = createChatThreadState('chat');
  const state = [
    transcript([user('First', 'u1'), assistant([bash('done', 'pwd')], 'a1', { presentation: { state: 'completed' } })]),
    START,
    transcript([
      user('First', 'u1'),
      assistant([bash('done', 'pwd')], 'a1', { presentation: { state: 'completed' } }),
      user('Second', 'u2'),
      assistant(
        [
          bash('guarded', 'npm test', running),
          ...['Review', 'Audit'].map((id) =>
            tool({ ...running, toolCallId: id, toolName: 'Agent', args: { description: id } }),
          ),
        ],
        'a2',
        { running: true },
      ),
    ]),
  ].reduce(reduceChatThreadState, {
    ...base,
    authoritativeItemStreaming: true,
    chatConfig: { adapterId: 'claude' } as ChatThreadState['chatConfig'],
    interactions: {
      ...base.interactions,
      permissions: {
        request: {
          requestId: 'request',
          askedAt: 1,
          request: {
            requestId: 'request',
            toolName: 'Bash',
            toolUseId: 'guarded',
            input: { command: 'npm test' },
            suggestions: [],
          },
          options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
        },
      },
    },
  });
  try {
    render(
      <RunThread state={state} rootId="composer-transcript">
        <div data-chat-footer>
          <ChatGateMount />
          <ActivityStrip />
          <ComposerEditProvider>
            <QueuedRows />
          </ComposerEditProvider>
        </div>
      </RunThread>,
    );
    expect(states()).toEqual(['finished', 'needs-you']);
    expect(screen.getByTestId('chat-thread-gate-slot')).toHaveAttribute('data-chat-gate');
    expect(screen.getAllByText('Run checks later')).toHaveLength(1);
    expect(within(screen.getByTestId('chat-composer-queue')).getByText('Run checks later')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Show 2 ongoing items' }));
    expect(screen.getAllByTestId('composer-activity-stop')).toHaveLength(2);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop Review' })));
    expect(stopBackgroundTask).toHaveBeenCalledExactlyOnceWith('chat', 'task-Review');
  } finally {
    act(() => useHeldQueue.setState({ byChat: {} }));
  }
});
