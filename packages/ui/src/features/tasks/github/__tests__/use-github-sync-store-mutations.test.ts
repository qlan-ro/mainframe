// @vitest-environment jsdom
/**
 * use-github-sync-store-mutations.test.ts
 *
 * `../use-github-sync-store`'s link/task/run mutations. Split from
 * use-github-sync-store.test.ts (finding #13, todo #286) — init/load lives
 * in use-github-sync-store-load.test.ts, dialog/banner state in
 * use-github-sync-store-dialog.test.ts, the issue fetch and its failure
 * classification in use-github-sync-store-issues.test.ts.
 *
 * Behaviors covered:
 *  - linkRepo/unlinkRepo — call the client then refetch this store's own load, never the todos store.
 *  - importIssues/publish/unlinkPair — call the client, refetch this store's load, AND the todos store.
 *  - sync — sets running true during the call and false after, sets lastRun, refetches both stores.
 *  - sync running gating — a second call while already running is refused (client not called again).
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
import * as githubApi from '@/lib/api/todos-github';
import type { Link, Pair, RunSummary, WorkflowLabelSet } from '@/lib/api/todos-github';

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

const WORKFLOW_LABELS_FIXTURE: WorkflowLabelSet = { prefixes: ['route:'], labels: ['ready-for-agent'] };

const PAIR_A: Pair = {
  todoId: 'todo-a',
  todoNumber: 285,
  issueNumber: 219,
  issueUrl: 'https://github.com/qlan-ro/mainframe/issues/219',
  pairState: 'clean',
  stateReason: null,
};

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

const mockGetLink = (link: Link | null): void => {
  vi.mocked(githubApi.getLink).mockResolvedValue({
    link,
    running: false,
    latestRunId: null,
    workflowLabels: WORKFLOW_LABELS_FIXTURE,
  });
};

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
    mockGetLink(LINK_FIXTURE);
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

describe('useGitHubSyncStore.unlinkRepo', () => {
  it('calls unlinkRepo then refetches its own load, without refetching the todos store', async () => {
    vi.mocked(githubApi.unlinkRepo).mockResolvedValue(undefined);
    mockGetLink(null);
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

describe('useGitHubSyncStore.importIssues', () => {
  it('calls importIssues, refetches its own load, AND refetches the todos store', async () => {
    vi.mocked(githubApi.importIssues).mockResolvedValue({
      imported: [{ issueNumber: 42, todoId: 'todo-a', todoNumber: 286 }],
      skipped: [],
    });
    mockGetLink(LINK_FIXTURE);
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

describe('useGitHubSyncStore.publish', () => {
  it('calls publishTask, refetches its own load, AND refetches the todos store', async () => {
    vi.mocked(githubApi.publishTask).mockResolvedValue(PAIR_A);
    mockGetLink(LINK_FIXTURE);
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

describe('useGitHubSyncStore.unlinkPair', () => {
  it('calls deletePair, refetches its own load, AND refetches the todos store', async () => {
    vi.mocked(githubApi.deletePair).mockResolvedValue(undefined);
    mockGetLink(LINK_FIXTURE);
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

describe('useGitHubSyncStore.sync', () => {
  it('sets running true during the call, sets lastRun and running false after, and refetches both stores', async () => {
    mockGetLink(LINK_FIXTURE);
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

describe('useGitHubSyncStore.sync — running gating', () => {
  it('refuses a second sync while one is already running', async () => {
    mockGetLink(LINK_FIXTURE);
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
