// @vitest-environment jsdom
/**
 * use-github-sync-store-dialog.test.ts
 *
 * `../use-github-sync-store`'s dialog and banner state. Split from
 * use-github-sync-store.test.ts (finding #13, todo #286) — init/load lives
 * in use-github-sync-store-load.test.ts, link/task mutations in
 * use-github-sync-store-mutations.test.ts.
 *
 * Behaviors covered:
 *  1. openDialog / closeDialog — sets and clears `dialog`.
 *  2. openDialog — the token dialog keeps its `returnTo` target and fetches nothing.
 *  3. dismissBanner — sets `bannerDismissed` to true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/api/todos-github', () => ({
  getLink: vi.fn(),
  linkRepo: vi.fn(),
  unlinkRepo: vi.fn(),
  listPairs: vi.fn(),
  deletePair: vi.fn(),
  listIssues: vi.fn(),
  importIssues: vi.fn(),
  publishTask: vi.fn(),
  runSync: vi.fn(),
  getReport: vi.fn(),
}));

vi.mock('../../use-todos-store', () => ({
  useTodosStore: { getState: () => ({ load: vi.fn() }) },
}));

import { useGitHubSyncStore } from '../use-github-sync-store';
import * as githubApi from '@/lib/api/todos-github';

const INITIAL_STATE = {
  port: null,
  projectId: null,
  link: null,
  workflowLabels: { prefixes: [], labels: [] },
  pairs: {},
  running: false,
  lastRun: null,
  report: null,
  issues: [],
  loading: false,
  error: null,
  errorAuth: false,
  dialog: null,
  bannerDismissed: false,
};

beforeEach(() => {
  act(() => {
    useGitHubSyncStore.setState(INITIAL_STATE);
  });
  vi.clearAllMocks();
});

describe('useGitHubSyncStore.openDialog / closeDialog', () => {
  it('opens a dialog by kind and clears it on close', () => {
    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.openDialog({ kind: 'import' });
    });
    expect(result.current.dialog).toEqual({ kind: 'import' });

    act(() => {
      result.current.closeDialog();
    });
    expect(result.current.dialog).toBeNull();
  });
});

describe('useGitHubSyncStore.openDialog — token dialog', () => {
  it('keeps the return target so a saved token can flow back into the import dialog', () => {
    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.openDialog({ kind: 'token', returnTo: 'import' });
    });

    expect(result.current.dialog).toEqual({ kind: 'token', returnTo: 'import' });
  });

  it('fetches nothing — the token dialog reads no remote state', () => {
    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.init(31415, 'proj-abc');
      result.current.openDialog({ kind: 'token' });
    });

    expect(githubApi.listIssues).not.toHaveBeenCalled();
    expect(githubApi.getReport).not.toHaveBeenCalled();
  });
});

describe('useGitHubSyncStore.dismissBanner', () => {
  it('sets bannerDismissed to true', () => {
    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.dismissBanner();
    });

    expect(result.current.bannerDismissed).toBe(true);
  });
});
