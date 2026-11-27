import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { useOwnSubagentCall } from '../use-own-subagent-call';

const around = vi.fn();
const controller = { historyGeneration: 0, subagentHistory: { around } } as unknown as AcpChatController;
const state = { runState: { type: 'idle' }, compacting: false } as unknown as ChatThreadState;

beforeEach(() => {
  around.mockReset().mockResolvedValue({ hasBefore: false, hasAfter: false, stale: true });
});

function mount(taskKey: string | null) {
  const view = renderHook(
    (props: { taskKey: string | null }) =>
      useOwnSubagentCall({ controller, state, toolCallId: 'call-1', enabled: true, active: true, ...props }),
    { initialProps: { taskKey } },
  );
  return async (next: string | null) => {
    view.rerender({ taskKey: next });
    await act(async () => undefined);
  };
}

it('does not fetch again when the task list arrives empty', async () => {
  const set = mount(null);
  await act(async () => undefined);
  await set('');
  expect(around).toHaveBeenCalledTimes(1);
});

it('fetches again when a task appears after the list has loaded, and when it settles', async () => {
  const set = mount(null);
  await act(async () => undefined);
  await set('');
  await set('bg-1:running:null');
  expect(around).toHaveBeenCalledTimes(2);
  await set('bg-1:completed:9');
  expect(around).toHaveBeenCalledTimes(3);
  await set('bg-1:completed:9');
  expect(around).toHaveBeenCalledTimes(3);
});
