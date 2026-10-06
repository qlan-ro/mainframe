// @vitest-environment jsdom
/**
 * useAutomationsLibrary — subscribes one surface to one scope's entry,
 * loading on mount and on every scope change; does nothing while `enabled`
 * is false. The modal passes its own project (gated on `open`); the sidebar
 * list passes `soleProjectId ?? 'all'`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createFakeGateway as fakeGateway } from './fake-gateway';
import { useAutomationsStore, selectLibrary } from '../use-automations-store';
import { useAutomationsLibrary } from '../use-automations-library';

const defFixture = (id: string) => ({
  id,
  name: id,
  scope: 'global' as const,
  projectId: null,
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(() => {
  useAutomationsStore.setState({
    libraries: {},
    runRevisions: {},
    interactions: [],
    catalog: [],
    credentials: [],
    scopeProjectId: null,
  });
});

describe('useAutomationsLibrary', () => {
  it('loads the given scope on mount', async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'all-def')] }));

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) => useAutomationsLibrary(projectId, true),
      {
        initialProps: { projectId: 'proj-a' },
      },
    );

    await vi.waitFor(() => expect(result.current.definitions.map((d) => d.id)).toEqual(['proj-a']));
    rerender({ projectId: 'proj-a' }); // no-op re-render, still loaded
    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions).toHaveLength(1);
  });

  it("reloads when the scope changes, leaving the old scope's entry in place", async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'all-def')] }));

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) => useAutomationsLibrary(projectId, true),
      {
        initialProps: { projectId: 'proj-a' as string | null },
      },
    );
    await vi.waitFor(() => expect(result.current.definitions.map((d) => d.id)).toEqual(['proj-a']));

    rerender({ projectId: 'proj-b' });
    await vi.waitFor(() => expect(result.current.definitions.map((d) => d.id)).toEqual(['proj-b']));

    // proj-a's entry is still there — neither load evicted the other.
    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['proj-a']);
  });

  it('does nothing while enabled is false — no load is triggered', () => {
    const listAutomations = vi.fn(async () => [defFixture('x')]);
    useAutomationsStore.getState().setGateway(fakeGateway({ listAutomations }));

    renderHook(() => useAutomationsLibrary('proj-a', false));

    expect(listAutomations).not.toHaveBeenCalled();
    expect(useAutomationsStore.getState().libraries).toEqual({});
  });

  it('starts loading once enabled flips to true', async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'all-def')] }));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAutomationsLibrary('proj-a', enabled),
      {
        initialProps: { enabled: false },
      },
    );
    expect(useAutomationsStore.getState().libraries).toEqual({});

    rerender({ enabled: true });
    await vi.waitFor(() => expect(result.current.definitions.map((d) => d.id)).toEqual(['proj-a']));
  });

  it("returns that scope's entry, not a different one", async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'all-def')] }));

    const { result } = renderHook(() => useAutomationsLibrary(null, true));
    await vi.waitFor(() => expect(result.current.definitions.map((d) => d.id)).toEqual(['all-def']));
  });
});
