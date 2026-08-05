import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';

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

let fakeFilterProjectId: string | null = null;
const setFilterProjectId = vi.fn();
vi.mock('@/store/session-filters', () => ({
  useSessionFilters: () => ({ filterProjectId: fakeFilterProjectId, setFilterProjectId }),
}));

vi.mock('../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { useRemoveProject } from '../use-remove-project';

const PROJECT: Project = {
  id: 'p1',
  name: 'alpha',
  path: '/home/user/alpha',
  createdAt: '2026-06-22T00:00:00.000Z',
  lastOpenedAt: '2026-06-22T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  fakeFilterProjectId = null;
});

describe('useRemoveProject — confirm', () => {
  it('calls removeProject, drops the row, and shows a success toast', async () => {
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList));
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

describe('useRemoveProject — confirm clears a matching filter', () => {
  it('clears the filter when it points at the removed project', async () => {
    fakeFilterProjectId = 'p1';
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(setFilterProjectId).toHaveBeenCalledWith(null);
  });

  it('leaves a different filter untouched', async () => {
    fakeFilterProjectId = 'other-project';
    requestConfirm.mockResolvedValue(true);
    removeProject.mockResolvedValue(undefined);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(setFilterProjectId).not.toHaveBeenCalled();
  });
});

describe('useRemoveProject — cancel', () => {
  it('issues no request and changes nothing', async () => {
    requestConfirm.mockResolvedValue(false);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(removeProject).not.toHaveBeenCalled();
    expect(removeProjectFromList).not.toHaveBeenCalled();
    expect(setFilterProjectId).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useRemoveProject — daemon failure', () => {
  it('shows an error toast and leaves the row in place', async () => {
    requestConfirm.mockResolvedValue(true);
    removeProject.mockRejectedValue(new Error('database is locked'));
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList));
    await act(async () => {
      await result.current(PROJECT);
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Failed to remove project', { description: 'database is locked' });
    expect(removeProjectFromList).not.toHaveBeenCalled();
    expect(setFilterProjectId).not.toHaveBeenCalled();
  });
});

describe('useRemoveProject — dialog copy', () => {
  it('requests a destructive confirm carrying the project name and a stable testid', async () => {
    requestConfirm.mockResolvedValue(false);
    const removeProjectFromList = vi.fn();

    const { result } = renderHook(() => useRemoveProject(removeProjectFromList));
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
