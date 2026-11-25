/** The footer sits on the message with the answer; what it offers is the turn's (T1b). */
import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useAdaptersStore } from '@/store/adapters';
import { TurnFixture, assistant, bash, system, text, user } from './fixtures';

const { fork, session, item } = vi.hoisted(() => ({
  fork: vi.fn(),
  // One object each: a selector that returned a new one would never settle.
  session: { adapterId: 'claude', vendorSessionId: 's', isRunning: false, hasPending: false },
  item: { id: 'chat', remoteId: 'chat' },
}));
vi.mock('@/features/sessions/use-fork-chat', () => ({ useForkChat: () => fork }));
vi.mock('@/features/sessions/view-model/chat-to-thread-custom', async (original) => ({
  ...(await original<object>()),
  activeSessionCustom: () => session,
}));
vi.mock('@assistant-ui/react', async (original) => {
  const aui = await original<typeof import('@assistant-ui/react')>();
  // The fixture's runtime has no thread list; only the chat's id is read from it here.
  const withChat = (state: object) =>
    new Proxy(state, {
      get: (target, key, receiver) => (key === 'threadListItem' ? item : Reflect.get(target, key, receiver)),
    });
  return {
    ...aui,
    useAuiState: ((select: (state: never) => unknown) =>
      aui.useAuiState((state) => select(withChat(state) as never))) as typeof aui.useAuiState,
  };
});
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue({ text: '', truncated: false }),
}));

let roots = 0;
beforeEach(() => {
  roots++;
  fork.mockReset();
  useUiPrefs.setState({ finishedWork: 'fold' });
  useAdaptersStore.setState({
    byId: { claude: { id: 'claude', name: 'Claude', capabilities: { planMode: true, fork: true } } },
  } as never);
});

const show = (messages: ThreadMessage[]) => render(<TurnFixture rootId={`footer-${roots}`} messages={messages} />);
const footerOf = (id: string) =>
  within(document.querySelector<HTMLElement>(`[data-testid="chat-assistant-message"][data-message-id="${id}"]`)!);
/** The agent answered, then still ran something. */
const ended = [
  user('Go', 'u1'),
  assistant([bash('a', 'ls'), text('All done')], 'a1'),
  system('compacted', { isCompacted: true }),
  assistant([bash('b', 'git status')], 'a2', { timing: 134_000, custom: { cost: 0.25 } }),
];

it('offers Fork on a turn that ends with a tool message', () => {
  show(ended);
  footerOf('a1').getByTestId('chat-assistant-message-fork').click();
  expect(fork).toHaveBeenCalledWith('chat', undefined);
});

it('forks an earlier one before the message that follows the whole turn', () => {
  show([...ended, user('More', 'u2'), assistant([text('Ok')], 'a3')]);
  footerOf('a1').getByTestId('chat-assistant-message-fork').click();
  expect(fork).toHaveBeenCalledWith('chat', { fromMessageId: 'u2' });
});

it('offers none between two turns the agent took on its own', () => {
  const own = (turnId: string) => ({ presentation: { turnId } });
  show([user('Go', 'u1'), assistant([text('Waiting')], 'a1', own('t1')), assistant([text('Back')], 'a2', own('t2'))]);
  expect(footerOf('a1').queryByTestId('chat-assistant-message-fork')).toBeNull();
  expect(footerOf('a2').getByTestId('chat-assistant-message-fork')).toBeVisible();
});

it('says what the turn took and cost, on focus, wherever in the turn it was recorded', async () => {
  show(ended);
  const time = footerOf('a1').getByTestId('chat-message-timestamp');
  expect(time).toHaveProperty('tabIndex', 0);
  act(() => time.focus());
  const details = await screen.findAllByText(/Took 2m 14s/);
  expect(details.length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Cost \$0\.250/).length).toBeGreaterThan(0);
});
