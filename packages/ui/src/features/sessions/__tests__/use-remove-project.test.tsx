import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useSessionFilters } from '@/store/session-filters';

// --- mocks ---------------------------------------------------------------
const removeProject = vi.fn();
vi.mock('@/lib/api/projects', () => ({ removeProject: (...args: unknown[]) => removeProject(...args) }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const requestConfirm = vi.fn();
vi.mock('@/lib/confirm-bridge', () => ({ requestConfirm: (...args: unknown[]) => requestConfirm(...args) }));

vi.mock('../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { holdUnsent, useUnsentMessages } from '@/features/chat/composer/unsent/unsent-store';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
import { useRemoveProject } from '../use-remove-project';

const PROJECT: Project = {
  id: 'p1',
  name: 'alpha',
  path: '/home/user/alpha',
  createdAt: '2026-06-22T00:00:00.000Z',
  lastOpenedAt: '2026-06-22T00:00:00.000Z',
};

let chatIds: string[];
const chatIdsOf = (projectId: string) => (projectId === 'p1' ? chatIds : []);

beforeEach(() => {
  vi.clearAllMocks();
  chatIds = [];
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
  setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null });
  useSessionFilters.setState({ filterProjectIds: new Set() });
});

describe('useRemoveProject — confirm', () => {
  it('calls removeProject, drops the row, and shows a success toast', async () => {
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(removeProject).toHaveBeenCalledWith(31415, 'p1');
    expect(removeProjectFromList).toHaveBeenCalledWith('p1');
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Project removed', { description: 'alpha' });
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useRemoveProject — confirm drops the removed project from a multi-project scope', () => {
  it('removes p1 from a two-project scope, leaving the other project in place', async () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['p1', 'p2']) });
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['p2']));
  });

  it('leaves a scope untouched when it does not contain the removed project', async () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['other-project']) });
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['other-project']));
  });

  it('leaves an empty scope empty', async () => {
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set());
  });
});

describe('useRemoveProject — cancel', () => {
  it('issues no request and leaves the scope unchanged', async () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['p1']) });
    requestConfirm.mockResolvedValue(false);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(removeProject).not.toHaveBeenCalled();
    expect(removeProjectFromList).not.toHaveBeenCalled();
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['p1']));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useRemoveProject — daemon failure', () => {
  it('shows an error toast, leaves the row in place, and leaves the scope unchanged', async () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['p1']) });
    requestConfirm.mockResolvedValue(true);
    removeProject.mockRejectedValue(new Error('database is locked'));
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Failed to remove project', { description: 'database is locked' });
    expect(removeProjectFromList).not.toHaveBeenCalled();
    expect(useSessionFilters.getState().filterProjectIds).toEqual(new Set(['p1']));
  });
});

describe('useRemoveProject — dialog copy', () => {
  it('requests a destructive confirm carrying the project name and a stable testid', async () => {
    requestConfirm.mockResolvedValue(false);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList, chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(requestConfirm).toHaveBeenCalledTimes(1);
    const [firstCall] = requestConfirm.mock.calls;
    const arg = firstCall?.[0];
    expect(arg.title).toContain('alpha');
    expect(arg.destructive).toBe(true);
    expect(arg.testid).toBe('sessions-remove-project-dialog');
  });
});

describe('useRemoveProject — held messages', () => {
  const hold = (chatId: string, projectId = PROJECT.id) =>
    useHeldQueue.getState().hold(
      chatId,
      {
        messageId: `m-${chatId}`,
        chatId,
        uuid: 'u',
        content: 'held',
        timestamp: '2026-11-25T10:00:00Z',
      },
      { projectId },
    );
  const heldChats = () => Object.keys(useHeldQueue.getState().byChat).sort();
  const run = async () => {
    requestConfirm.mockResolvedValue(true);
    const { result } = renderHook(() => useRemoveProject(vi.fn(), chatIdsOf));
    await act(async () => {
      await result.current(PROJECT);
    });
  };

  beforeEach(() => {
    hold('opened');
    hold('never-opened');
    hold('elsewhere', 'other-project');
    chatIds = ['opened'];
  });

  it('go with the project, opened here or not, and no other project’s do', async () => {
    // The list reloads without the project's chats while the daemon answers.
    removeProject.mockImplementation(async () => void (chatIds = []));
    await run();

    expect(heldChats()).toEqual(['elsewhere']);
  });

  it('take the unsent first messages of its sessions along', async () => {
    const draft = { text: 'x', items: [], attachments: [], references: {} };
    for (const threadId of ['opened', 'elsewhere']) holdUnsent({ threadId, draft, sent: [] });
    await run();

    expect(useUnsentMessages.getState().entries.map((entry) => entry.threadId)).toEqual(['elsewhere']);
    useUnsentMessages.setState({ entries: [] });
  });

  it('stay when the daemon refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    removeProject.mockRejectedValue(new Error('busy'));
    await run();

    expect(heldChats()).toEqual(['elsewhere', 'never-opened', 'opened']);
  });
});
