import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createChatThreadState, type ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import type { ThreadMessage } from '@assistant-ui/react';

const data = vi.hoisted(() => ({ state: undefined as ChatThreadState | undefined, messages: [] as ThreadMessage[] }));
vi.mock('@assistant-ui/react', () => ({ useAuiState: () => data.messages }));
vi.mock('@/features/chat/runtime/chat-extras', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/chat/runtime/chat-extras')>()),
  useChatExtras: () => ({ state: data.state }),
}));
vi.mock('@/features/chat/orchestration/use-session-items', () => ({ useSessionItems: () => [] }));
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: vi.fn().mockResolvedValue([]) }));
const { useActivityEntries } = await import('../use-activity-entries');

beforeEach(() => {
  data.state = createChatThreadState('child');
});

it('reads current session running state from the same runtime state as the transcript', async () => {
  data.state = { ...data.state!, runState: { type: 'running' } };
  const view = renderHook(useActivityEntries);
  await waitFor(() => expect(view.result.current.sessionRunning).toBe(true));
  expect(view.result.current.entries).toEqual([]);
  data.state = { ...data.state!, runState: { type: 'idle' } };
  view.rerender();
  expect(view.result.current.sessionRunning).toBe(false);
});
