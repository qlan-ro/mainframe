import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollapsedProjects } from '../useCollapsedProjects';

const STORAGE_KEY = 'mf:collapsedProjects';

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Behavior 1 — initial state: collapsed is empty when localStorage has no key
// ---------------------------------------------------------------------------

describe('useCollapsedProjects — initial state with no localStorage key', () => {
  it('collapsed.size is 0', () => {
    const { result } = renderHook(() => useCollapsedProjects());

    expect(result.current.collapsed.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — initial state reads from localStorage
// ---------------------------------------------------------------------------

describe('useCollapsedProjects — initial state reads from localStorage', () => {
  it('hydrates collapsed set from stored array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['proj-1', 'proj-3']));

    const { result } = renderHook(() => useCollapsedProjects());

    expect(result.current.collapsed.has('proj-1')).toBe(true);
    expect(result.current.collapsed.has('proj-3')).toBe(true);
    expect(result.current.collapsed.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — toggle adds a project when not present
// ---------------------------------------------------------------------------

describe('useCollapsedProjects — toggle adds project when absent', () => {
  it('collapsed has proj-A after one toggle and localStorage stores ["proj-A"]', () => {
    const { result } = renderHook(() => useCollapsedProjects());

    act(() => {
      result.current.toggle('proj-A');
    });

    expect(result.current.collapsed.has('proj-A')).toBe(true);
    expect(result.current.collapsed.size).toBe(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['proj-A']);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — toggle removes a project when already present
// ---------------------------------------------------------------------------

describe('useCollapsedProjects — toggle removes project when present', () => {
  it('collapsed does not have proj-A after toggling it in then out, localStorage stores []', () => {
    const { result } = renderHook(() => useCollapsedProjects());

    act(() => {
      result.current.toggle('proj-A');
    });
    act(() => {
      result.current.toggle('proj-A');
    });

    expect(result.current.collapsed.has('proj-A')).toBe(false);
    expect(result.current.collapsed.size).toBe(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 — multiple projects collapse independently
// ---------------------------------------------------------------------------

describe('useCollapsedProjects — multiple projects collapse independently', () => {
  it('removing p1 leaves p2 collapsed and localStorage stores ["p2"]', () => {
    const { result } = renderHook(() => useCollapsedProjects());

    act(() => {
      result.current.toggle('p1');
    });
    act(() => {
      result.current.toggle('p2');
    });

    expect(result.current.collapsed.size).toBe(2);

    act(() => {
      result.current.toggle('p1');
    });

    expect(result.current.collapsed.has('p1')).toBe(false);
    expect(result.current.collapsed.has('p2')).toBe(true);
    expect(result.current.collapsed.size).toBe(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['p2']);
  });
});

// ---------------------------------------------------------------------------
// Behavior 6 — corrupted localStorage falls back to empty set
// ---------------------------------------------------------------------------

describe('useCollapsedProjects — corrupted localStorage falls back to empty set', () => {
  it('collapsed.size is 0 and does not throw when stored value is invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');

    const { result } = renderHook(() => useCollapsedProjects());

    expect(result.current.collapsed.size).toBe(0);
  });
});
