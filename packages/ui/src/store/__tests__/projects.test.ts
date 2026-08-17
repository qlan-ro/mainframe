// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/projects', () => ({ getProjects: vi.fn() }));

import { getProjects } from '@/lib/api/projects';
import { useProjectsStore, reloadProjects, removeProjectFromList, resetProjectsStore } from '../projects.js';

const mockGetProjects = vi.mocked(getProjects);

const project = (id: string) => ({ id, name: id, path: `/r/${id}`, createdAt: '', lastOpenedAt: '' });

describe('ui projects store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectsStore();
  });

  it('starts empty and loading', () => {
    expect(useProjectsStore.getState()).toEqual({ projects: [], loading: true });
  });

  it('reloadProjects fetches and applies the list', async () => {
    mockGetProjects.mockResolvedValue([project('p1')]);
    await reloadProjects(31415);
    expect(mockGetProjects).toHaveBeenCalledWith(31415);
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(['p1']);
    expect(useProjectsStore.getState().loading).toBe(false);
  });

  it('leaves the list empty and clears loading when the fetch rejects', async () => {
    mockGetProjects.mockRejectedValue(new Error('boom'));
    await reloadProjects(31415);
    expect(useProjectsStore.getState().projects).toEqual([]);
    expect(useProjectsStore.getState().loading).toBe(false);
  });

  it('removeProjectFromList drops the matching id', async () => {
    mockGetProjects.mockResolvedValue([project('p1'), project('p2')]);
    await reloadProjects(31415);
    removeProjectFromList('p1');
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('applies only the most recently-issued reload, even if an earlier one resolves last', async () => {
    // Different ports so the second call can't dedupe onto the first's in-flight request.
    let resolveFirst: (list: ReturnType<typeof project>[]) => void = () => undefined;
    mockGetProjects.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = res;
        }),
    );
    const first = reloadProjects(31415);

    mockGetProjects.mockResolvedValueOnce([project('p2')]);
    const second = reloadProjects(31416);
    await second;
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(['p2']);

    resolveFirst([project('p1')]);
    await first;
    // The stale first response must not overwrite the newer second one.
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('dedupes concurrent calls on the same port into a single request', async () => {
    let resolveFetch: (list: ReturnType<typeof project>[]) => void = () => undefined;
    mockGetProjects.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );

    const first = reloadProjects(31415);
    const second = reloadProjects(31415);
    const third = reloadProjects(31415);
    expect(mockGetProjects).toHaveBeenCalledTimes(1);

    resolveFetch([project('p1')]);
    await Promise.all([first, second, third]);

    expect(mockGetProjects).toHaveBeenCalledTimes(1);
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(['p1']);
  });

  it('issues a fresh fetch for a reload requested after the previous one settled', async () => {
    mockGetProjects.mockResolvedValueOnce([project('p1')]).mockResolvedValueOnce([project('p2')]);

    await reloadProjects(31415);
    await reloadProjects(31415);

    expect(mockGetProjects).toHaveBeenCalledTimes(2);
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('does not flip loading back to true for a reload issued after the initial load settled', async () => {
    // `loading` means "the initial load hasn't resolved yet" — a component gated on
    // it (e.g. ChatSurface's first-run hero) must not see it bounce back to true on
    // every later reload, or a fresh mount of that same gate re-fires its own reload
    // and the two flip each other forever (the sessions-draft.spec.ts regression).
    mockGetProjects.mockResolvedValueOnce([project('p1')]);
    await reloadProjects(31415);
    expect(useProjectsStore.getState().loading).toBe(false);

    let resolveSecond: (list: ReturnType<typeof project>[]) => void = () => undefined;
    mockGetProjects.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveSecond = res;
        }),
    );
    const second = reloadProjects(31415);
    expect(useProjectsStore.getState().loading).toBe(false);

    resolveSecond([project('p2')]);
    await second;
    expect(useProjectsStore.getState().loading).toBe(false);
  });
});
