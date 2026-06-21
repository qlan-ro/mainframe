import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- mocks ---------------------------------------------------------------
const pickDirectory = vi.fn<(opts: { mode?: string; title?: string }) => Promise<string | null>>();
vi.mock('@/features/files/use-directory-picker', () => ({
  useDirectoryPicker: (selector: (s: { pickDirectory: typeof pickDirectory }) => unknown) =>
    selector({ pickDirectory }),
}));

const createProject = vi.fn();
vi.mock('@/lib/api/projects', () => ({ createProject: (...args: unknown[]) => createProject(...args) }));

vi.mock('../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

const toastSuccess = vi.fn();
const toastInfo = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { useAddProject } from '../use-add-project';

const PROJECT = {
  id: 'p9',
  name: 'gamma',
  path: '/home/user/gamma',
  createdAt: '2026-06-22T00:00:00.000Z',
  lastOpenedAt: '2026-06-22T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAddProject — happy path (new project)', () => {
  it('picks a dir, creates the project, reloads, and shows a success toast', async () => {
    pickDirectory.mockResolvedValue('/home/user/gamma');
    createProject.mockResolvedValue({ project: PROJECT, alreadyExists: false });
    const reloadProjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAddProject(reloadProjects));
    await act(async () => {
      await result.current();
    });

    expect(pickDirectory).toHaveBeenCalledWith({ mode: 'directory', title: 'Add project' });
    expect(createProject).toHaveBeenCalledWith(31415, '/home/user/gamma');
    expect(reloadProjects).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Project added', { description: '/home/user/gamma' });
    expect(toastInfo).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useAddProject — cancel (picker returns null)', () => {
  it('does nothing: no create, no reload, no toast', async () => {
    pickDirectory.mockResolvedValue(null);
    const reloadProjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAddProject(reloadProjects));
    await act(async () => {
      await result.current();
    });

    expect(createProject).not.toHaveBeenCalled();
    expect(reloadProjects).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useAddProject — already registered (409)', () => {
  it('reloads and shows an info toast', async () => {
    pickDirectory.mockResolvedValue('/home/user/gamma');
    createProject.mockResolvedValue({ project: PROJECT, alreadyExists: true });
    const reloadProjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAddProject(reloadProjects));
    await act(async () => {
      await result.current();
    });

    expect(reloadProjects).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith('Project already added', { description: '/home/user/gamma' });
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('useAddProject — create error', () => {
  it('shows an error toast and does not reload', async () => {
    pickDirectory.mockResolvedValue('/home/user/gamma');
    createProject.mockRejectedValue(new Error('path must be absolute'));
    const reloadProjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAddProject(reloadProjects));
    await act(async () => {
      await result.current();
    });

    expect(reloadProjects).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Failed to add project', { description: 'path must be absolute' });
  });
});
