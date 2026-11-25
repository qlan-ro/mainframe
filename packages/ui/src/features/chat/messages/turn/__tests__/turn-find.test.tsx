/** Find reaches what the transcript folds or draws elsewhere. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { DaemonFind } from '../../../find/DaemonFind';
import { FindBar } from '../../../find/FindBar';
import { useFindInChatStore } from '../../../find/find-in-chat-store';
import { TurnFixture, assistant, bash, system, text, tool, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));
// The task's own chat has no daemon here; its row and its Result are the real ones.
vi.mock('../../../orchestration/TaskChatSteps', async () => {
  const { AgentSteps } = await import('../AgentSteps');
  return {
    TaskChatSteps: ({ chatId, ...props }: Record<string, unknown> & { chatId: string }) => (
      <AgentSteps {...(props as unknown as Parameters<typeof AgentSteps>[0])} chatId={chatId} messages={[]} />
    ),
  };
});

let roots = 0;
beforeEach(() => {
  roots++;
  useUiPrefs.setState({ finishedWork: 'fold' });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => act(() => useFindInChatStore.getState().close()));

/** Opens Find on a query whose one match the daemon places in `containerId`, and steps to it. */
async function find(messages: readonly ThreadMessage[], query: string, match: { containerId: string; itemId: string }) {
  useFindInChatStore.getState().open();
  useFindInChatStore.getState().setQuery(query);
  const loadEarlier = vi.fn().mockResolvedValue(true);
  const searchHistory = vi.fn().mockResolvedValue({ total: 1, matches: [{ ...match, occurrence: 0 }] });
  const extras = buildChatExtras(
    { canSearchHistory: true, searchHistory, loadEarlier } as unknown as AcpChatController,
    31415,
    createChatThreadState('chat-fixture'),
  );
  render(
    <div data-mf-chat-thread data-mf-chat-id="chat-fixture">
      <TurnFixture rootId={`find-${roots}`} messages={messages} extras={extras}>
        <FindBar />
        <DaemonFind />
      </TurnFixture>
    </div>,
  );
  await waitFor(() => expect(useFindInChatStore.getState().serverTotal).toBe(1));
  return {
    step: () => fireEvent.click(screen.getByTestId('thread-find-next')),
    loadEarlier,
  };
}
const toggle = () => screen.getByTestId(/^chat-work-toggle-/);

it('opens a folded turn on the step that matches', async () => {
  const messages = [user('Hi'), assistant([text('Hidden work'), bash('b', 'ls'), text('Done')], 'work')];
  const { step, loadEarlier } = await find(messages, 'Hidden work', { containerId: 'work', itemId: 'work-item' });
  expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Hidden work')).toBeNull();
  step();
  expect(await screen.findByText('Hidden work')).toBeVisible();
  await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'));
  expect(loadEarlier).toHaveBeenCalledWith('work-item');
});

const card = (taskId: string, toolCallId: string) =>
  tool({
    toolCallId,
    toolName: 'mcp__mainframe__delegate_task',
    args: { task: `Review ${taskId}` },
    result: JSON.stringify({ taskId, childChatId: `kid-${taskId}`, status: 'running' }),
  });
const came = (taskId: string, body: string) =>
  `<mainframe-task-result task="${taskId}" chat="kid-${taskId}" status="completed">\n${body}\n</mainframe-task-result>`;

it('shows a match in a delivered result in its task’s row', async () => {
  const messages = [
    user('Hi'),
    assistant([card('one', 'call-one'), card('two', 'call-two'), text('Started')], 'a1'),
    user(`${came('one', 'All quiet')}\n${came('two', 'Needle found')}`, 'results'),
    assistant([text('Both are back')], 'a2'),
  ];
  const { step } = await find(messages, 'needle', { containerId: 'results', itemId: 'results' });
  expect(screen.queryByText('Needle found')).toBeNull();
  step();
  expect(await screen.findByText('Needle found')).toBeVisible();
  const row = document.querySelector<HTMLElement>('[data-activity-id="call-two"]')!;
  expect(row).toHaveAttribute('data-activity-flash');
  // Of the two results in the message, only the one that matches is opened and marked.
  expect(row.style.outline).not.toBe('');
  expect(screen.queryByText('All quiet')).toBeNull();
  await waitFor(() => expect(useFindInChatStore.getState().loading).toBe(false));
  expect(useFindInChatStore.getState().error).toBeNull();
  // It stays on the row: the message itself draws nothing to go to.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const absorbed = screen.getByTestId('chat-absorbed-message');
  const shown = vi.mocked(Element.prototype.scrollIntoView).mock.instances as unknown as Element[];
  expect(shown.some((element) => element === absorbed || element.contains(absorbed))).toBe(false);
  expect(toggle()).toHaveAttribute('aria-expanded', 'true');
});

it('shows a match in a skill’s text in its marker', async () => {
  const messages = [
    user('Hi'),
    assistant([tool({ toolCallId: 'sk', toolName: 'Skill', args: { skill: 'design' }, result: 'ok' })], 'a1'),
    system('loaded', { skillLoaded: { skillName: 'design', path: '/s', content: 'Needle rule' } }),
    assistant([text('Done')], 'a2'),
  ];
  const { step } = await find(messages, 'needle', { containerId: 'loaded', itemId: 'loaded' });
  step();
  expect(await screen.findByTestId('chat-skill-content')).toHaveTextContent('Needle rule');
});
