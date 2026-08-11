// @vitest-environment jsdom
/**
 * use-github-sync-store-issues.test.ts
 *
 * `../use-github-sync-store`'s issue fetch and its failure classification.
 * Split out of use-github-sync-store-mutations.test.ts when the token-repair
 * flow landed — init/load lives in use-github-sync-store-load.test.ts, dialog
 * and banner state in use-github-sync-store-dialog.test.ts.
 *
 * Behaviors covered:
 *  1. loadIssues — calls the client and sets `issues`; never refetches the todos store.
 *  2. loadIssues — a 503 from the daemon is GitHub refusing the credential: the raw
 *     body is replaced by the repair-friendly sentence and `errorAuth` is set.
 *  3. loadIssues — any other failure keeps its own message and leaves `errorAuth` false.
 *  4. loadIssues / load — both clear a stale error and `errorAuth` on a fresh attempt.
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

const mockTodosLoad = vi.fn();
vi.mock('../../use-todos-store', () => ({
  useTodosStore: { getState: () => ({ load: mockTodosLoad }) },
}));

import { useGitHubSyncStore } from '../use-github-sync-store';
import { ApiRequestError } from '@/lib/api/http';
import * as githubApi from '@/lib/api/todos-github';
import type { RemoteIssue } from '@/lib/api/todos-github';

const PORT = 31415;
const PROJECT_ID = 'proj-abc';

const ISSUE_FIXTURE: RemoteIssue = { number: 42, title: 'Fix the login bug', labels: ['bug'], pairedTodoNumber: null };

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

/** The store hook with port and projectId already set — every case below needs both. */
function initializedStore(): { current: ReturnType<typeof useGitHubSyncStore.getState> } {
  const { result } = renderHook(() => useGitHubSyncStore());
  act(() => {
    result.current.init(PORT, PROJECT_ID);
  });
  return result;
}

describe('useGitHubSyncStore.loadIssues — success', () => {
  it('calls listIssues and sets issues, without refetching the todos store', async () => {
    vi.mocked(githubApi.listIssues).mockResolvedValue([ISSUE_FIXTURE]);

    const result = initializedStore();
    await act(async () => {
      await result.current.loadIssues();
    });

    expect(githubApi.listIssues).toHaveBeenCalledWith(PORT, PROJECT_ID);
    expect(result.current.issues).toEqual([ISSUE_FIXTURE]);
    expect(mockTodosLoad).not.toHaveBeenCalled();
  });
});

describe('useGitHubSyncStore.loadIssues — rejected credential', () => {
  it('replaces a 503 with the repair-friendly sentence and flags it as an auth failure', async () => {
    vi.mocked(githubApi.listIssues).mockRejectedValue(
      new ApiRequestError('GitHub API 401: {"message":"Bad credentials"}', [], 503),
    );

    const result = initializedStore();
    await act(async () => {
      await result.current.loadIssues();
    });

    expect(result.current.error).toBe(
      'GitHub rejected the stored credential — the token is missing, expired, or revoked.',
    );
    expect(result.current.errorAuth).toBe(true);
  });
});

describe('useGitHubSyncStore.loadIssues — other failures', () => {
  it('keeps the raw message and leaves errorAuth false for a non-503 API error', async () => {
    vi.mocked(githubApi.listIssues).mockRejectedValue(new ApiRequestError('internal server error', [], 500));

    const result = initializedStore();
    await act(async () => {
      await result.current.loadIssues();
    });

    expect(result.current.error).toBe('internal server error');
    expect(result.current.errorAuth).toBe(false);
  });

  it('keeps the raw message and leaves errorAuth false for a transport error', async () => {
    vi.mocked(githubApi.listIssues).mockRejectedValue(new Error('daemon unreachable'));

    const result = initializedStore();
    await act(async () => {
      await result.current.loadIssues();
    });

    expect(result.current.error).toBe('daemon unreachable');
    expect(result.current.errorAuth).toBe(false);
  });
});

describe('useGitHubSyncStore — clearing a stale issue-fetch failure', () => {
  it('clears the error and the auth flag once a retry succeeds', async () => {
    vi.mocked(githubApi.listIssues)
      .mockRejectedValueOnce(new ApiRequestError('GitHub API 401', [], 503))
      .mockResolvedValueOnce([]);

    const result = initializedStore();
    await act(async () => {
      await result.current.loadIssues();
    });
    expect(result.current.errorAuth).toBe(true);

    await act(async () => {
      await result.current.loadIssues();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.errorAuth).toBe(false);
    expect(result.current.issues).toEqual([]);
  });

  it('clears the error and the auth flag when the sync state reloads', async () => {
    vi.mocked(githubApi.listIssues).mockRejectedValue(new ApiRequestError('GitHub API 401', [], 503));
    vi.mocked(githubApi.getLink).mockResolvedValue({
      link: null,
      running: false,
      latestRunId: null,
      workflowLabels: { prefixes: [], labels: [] },
    });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const result = initializedStore();
    await act(async () => {
      await result.current.loadIssues();
    });
    expect(result.current.errorAuth).toBe(true);

    await act(async () => {
      await result.current.load();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.errorAuth).toBe(false);
  });
});
