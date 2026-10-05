// @vitest-environment jsdom
/**
 * useTasksProjects — behavior tests.
 *
 * Behaviors covered:
 *  1. An empty scope resolves to every known project, in list order.
 *  2. A scoped set resolves to just those projects, in list order (not scope
 *     insertion order).
 *  3. A scoped id the project list no longer knows about is dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const PROJECTS = [
  { id: 'proj-1', name: 'Mainframe', path: '/repos/mainframe' },
  { id: 'proj-2', name: 'Sidecar', path: '/repos/sidecar' },
  { id: 'proj-3', name: 'Zygote', path: '/repos/zygote' },
];

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: PROJECTS, loading: false, reloadProjects: vi.fn(), removeProjectFromList: vi.fn() }),
}));

import { useTasksProjects } from '../use-tasks-projects';
import { useSessionFilters } from '@/store/session-filters';

beforeEach(() => {
  useSessionFilters.setState({ filterProjectIds: new Set() });
});

describe('useTasksProjects — empty scope', () => {
  it('resolves to every known project, in list order', () => {
    const { result } = renderHook(() => useTasksProjects());
    expect(result.current).toEqual(['proj-1', 'proj-2', 'proj-3']);
  });
});

describe('useTasksProjects — a scoped set', () => {
  it('resolves to the scoped projects, in list order (not scope/insertion order)', () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['proj-3', 'proj-1']) });
    const { result } = renderHook(() => useTasksProjects());
    expect(result.current).toEqual(['proj-1', 'proj-3']);
  });

  it('drops a scoped id the project list no longer knows about', () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['proj-1', 'deleted-project']) });
    const { result } = renderHook(() => useTasksProjects());
    expect(result.current).toEqual(['proj-1']);
  });
});
