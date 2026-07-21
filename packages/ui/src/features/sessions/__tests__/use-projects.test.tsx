/**
 * useProjects — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - On mount, getProjects is called exactly once with port 31415.
 *  - Initially projects is [] and loading is true.
 *  - After getProjects resolves with one project, projects has length 1
 *    (id 'p1') and loading is false.
 *  - When getProjects rejects, projects stays [] and loading becomes false
 *    (no unhandled rejection).
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DaemonPortProvider } from '../runtime/daemon-port-context';

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock factories run before imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/projects', () => ({
  getProjects: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { getProjects } from '@/lib/api/projects';
import { useProjects } from '../use-projects';

const mockGetProjects = vi.mocked(getProjects);

// ---------------------------------------------------------------------------
// Wrapper — DaemonPortProvider at port 31415
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return <DaemonPortProvider port={31415}>{children}</DaemonPortProvider>;
}

// ---------------------------------------------------------------------------
// Reset mocks between cases
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

it('invokes getProjects(31415) exactly once on mount', async () => {
  mockGetProjects.mockResolvedValue([]);

  renderHook(() => useProjects(), { wrapper });

  await waitFor(() => {
    expect(mockGetProjects).toHaveBeenCalledTimes(1);
    expect(mockGetProjects).toHaveBeenCalledWith(31415);
  });
});

it('projects is [] and loading is true synchronously after mount', () => {
  // Never resolves — keeps loading:true for the duration of this test
  mockGetProjects.mockReturnValue(new Promise(() => undefined));

  const { result } = renderHook(() => useProjects(), { wrapper });

  expect(result.current.projects).toEqual([]);
  expect(result.current.loading).toBe(true);
});

it('projects has length 1 with id "p1" and loading is false after getProjects resolves', async () => {
  mockGetProjects.mockResolvedValue([{ id: 'p1', name: 'mainframe', path: '/r/mf', createdAt: '', lastOpenedAt: '' }]);

  const { result } = renderHook(() => useProjects(), { wrapper });

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  expect(result.current.projects).toHaveLength(1);
  expect(result.current.projects[0]?.id).toBe('p1');
});

it('removeProjectFromList removes the matching project id locally without refetching', async () => {
  mockGetProjects.mockResolvedValue([
    { id: 'p1', name: 'mainframe', path: '/r/mf', createdAt: '', lastOpenedAt: '' },
    { id: 'p2', name: 'docs', path: '/r/docs', createdAt: '', lastOpenedAt: '' },
  ]);

  const { result } = renderHook(() => useProjects(), { wrapper });

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  act(() => {
    result.current.removeProjectFromList('p1');
  });

  expect(result.current.projects.map((p) => p.id)).toEqual(['p2']);
  expect(mockGetProjects).toHaveBeenCalledTimes(1);
});

it('reloadProjects refreshes the project list from the daemon', async () => {
  mockGetProjects
    .mockResolvedValueOnce([{ id: 'p1', name: 'mainframe', path: '/r/mf', createdAt: '', lastOpenedAt: '' }])
    .mockResolvedValueOnce([{ id: 'p2', name: 'docs', path: '/r/docs', createdAt: '', lastOpenedAt: '' }]);

  const { result } = renderHook(() => useProjects(), { wrapper });

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  await act(async () => {
    await result.current.reloadProjects();
  });

  expect(result.current.projects.map((p) => p.id)).toEqual(['p2']);
  expect(mockGetProjects).toHaveBeenCalledTimes(2);
});

it('projects stays [] and loading becomes false without an unhandled rejection when getProjects rejects', async () => {
  mockGetProjects.mockRejectedValue(new Error('boom'));

  const { result } = renderHook(() => useProjects(), { wrapper });

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  expect(result.current.projects).toEqual([]);
});
