/** A list of background tasks that could not be read is asked for again: without it no agent has a place (T1e). */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, assistant, bash, text, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: vi.fn(), readBackgroundTaskOutput: vi.fn() }));

const state = createChatThreadState('chat-fixture');
const extras = buildChatExtras({} as AcpChatController, 31415, {
  ...state,
  backgroundTasks: { bg: { id: 'bg', kind: 'agent', description: 'x', startedAt: 1 } },
} as typeof state);
const placed = [{ id: 'bg', kind: 'agent', toolUseId: 'elsewhere', status: 'running', startedAt: 1 }] as never;
const isOpen = () => screen.getByTestId(/^chat-work-toggle-/).getAttribute('aria-expanded') === 'true';

beforeEach(() => {
  vi.useFakeTimers();
  useUiPrefs.setState({ finishedWork: 'fold' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function show(rootId: string) {
  render(
    <TurnFixture rootId={rootId} messages={[user('Hi'), assistant([bash('b', 'ls'), text('Done')])]} extras={extras} />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
}

it('folds the turns it held open once the list answers', async () => {
  vi.mocked(listBackgroundTasks).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(placed);
  await show('retry-failed');
  expect(isOpen()).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(isOpen()).toBe(false);
  expect(listBackgroundTasks).toHaveBeenCalledTimes(2);
});

it('asks again while the list does not name a running task yet, and then stops', async () => {
  vi.mocked(listBackgroundTasks).mockResolvedValueOnce([]).mockResolvedValue(placed);
  await show('retry-missing');
  expect(isOpen()).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(isOpen()).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(listBackgroundTasks).toHaveBeenCalledTimes(2);
});
