import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { createChatThreadState, type ChatThreadState } from '@/features/chat/controller/chat-thread-state';

const data = vi.hoisted(() => ({
  state: undefined as ChatThreadState | undefined,
  permissions: {} as Record<string, { request: { toolUseId: string } }>,
  messages: [] as ThreadMessage[],
  list: vi.fn(),
}));
vi.mock('@assistant-ui/react', () => ({ useAuiState: () => data.messages }));
vi.mock('@/features/chat/runtime/chat-extras', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/chat/runtime/chat-extras')>()),
  useChatExtras: () => ({ state: data.state, permissions: data.permissions }),
}));
vi.mock('@/features/chat/orchestration/use-session-items', () => ({ useSessionItems: () => [] }));
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: data.list }));
const { useActivityEntries } = await import('../use-activity-entries');

const agent = (id: string, toolUseId: string): BackgroundTask => ({
  id,
  kind: 'agent',
  toolName: 'Bash',
  toolUseId,
  command: '',
  description: id,
  outputPath: null,
  startedAt: 1,
  endedAt: null,
  status: 'running',
  lastOutputLine: null,
  summary: null,
  usage: null,
});
const message = (id: string, content: unknown[]): ThreadMessage =>
  ({ id, role: 'assistant', createdAt: new Date(0), content }) as unknown as ThreadMessage;
const call = (toolCallId: string, messages?: ThreadMessage[]) => ({
  type: 'tool-call',
  toolName: messages ? 'Task' : 'Bash',
  toolCallId,
  args: {},
  messages,
});

beforeEach(() => {
  data.state = createChatThreadState('parent');
  data.permissions = {};
  data.messages = [
    message('m-1', [
      call('task-1', [message('n-1', [call('bash-1')])]),
      call('task-2', [message('n-2', [call('bash-2')])]),
    ]),
  ];
  data.list.mockResolvedValue([agent('a-1', 'task-1'), agent('a-2', 'task-2')]);
});

it('marks only the agent whose own tool call waits on you', async () => {
  data.permissions = { r1: { request: { toolUseId: 'bash-2' } } };
  const view = renderHook(useActivityEntries);
  await waitFor(() => expect(view.result.current.entries).toHaveLength(2));
  const state = (id: string) => view.result.current.entries.find((entry) => entry.id === id)?.state;
  expect(state('task:a-1')).toBe('running');
  expect(state('task:a-2')).toBe('needs-you');

  data.permissions = {};
  view.rerender();
  expect(state('task:a-2')).toBe('running');
});

it("names the session's provider, which decides what can be stopped", async () => {
  expect(renderHook(useActivityEntries).result.current.adapterId).toBeUndefined();
  data.state = { ...createChatThreadState('parent'), chatConfig: { adapterId: 'codex' } } as ChatThreadState;
  expect(renderHook(useActivityEntries).result.current.adapterId).toBe('codex');
  await waitFor(() => expect(data.list).toHaveBeenCalled());
});

it('says why the list failed when the rejection is not an Error', async () => {
  data.list.mockRejectedValue({ code: -32000, message: 'request timed out' });
  const view = renderHook(useActivityEntries);
  await waitFor(() => expect(view.result.current.loadError).toBe('request timed out'));
});

it("leaves agents running while the session's own tool call waits", async () => {
  data.permissions = { r1: { request: { toolUseId: 'main-bash' } } };
  const view = renderHook(useActivityEntries);
  await waitFor(() => expect(view.result.current.entries).toHaveLength(2));
  expect(view.result.current.entries.map((entry) => entry.state)).toEqual(['running', 'running']);
});
