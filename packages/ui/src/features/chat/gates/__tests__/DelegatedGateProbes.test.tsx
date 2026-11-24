/**
 * Delegated tasks' requests surface in their parent (G5). Two zones can show
 * the same task: the parent's, and that of a task which delegated further.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';

let mockChatId: string | null;
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: unknown) => unknown) => select({ threadListItem: { remoteId: mockChatId } }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('../../orchestration/use-session-items', () => ({ useSessionItems: () => [] }));
let mockRows: Record<string, DelegatedTaskRow[]>;
vi.mock('@/features/sessions/view-model/agent-provenance', () => ({
  delegatedTasksOf: (_items: unknown, chatId: string) => mockRows[chatId] ?? [],
}));
const release = vi.fn();
const holdActive = vi.fn(() => release);
const replyToPermission = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/sessions/runtime/use-chat-controller', () => ({
  useChatController: (chatId: string) => ({ chatId, holdActive, replyToPermission }),
}));
let mockPermissions: Record<string, Record<string, { requestId: string; askedAt: number }>>;
vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useControllerState: ({ chatId }: { chatId: string }) => ({
    interactions: { permissions: mockPermissions[chatId] ?? {} },
    chatConfig: { permissionMode: 'default' },
  }),
}));

import { DelegatedGateProbes } from '../DelegatedGateProbes';
import { useDelegatedGates } from '../delegated-gates-store';

const row = (taskId: string, itemId: string, waiting = true): DelegatedTaskRow => ({
  taskId,
  itemId,
  title: `Title ${taskId}`,
  adapterId: 'claude',
  status: 'waiting',
  waiting,
  updatedAt: 1,
});
const asks = (requestId: string) => ({ [requestId]: { requestId, askedAt: 1 } });
const gates = () => Object.values(useDelegatedGates.getState().byTask);

beforeEach(() => {
  vi.clearAllMocks();
  useDelegatedGates.setState({ byTask: {} });
  mockChatId = 'parent';
  mockRows = { parent: [row('t1', 'child')] };
  mockPermissions = { child: asks('r1') };
});

describe('DelegatedGateProbes', () => {
  it('attaches a waiting task and reports its requests to the parent', () => {
    render(<DelegatedGateProbes />);

    expect(holdActive).toHaveBeenCalledTimes(1);
    expect(gates()).toMatchObject([
      { parentChatId: 'parent', chatId: 'child', taskId: 't1', topTaskId: 't1', title: 'Title t1' },
    ]);
  });

  it('leaves a task alone that waits on nothing', () => {
    mockRows = { parent: [row('t1', 'child', false)] };
    render(<DelegatedGateProbes />);

    expect(holdActive).not.toHaveBeenCalled();
    expect(gates()).toEqual([]);
  });

  it('surfaces a task that a task delegated, naming the one it runs under', () => {
    mockRows = { parent: [row('t1', 'child')], child: [row('t2', 'grandchild')] };
    mockPermissions = { grandchild: asks('r2') };
    render(<DelegatedGateProbes />);

    expect(gates()).toMatchObject([
      { chatId: 'grandchild', taskId: 't2', topTaskId: 't1', parentTitle: 'Title t1', title: 'Title t2' },
    ]);
  });

  it('answers into the task’s own chat', async () => {
    render(<DelegatedGateProbes />);
    await gates()[0]!.reply({ requestId: 'r1' } as never, 'allow-once');

    expect(replyToPermission).toHaveBeenCalledExactlyOnceWith({ requestId: 'r1' }, 'allow-once');
  });

  it('two zones showing the same task keep their own gate: closing one leaves the other', () => {
    mockRows = { parent: [row('t1', 'child')], child: [row('t2', 'grandchild')] };
    mockPermissions = { grandchild: asks('r2') };
    render(<DelegatedGateProbes />);
    mockChatId = 'child';
    const childZone = render(<DelegatedGateProbes />);
    expect(
      gates()
        .map((gate) => gate.parentChatId)
        .sort(),
    ).toEqual(['child', 'parent']);

    childZone.unmount();

    expect(gates()).toMatchObject([{ parentChatId: 'parent', taskId: 't2' }]);
  });

  it('forgets the request and lets the session go when the task stops waiting', () => {
    const { rerender } = render(<DelegatedGateProbes />);
    mockRows = { parent: [] };
    rerender(<DelegatedGateProbes key="again" />);

    expect(gates()).toEqual([]);
    expect(release).toHaveBeenCalled();
  });
});
