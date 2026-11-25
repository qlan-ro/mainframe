import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listBackgroundTasks, readBackgroundTaskOutput } from '@/lib/api/background-tasks';
import { BackgroundOutput } from '../BackgroundOutput';

vi.mock('../../chat-tool-context', () => ({ useChatId: () => 'chat' }));
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: vi.fn(), readBackgroundTaskOutput: vi.fn() }));

const task = (status: string) => [{ id: 'bg', toolUseId: 'call', status }] as never;
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const show = () => render(<BackgroundOutput toolCallId="call" command="pnpm dev" launch="Started bg" />);
const output = () => screen.getByTestId('chat-bash-output');

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(listBackgroundTasks).mockReset().mockResolvedValue(task('running'));
  vi.mocked(readBackgroundTaskOutput).mockReset();
});
afterEach(() => vi.useRealTimers());

it('reads on after a read that failed, and drops the error', async () => {
  vi.mocked(readBackgroundTaskOutput)
    .mockResolvedValueOnce({ text: 'one', truncated: false })
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ text: 'one two', truncated: false });
  show();
  await wait(0);
  expect(output()).toHaveTextContent('one');
  await wait(2000);
  expect(screen.getByTestId('chat-background-output-error')).toHaveTextContent('offline');
  expect(output()).toHaveTextContent('one');
  await wait(2000);
  expect(readBackgroundTaskOutput).toHaveBeenCalledTimes(3);
  // Each wait after a failure is twice the last.
  await wait(3999);
  expect(readBackgroundTaskOutput).toHaveBeenCalledTimes(3);
  await wait(1);
  expect(output()).toHaveTextContent('one two');
  expect(screen.queryByTestId('chat-background-output-error')).toBeNull();
});

it('stops once the task has ended, and once its row is closed', async () => {
  vi.mocked(listBackgroundTasks).mockResolvedValue(task('completed'));
  vi.mocked(readBackgroundTaskOutput).mockResolvedValue({ text: 'done', truncated: false });
  show();
  await wait(60_000);
  expect(readBackgroundTaskOutput).toHaveBeenCalledTimes(1);

  vi.mocked(listBackgroundTasks).mockRejectedValue(new Error('offline'));
  const view = show();
  await wait(0);
  const calls = vi.mocked(listBackgroundTasks).mock.calls.length;
  view.unmount();
  await wait(60_000);
  expect(listBackgroundTasks).toHaveBeenCalledTimes(calls);
});

it('says when the start of the output is left out', async () => {
  vi.mocked(readBackgroundTaskOutput).mockResolvedValue({ text: 'tail', truncated: true });
  show();
  await wait(0);
  expect(screen.getByTestId('chat-background-output-truncated')).toHaveTextContent('last 1 MB');
});
