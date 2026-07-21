// @vitest-environment jsdom
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
 *  - Regression (bug c): a recolor applied through one useTagRegistry(port)
 *    instance is visible through colorOf on a second, independently-mounted
 *    instance for the same port (SessionSidebar + TagPopoverHost share state).
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor, type RenderHookResult } from '@testing-library/react';

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
import { useTagRegistry, useTagRegistryStore, type TagRegistry } from '../use-tag-registry';

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
// The registry cache is a module-level shared store (see the shared-registry
// regression test below) so every consumer sees the same tags — reset it
// between tests or state leaks across cases sharing port 31415.

beforeEach(() => {
  vi.clearAllMocks();
  useTagRegistryStore.setState({ tagsByPort: {}, loadingByPort: {} });
});

/** Mounts useTagRegistry(port) and waits for the initial listTags to resolve. */
async function renderLoadedRegistry(port = 31415): Promise<RenderHookResult<TagRegistry, void>['result']> {
  const { result } = renderHook(() => useTagRegistry(port));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

it('tags is [] and loading is true synchronously after mount, before listTags resolves', () => {
  mockListTags.mockReturnValue(new Promise(() => undefined));

  const { result } = renderHook(() => useTagRegistry(31415));

  expect(result.current.tags).toEqual([]);
  expect(result.current.loading).toBe(true);
});

it('tags equals the resolved array and loading is false once listTags resolves', async () => {
  mockListTags.mockResolvedValue([ALPHA_TAG]);

  const result = await renderLoadedRegistry();

  expect(result.current.tags).toEqual([{ name: 'alpha', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z' }]);
});

it('refresh() calls listTags(31415) a second time', async () => {
  mockListTags.mockResolvedValue([]);

  const result = await renderLoadedRegistry();
  await act(async () => {
    await result.current.refresh();
  });

  expect(mockListTags).toHaveBeenCalledTimes(2);
  expect(mockListTags).toHaveBeenCalledWith(31415);
});

it('create(name, color) calls createTag(31415, "beta", "red") once then refreshes', async () => {
  mockListTags.mockResolvedValue([]);
  mockCreateTag.mockResolvedValue({ name: 'beta', color: 'red', createdAt: '2026-01-01T00:00:00.000Z' });

  const result = await renderLoadedRegistry();
  await act(async () => {
    await result.current.create('beta', 'red');
  });

  expect(mockCreateTag).toHaveBeenCalledTimes(1);
  expect(mockCreateTag).toHaveBeenCalledWith(31415, 'beta', 'red');
  expect(mockListTags).toHaveBeenCalledTimes(2);
});

it('create(name) without a color passes undefined to createTag', async () => {
  mockListTags.mockResolvedValue([]);
  mockCreateTag.mockResolvedValue({ name: 'gamma', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z' });

  const result = await renderLoadedRegistry();
  await act(async () => {
    await result.current.create('gamma');
  });

  expect(mockCreateTag).toHaveBeenCalledTimes(1);
  expect(mockCreateTag).toHaveBeenCalledWith(31415, 'gamma', undefined);
});

it('update(name, { rename }) calls updateTag(31415, "alpha", { rename: "alpha2" }) once then refreshes', async () => {
  mockListTags.mockResolvedValue([]);
  mockUpdateTag.mockResolvedValue({ name: 'alpha2', color: 'blue', createdAt: '2026-01-01T00:00:00.000Z' });

  const result = await renderLoadedRegistry();
  await act(async () => {
    await result.current.update('alpha', { rename: 'alpha2' });
  });

  expect(mockUpdateTag).toHaveBeenCalledTimes(1);
  expect(mockUpdateTag).toHaveBeenCalledWith(31415, 'alpha', { rename: 'alpha2' });
  expect(mockListTags).toHaveBeenCalledTimes(2);
});

it('update(name, { color }) calls updateTag(31415, "alpha", { color: "green" }) exactly once', async () => {
  mockListTags.mockResolvedValue([]);
  mockUpdateTag.mockResolvedValue({ name: 'alpha', color: 'green', createdAt: '2026-01-01T00:00:00.000Z' });

  const result = await renderLoadedRegistry();
  await act(async () => {
    await result.current.update('alpha', { color: 'green' });
  });

  expect(mockUpdateTag).toHaveBeenCalledTimes(1);
  expect(mockUpdateTag).toHaveBeenCalledWith(31415, 'alpha', { color: 'green' });
});

it('remove(name) calls deleteTag(31415, "beta") once then refreshes', async () => {
  mockListTags.mockResolvedValue([]);
  mockDeleteTag.mockResolvedValue(undefined);

  const result = await renderLoadedRegistry();
  await act(async () => {
    await result.current.remove('beta');
  });

  expect(mockDeleteTag).toHaveBeenCalledTimes(1);
  expect(mockDeleteTag).toHaveBeenCalledWith(31415, 'beta');
  expect(mockListTags).toHaveBeenCalledTimes(2);
});

it('colorOf("alpha") returns "blue" from the loaded registry; colorOf("missing") falls back to "blue"', async () => {
  mockListTags.mockResolvedValue([ALPHA_TAG]);

  const result = await renderLoadedRegistry();

  expect(result.current.colorOf('alpha')).toBe('blue');
  expect(result.current.colorOf('missing')).toBe('blue');
});

it('a recolor applied via one useTagRegistry(port) instance is visible through colorOf on a second, independently-mounted instance for the same port (bug c: tag recolor sync)', async () => {
  mockListTags.mockResolvedValueOnce([ALPHA_TAG]);
  const sidebar = await renderLoadedRegistry();
  expect(sidebar.current.colorOf('alpha')).toBe('blue');

  // A second, independently-mounted consumer for the SAME port — mirrors
  // SessionSidebar + TagPopoverHost each calling useTagRegistry(port).
  mockListTags.mockResolvedValueOnce([ALPHA_TAG]);
  const popoverHost = await renderLoadedRegistry();

  // Recolor via the popover-host instance only — the sidebar instance never
  // calls update() or refresh() itself.
  const recolored = { ...ALPHA_TAG, color: 'green' as const };
  mockUpdateTag.mockResolvedValue(recolored);
  mockListTags.mockResolvedValueOnce([recolored]);
  await act(async () => {
    await popoverHost.current.update('alpha', { color: 'green' });
  });

  expect(sidebar.current.colorOf('alpha')).toBe('green');
});
