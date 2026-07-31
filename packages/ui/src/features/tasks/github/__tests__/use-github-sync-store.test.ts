// @vitest-environment jsdom
/**
 * use-github-sync-store.test.ts
 *
 * Red-phase test for the GitHub sync zustand store (`../use-github-sync-store`,
 * not yet created — task 32 of the plan implements it against this file, per
 * the frozen module contract in the plan's "UI module contract" section).
 *
 * Behaviors covered:
 *  1.  init — sets port and projectId, leaves everything else untouched.
 *  2.  load — success sets link, running, and pairs (keyed by todoId); loading false, error null.
 *  3.  load — error sets error and loading false, leaves link/pairs untouched.
 *  4.  load — stale-completion guard: an earlier, slower load's result is dropped once a newer load starts.
 *  5.  linkRepo — calls the client then refetches its own load; does NOT refetch the todos store.
 *  6.  unlinkRepo — calls the client then refetches its own load; does NOT refetch the todos store.
 *  7.  loadIssues — calls the client and sets `issues`; does NOT refetch the todos store.
 *  8.  importIssues — calls the client, refetches its own load, AND refetches the todos store.
 *  9.  publish — calls the client, refetches its own load, AND refetches the todos store.
 *  10. unlinkPair — calls the client, refetches its own load, AND refetches the todos store.
 *  11. sync — sets running true during the call and false after; sets lastRun; refetches its
 *      own load AND the todos store.
 *  12. sync — running gating: a second call while `running` is already true is refused (the
 *      client function is not called again).
 *  13. openDialog / closeDialog — sets and clears `dialog`.
 *  14. dismissBanner — sets `bannerDismissed` to true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the API client and the todos store BEFORE importing the store under test
// ---------------------------------------------------------------------------

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
vi.mock('../use-todos-store', () => ({
  useTodosStore: { getState: () => ({ load: mockTodosLoad }) },
}));

import { useGitHubSyncStore } from '../use-github-sync-store';
import * as githubApi from '@/lib/api/todos-github';
import type { Link, Pair, RemoteIssue, RunSummary } from '@/lib/api/todos-github';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-abc';

const LINK_FIXTURE: Link = {
  projectId: PROJECT_ID,
  owner: 'qlan-ro',
  repo: 'mainframe',
  remoteName: 'origin',
  credentialLabel: 'github',
  lastSyncedAt: null,
};

const PAIR_A: Pair = {
  todoId: 'todo-a',
  todoNumber: 285,
  issueNumber: 219,
  issueUrl: 'https://github.com/qlan-ro/mainframe/issues/219',
  pairState: 'clean',
  stateReason: null,
};

const ISSUE_FIXTURE: RemoteIssue = { number: 42, title: 'Fix the login bug', labels: ['bug'], pairedTodoNumber: null };

const RUN_FIXTURE: RunSummary = {
  runId: 'run-1',
  finishedAt: '2026-07-31T14:22:00.000Z',
  pairsReconciled: 5,
  overwrites: 4,
  failure: null,
  reached: 5,
  total: 5,
};

const INITIAL_STATE = {
  port: null,
  projectId: null,
  link: null,
  pairs: {},
  running: false,
  lastRun: null,
  report: null,
  issues: [],
  loading: false,
  error: null,
  dialog: null,
  bannerDismissed: false,
};

beforeEach(() => {
  act(() => {
    useGitHubSyncStore.setState(INITIAL_STATE);
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. init
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.init', () => {
  it('sets port and projectId', () => {
    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    expect(result.current.port).toBe(PORT);
    expect(result.current.projectId).toBe(PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. load — success
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.load — success', () => {
  it('sets link, running, and pairs keyed by todoId', async () => {
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: true, latestRunId: 'run-1' });
    vi.mocked(githubApi.listPairs).mockResolvedValue([PAIR_A]);

    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });
    await act(async () => {
      await result.current.load();
    });

    expect(result.current.link).toEqual(LINK_FIXTURE);
    expect(result.current.running).toBe(true);
    expect(result.current.pairs).toEqual({ 'todo-a': PAIR_A });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls getLink and listPairs with the initialized port and projectId', async () => {
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: null, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });
    await act(async () => {
      await result.current.load();
    });

    expect(githubApi.getLink).toHaveBeenCalledWith(PORT, PROJECT_ID);
    expect(githubApi.listPairs).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 3. load — error
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.load — error', () => {
  it('sets error and loading false when getLink throws', async () => {
    vi.mocked(githubApi.getLink).mockRejectedValue(new Error('daemon unreachable'));
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });
    await act(async () => {
      await result.current.load();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('daemon unreachable');
    expect(result.current.link).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. load — stale-completion guard
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.load — stale-completion guard', () => {
  it('drops an earlier, slower load once a newer load has started', async () => {
    let resolveSlow!: (v: { link: Link | null; running: boolean; latestRunId: string | null }) => void;
    const slowPromise = new Promise<{ link: Link | null; running: boolean; latestRunId: string | null }>((res) => {
      resolveSlow = res;
    });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);
    vi.mocked(githubApi.getLink)
      .mockImplementationOnce(() => slowPromise)
      .mockResolvedValueOnce({ link: LINK_FIXTURE, running: false, latestRunId: 'run-2' });

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    let p1!: Promise<void>;
    act(() => {
      p1 = result.current.load();
    });

    await act(async () => {
      await result.current.load();
    });

    await act(async () => {
      resolveSlow({ link: { ...LINK_FIXTURE, owner: 'stale-owner' }, running: true, latestRunId: 'run-1' });
      await p1;
    });

    expect(result.current.link).toEqual(LINK_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// 5. linkRepo
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.linkRepo', () => {
  it('calls linkRepo then refetches its own load, without refetching the todos store', async () => {
    const input = {
      projectId: PROJECT_ID,
      owner: 'qlan-ro',
      repo: 'mainframe',
      remoteName: 'origin',
      credentialLabel: 'github',
    };
    vi.mocked(githubApi.linkRepo).mockResolvedValue(LINK_FIXTURE);
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.linkRepo(input);
    });

    expect(githubApi.linkRepo).toHaveBeenCalledWith(PORT, input);
    expect(githubApi.getLink).toHaveBeenCalledOnce();
    expect(result.current.link).toEqual(LINK_FIXTURE);
    expect(mockTodosLoad).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. unlinkRepo
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.unlinkRepo', () => {
  it('calls unlinkRepo then refetches its own load, without refetching the todos store', async () => {
    vi.mocked(githubApi.unlinkRepo).mockResolvedValue(undefined);
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: null, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.unlinkRepo();
    });

    expect(githubApi.unlinkRepo).toHaveBeenCalledWith(PORT, PROJECT_ID);
    expect(githubApi.getLink).toHaveBeenCalledOnce();
    expect(result.current.link).toBeNull();
    expect(mockTodosLoad).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. loadIssues
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.loadIssues', () => {
  it('calls listIssues and sets issues, without refetching the todos store', async () => {
    vi.mocked(githubApi.listIssues).mockResolvedValue([ISSUE_FIXTURE]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.loadIssues();
    });

    expect(githubApi.listIssues).toHaveBeenCalledWith(PORT, PROJECT_ID);
    expect(result.current.issues).toEqual([ISSUE_FIXTURE]);
    expect(mockTodosLoad).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. importIssues
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.importIssues', () => {
  it('calls importIssues, refetches its own load, AND refetches the todos store', async () => {
    vi.mocked(githubApi.importIssues).mockResolvedValue({
      imported: [{ issueNumber: 42, todoId: 'todo-a', todoNumber: 286 }],
      skipped: [],
    });
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([PAIR_A]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.importIssues([42]);
    });

    expect(githubApi.importIssues).toHaveBeenCalledWith(PORT, PROJECT_ID, [42]);
    expect(githubApi.listPairs).toHaveBeenCalledOnce();
    expect(mockTodosLoad).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 9. publish
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.publish', () => {
  it('calls publishTask, refetches its own load, AND refetches the todos store', async () => {
    vi.mocked(githubApi.publishTask).mockResolvedValue(PAIR_A);
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([PAIR_A]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.publish('todo-a');
    });

    expect(githubApi.publishTask).toHaveBeenCalledWith(PORT, PROJECT_ID, 'todo-a');
    expect(githubApi.listPairs).toHaveBeenCalledOnce();
    expect(mockTodosLoad).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 10. unlinkPair
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.unlinkPair', () => {
  it('calls deletePair, refetches its own load, AND refetches the todos store', async () => {
    vi.mocked(githubApi.deletePair).mockResolvedValue(undefined);
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.unlinkPair('todo-a');
    });

    expect(githubApi.deletePair).toHaveBeenCalledWith(PORT, 'todo-a');
    expect(githubApi.listPairs).toHaveBeenCalledOnce();
    expect(mockTodosLoad).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 11. sync
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.sync', () => {
  it('sets running true during the call, sets lastRun and running false after, and refetches both stores', async () => {
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: false, latestRunId: 'run-1' });
    vi.mocked(githubApi.listPairs).mockResolvedValue([PAIR_A]);
    let resolveSync!: (v: RunSummary) => void;
    vi.mocked(githubApi.runSync).mockImplementation(
      () =>
        new Promise((res) => {
          resolveSync = res;
        }),
    );

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
    });

    let syncPromise!: Promise<void>;
    act(() => {
      syncPromise = result.current.sync();
    });

    expect(result.current.running).toBe(true);

    await act(async () => {
      resolveSync(RUN_FIXTURE);
      await syncPromise;
    });

    expect(githubApi.runSync).toHaveBeenCalledWith(PORT, PROJECT_ID);
    expect(result.current.running).toBe(false);
    expect(result.current.lastRun).toEqual(RUN_FIXTURE);
    expect(mockTodosLoad).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 12. sync — running gating
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.sync — running gating', () => {
  it('refuses a second sync while one is already running', async () => {
    vi.mocked(githubApi.getLink).mockResolvedValue({ link: LINK_FIXTURE, running: false, latestRunId: null });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);

    const { result } = renderHook(() => useGitHubSyncStore());
    act(() => {
      result.current.init(PORT, PROJECT_ID);
      useGitHubSyncStore.setState({ running: true });
    });

    await act(async () => {
      await result.current.sync();
    });

    expect(githubApi.runSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 13. openDialog / closeDialog
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 14. dismissBanner
// ---------------------------------------------------------------------------

describe('useGitHubSyncStore.dismissBanner', () => {
  it('sets bannerDismissed to true', () => {
    const { result } = renderHook(() => useGitHubSyncStore());

    act(() => {
      result.current.dismissBanner();
    });

    expect(result.current.bannerDismissed).toBe(true);
  });
});
