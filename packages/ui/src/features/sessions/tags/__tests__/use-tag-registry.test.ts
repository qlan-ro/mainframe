/**
 * useTagRegistry — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - On mount, initially tags is [] and loading is true.
 *  - After listTags resolves, tags equals the resolved array and loading is false.
 *  - refresh() calls listTags a second time.
 *  - create('beta', 'red') calls createTag(31415, 'beta', 'red') once then refreshes.
 *  - create('gamma') with no color calls createTag(31415, 'gamma', undefined) once.
 *  - update('alpha', { rename: 'alpha2' }) calls updateTag then refreshes.
 *  - update('alpha', { color: 'green' }) calls updateTag once.
 *  - remove('beta') calls deleteTag(31415, 'beta') once then refreshes.
 *  - colorOf('alpha') returns 'blue' from the loaded registry.
 *  - colorOf('missing') returns 'blue' (default fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock factories run before imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/tags', () => ({
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { listTags, createTag, updateTag, deleteTag } from '@/lib/api/tags';
import { useTagRegistry, useTagRegistryStore } from '../use-tag-registry';

const mockListTags = vi.mocked(listTags);
const mockCreateTag = vi.mocked(createTag);
const mockUpdateTag = vi.mocked(updateTag);
const mockDeleteTag = vi.mocked(deleteTag);

// ---------------------------------------------------------------------------
// Fixture tag
// ---------------------------------------------------------------------------

const ALPHA_TAG = { name: 'alpha', color: 'blue' as const, createdAt: '2026-01-01T00:00:00.000Z' };

// ---------------------------------------------------------------------------
// Reset mocks between cases
// ---------------------------------------------------------------------------
//
// The registry cache is now a module-level shared store (see the "shared
// registry" describe below) so every consumer sees the same tags — reset it
// between tests or state leaks across cases sharing port 31415.

beforeEach(() => {
  vi.clearAllMocks();
  useTagRegistryStore.setState({ tagsByPort: {}, loadingByPort: {} });
});

// ---------------------------------------------------------------------------
// 1. Initial state: tags is [] and loading is true
// ---------------------------------------------------------------------------

describe('useTagRegistry — initial state before listTags resolves', () => {
  it('tags is [] and loading is true synchronously after mount', () => {
    mockListTags.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useTagRegistry(31415));

    expect(result.current.tags).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Resolved state: tags equals the resolved array and loading is false
// ---------------------------------------------------------------------------

describe('useTagRegistry — after listTags resolves with one tag', () => {
  it('tags equals [{ name: "alpha", color: "blue", createdAt: "2026-01-01T00:00:00.000Z" }] and loading is false', async () => {
    mockListTags.mockResolvedValue([ALPHA_TAG]);

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tags).toEqual([{ name: 'alpha', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z' }]);
  });
});

// ---------------------------------------------------------------------------
// 3. refresh() calls listTags a second time
// ---------------------------------------------------------------------------

describe('useTagRegistry — refresh() calls listTags again', () => {
  it('calls listTags(31415) a second time when refresh() is invoked', async () => {
    mockListTags.mockResolvedValue([]);

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockListTags).toHaveBeenCalledTimes(2);
    expect(mockListTags).toHaveBeenCalledWith(31415);
  });
});

// ---------------------------------------------------------------------------
// 4. create('beta', 'red') calls createTag(31415, 'beta', 'red') and refreshes
// ---------------------------------------------------------------------------

describe('useTagRegistry — create(name, color) calls createTag then refreshes', () => {
  it('calls createTag(31415, "beta", "red") exactly once and listTags a second time', async () => {
    mockListTags.mockResolvedValue([]);
    mockCreateTag.mockResolvedValue({ name: 'beta', color: 'red', createdAt: '2026-01-01T00:00:00.000Z' });

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.create('beta', 'red');
    });

    expect(mockCreateTag).toHaveBeenCalledTimes(1);
    expect(mockCreateTag).toHaveBeenCalledWith(31415, 'beta', 'red');
    expect(mockListTags).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 5. create('gamma') with no color calls createTag(31415, 'gamma', undefined)
// ---------------------------------------------------------------------------

describe('useTagRegistry — create(name) without color passes undefined', () => {
  it('calls createTag(31415, "gamma", undefined) exactly once', async () => {
    mockListTags.mockResolvedValue([]);
    mockCreateTag.mockResolvedValue({ name: 'gamma', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z' });

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.create('gamma');
    });

    expect(mockCreateTag).toHaveBeenCalledTimes(1);
    expect(mockCreateTag).toHaveBeenCalledWith(31415, 'gamma', undefined);
  });
});

// ---------------------------------------------------------------------------
// 6. update('alpha', { rename: 'alpha2' }) calls updateTag then refreshes
// ---------------------------------------------------------------------------

describe('useTagRegistry — update(name, { rename }) calls updateTag then refreshes', () => {
  it('calls updateTag(31415, "alpha", { rename: "alpha2" }) once and listTags again', async () => {
    mockListTags.mockResolvedValue([]);
    mockUpdateTag.mockResolvedValue({ name: 'alpha2', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z' });

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.update('alpha', { rename: 'alpha2' });
    });

    expect(mockUpdateTag).toHaveBeenCalledTimes(1);
    expect(mockUpdateTag).toHaveBeenCalledWith(31415, 'alpha', { rename: 'alpha2' });
    expect(mockListTags).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 7. update('alpha', { color: 'green' }) calls updateTag once
// ---------------------------------------------------------------------------

describe('useTagRegistry — update(name, { color }) calls updateTag once', () => {
  it('calls updateTag(31415, "alpha", { color: "green" }) exactly once', async () => {
    mockListTags.mockResolvedValue([]);
    mockUpdateTag.mockResolvedValue({ name: 'alpha', color: 'green', createdAt: '2026-01-01T00:00:00.000Z' });

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.update('alpha', { color: 'green' });
    });

    expect(mockUpdateTag).toHaveBeenCalledTimes(1);
    expect(mockUpdateTag).toHaveBeenCalledWith(31415, 'alpha', { color: 'green' });
  });
});

// ---------------------------------------------------------------------------
// 8. remove('beta') calls deleteTag(31415, 'beta') once then refreshes
// ---------------------------------------------------------------------------

describe('useTagRegistry — remove(name) calls deleteTag then refreshes', () => {
  it('calls deleteTag(31415, "beta") exactly once and listTags again', async () => {
    mockListTags.mockResolvedValue([]);
    mockDeleteTag.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.remove('beta');
    });

    expect(mockDeleteTag).toHaveBeenCalledTimes(1);
    expect(mockDeleteTag).toHaveBeenCalledWith(31415, 'beta');
    expect(mockListTags).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 9. colorOf('alpha') returns 'blue'; colorOf('missing') returns 'blue' (default)
// ---------------------------------------------------------------------------

describe('useTagRegistry — colorOf returns color from registry or default "blue"', () => {
  it('colorOf("alpha") returns "blue" from loaded registry', async () => {
    mockListTags.mockResolvedValue([ALPHA_TAG]);

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.colorOf('alpha')).toBe('blue');
  });

  it('colorOf("missing") returns "blue" as the default fallback', async () => {
    mockListTags.mockResolvedValue([ALPHA_TAG]);

    const { result } = renderHook(() => useTagRegistry(31415));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.colorOf('missing')).toBe('blue');
  });
});

// ---------------------------------------------------------------------------
// 10. Regression (bug c): SessionSidebar and TagPopoverHost each mount their own
// useTagRegistry(port) instance. A recolor applied through one instance (the
// popover host) must repaint colorOf on the OTHER, independently-mounted
// instance (the sidebar's row dots) — they previously held separate useState
// caches with no shared invalidation, so a recolor never reached the row dot.
// ---------------------------------------------------------------------------

describe('useTagRegistry — shared registry across independently-mounted consumers (bug c: tag recolor sync)', () => {
  it('a recolor applied via one instance is visible through colorOf on a second instance for the same port', async () => {
    mockListTags.mockResolvedValueOnce([ALPHA_TAG]);
    const sidebar = renderHook(() => useTagRegistry(31415));
    await waitFor(() => expect(sidebar.result.current.loading).toBe(false));
    expect(sidebar.result.current.colorOf('alpha')).toBe('blue');

    // A second, independently-mounted consumer for the SAME port — mirrors
    // SessionSidebar + TagPopoverHost each calling useTagRegistry(port).
    mockListTags.mockResolvedValueOnce([ALPHA_TAG]);
    const popoverHost = renderHook(() => useTagRegistry(31415));
    await waitFor(() => expect(popoverHost.result.current.loading).toBe(false));

    // Recolor via the popover-host instance only — the sidebar instance never
    // calls update() or refresh() itself.
    const recolored = { ...ALPHA_TAG, color: 'green' as const };
    mockUpdateTag.mockResolvedValue(recolored);
    mockListTags.mockResolvedValueOnce([recolored]);
    await act(async () => {
      await popoverHost.result.current.update('alpha', { color: 'green' });
    });

    expect(sidebar.result.current.colorOf('alpha')).toBe('green');
  });
});
