/**
 * useModalProjectScope — the per-open scope a modal holds locally.
 *
 * Strategy: mock @/features/sessions/use-projects and
 * @/features/sessions/use-active-identity behind mutable fakes (mutated per
 * test, read fresh on every render); use the REAL @/store/session-filters so
 * its persistence (or lack of it, from this hook) is genuinely exercised.
 *
 * Behaviors covered:
 *  (a) open flips false → true seeds from the filter.
 *  (b) filterProjectId changes while open — scope does not follow it.
 *  (c) the active identity changes while open — scope does not follow it.
 *  (d) setProjectId overrides locally and never touches the sidebar filter
 *      store or its localStorage key.
 *  (e) close then reopen re-seeds from the filter's current value, discarding
 *      any override made during the previous open.
 *  (f) an empty project list at open-time seeds once more when the list
 *      resolves, then stops re-seeding.
 *  (g) mounting already open (open=true on the first render) seeds
 *      immediately — a mount that is already open is a rising edge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';

// ---------------------------------------------------------------------------
// Controlled fakes — mutated per test before the hook reads them
// ---------------------------------------------------------------------------

let fakeProjects: Project[] = [];
let fakeSessionProjectId: string | null = null;

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({
    projects: fakeProjects,
    loading: false,
    reloadProjects: vi.fn(),
    removeProjectFromList: vi.fn(),
  }),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectName: 'Mainframe',
    projectId: fakeSessionProjectId,
    isWorktree: false,
  }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks; the real filter store so its persistence is genuine
// ---------------------------------------------------------------------------

import { useModalProjectScope } from '../use-modal-project-scope';
import { useSessionFilters } from '@/store/session-filters';

const SCOPED_KEY = 'mf:filterProjectId::local';

beforeEach(() => {
  setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null });
  useSessionFilters.setState({
    filterProjectId: null,
    selectedTags: new Set(),
    selectedSynthetic: new Set(),
    sortMode: 'recent',
  });
  localStorage.removeItem(SCOPED_KEY);
  fakeProjects = [makeProject('proj-a'), makeProject('proj-b')];
  fakeSessionProjectId = null;
});

// ---------------------------------------------------------------------------
// (a) rising edge of `open` seeds from the filter
// ---------------------------------------------------------------------------

describe('useModalProjectScope — open flips false to true', () => {
  it('seeds projectId from the sidebar filter', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');

    const { result, rerender } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: false },
    });

    expect(result.current.projectId).toBeNull();

    act(() => rerender({ open: true }));

    expect(result.current.projectId).toBe('proj-a');
  });
});

// ---------------------------------------------------------------------------
// (b) filter changes while open — scope ignores it
// ---------------------------------------------------------------------------

describe('useModalProjectScope — the sidebar filter changes while the modal is open', () => {
  it('leaves the resolved projectId unchanged', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');
    const { result } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBe('proj-a');

    act(() => {
      useSessionFilters.getState().setFilterProjectId('proj-b');
    });

    expect(result.current.projectId).toBe('proj-a');
  });
});

// ---------------------------------------------------------------------------
// (c) the active session's project changes while open — scope ignores it
// ---------------------------------------------------------------------------

describe('useModalProjectScope — the active session project changes while the modal is open', () => {
  it('leaves the resolved projectId unchanged', () => {
    // Filter unset so the seed comes from the session fallback — a re-seeding
    // bug driven by identity would move the result to 'proj-b' and get caught.
    // (Wiring the trap to the filter instead, as in case (b), can't discriminate
    // here: with the filter set, a re-seed would still resolve to the same
    // filter-backed value and the assertion would pass either way.)
    fakeSessionProjectId = 'proj-a';
    const { result, rerender } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBe('proj-a');

    fakeSessionProjectId = 'proj-b';
    act(() => rerender({ open: true }));

    expect(result.current.projectId).toBe('proj-a');
  });
});

// ---------------------------------------------------------------------------
// (d) setProjectId overrides locally, never touches the sidebar filter
// ---------------------------------------------------------------------------

describe('useModalProjectScope — setProjectId', () => {
  it('changes the returned projectId and leaves the sidebar filter store and its localStorage key untouched', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');
    const { result } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBe('proj-a');

    act(() => {
      result.current.setProjectId('proj-b');
    });

    expect(result.current.projectId).toBe('proj-b');
    expect(useSessionFilters.getState().filterProjectId).toBe('proj-a');
    expect(localStorage.getItem(SCOPED_KEY)).toBe('proj-a');
  });
});

// ---------------------------------------------------------------------------
// (e) close then reopen re-seeds from the filter, discarding the override
// ---------------------------------------------------------------------------

describe('useModalProjectScope — closing and reopening', () => {
  it('re-seeds from the filter current value, discarding a prior override', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');
    const { result, rerender } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBe('proj-a');

    act(() => {
      result.current.setProjectId('proj-b');
    });
    expect(result.current.projectId).toBe('proj-b');

    act(() => rerender({ open: false }));
    expect(result.current.projectId).toBeNull();

    useSessionFilters.getState().setFilterProjectId('proj-b');
    act(() => rerender({ open: true }));

    expect(result.current.projectId).toBe('proj-b');
  });
});

// ---------------------------------------------------------------------------
// (f) an empty project list at open-time seeds once more when it resolves
// ---------------------------------------------------------------------------

describe('useModalProjectScope — the project list is still empty at open-time', () => {
  it('seeds once from the resolved list and does not re-seed again afterward', () => {
    fakeProjects = [];
    useSessionFilters.getState().setFilterProjectId('proj-a');

    const { result, rerender } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBeNull();

    fakeProjects = [makeProject('proj-a'), makeProject('proj-b')];
    act(() => rerender({ open: true }));
    expect(result.current.projectId).toBe('proj-a');

    useSessionFilters.getState().setFilterProjectId('proj-b');
    act(() => rerender({ open: true }));

    expect(result.current.projectId).toBe('proj-a');
  });
});

// ---------------------------------------------------------------------------
// (g) mounting already open seeds immediately
// ---------------------------------------------------------------------------

describe('useModalProjectScope — mounting with open already true', () => {
  it('seeds on the first render, not only on a later transition', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');

    const { result } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });

    expect(result.current.projectId).toBe('proj-a');
  });
});

// ---------------------------------------------------------------------------
// (h) a local pick survives a project list that arrives after it
// ---------------------------------------------------------------------------

describe('useModalProjectScope — a local pick made before the project list refreshes', () => {
  it('is not overwritten once the fresher list arrives', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');
    const { result, rerender } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBe('proj-a');

    act(() => result.current.setProjectId('proj-b'));
    expect(result.current.projectId).toBe('proj-b');

    // A new list reference — the shape a resolved reload would hand back —
    // must not re-run the seed over the user's own pick (AC5's fetch-window
    // hazard: the open's own rising-edge reload can resolve after the pick).
    fakeProjects = [...fakeProjects];
    act(() => rerender({ open: true }));

    expect(result.current.projectId).toBe('proj-b');
  });
});

// ---------------------------------------------------------------------------
// (i) a background filter change during the reseed window is ignored
// ---------------------------------------------------------------------------

describe('useModalProjectScope — the sidebar filter changes before a pending reseed resolves', () => {
  it('reseeds against the values captured at open, not the live ones', () => {
    useSessionFilters.getState().setFilterProjectId('proj-a');
    fakeProjects = [];
    const { result, rerender } = renderHook(({ open }) => useModalProjectScope(open), {
      initialProps: { open: true },
    });
    expect(result.current.projectId).toBeNull();

    // Sidebar filter moves to B in the background — a live re-read here would
    // leak it into an open modal, violating AC8.
    useSessionFilters.getState().setFilterProjectId('proj-b');
    fakeProjects = [makeProject('proj-a'), makeProject('proj-b')];
    act(() => rerender({ open: true }));

    expect(result.current.projectId).toBe('proj-a');
  });
});
