// @vitest-environment jsdom
/**
 * use-github-sync-store-load.test.ts
 *
 * `../use-github-sync-store`'s init and load lifecycle. Split from
 * use-github-sync-store.test.ts (finding #13, todo #286) — link/task
 * mutations live in use-github-sync-store-mutations.test.ts, dialog/banner
 * state in use-github-sync-store-dialog.test.ts.
 *
 * Behaviors covered:
 *  1. init — sets port and projectId, leaves everything else untouched.
 *  2. load — success sets link, running, and pairs (keyed by todoId); loading false, error null.
 *  3. load — error sets error and loading false, leaves link/pairs untouched.
 *  4. load — stale-completion guard: an earlier, slower load's result is dropped once a newer load starts.
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
import type { Link, Pair, WorkflowLabelSet } from '@/lib/api/todos-github';

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

describe('useGitHubSyncStore.load — success', () => {
  it('sets link, running, pairs keyed by todoId, and workflowLabels', async () => {
    vi.mocked(githubApi.getLink).mockResolvedValue({
      link: LINK_FIXTURE,
      running: true,
      latestRunId: 'run-1',
      workflowLabels: WORKFLOW_LABELS_FIXTURE,
    });
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
    expect(result.current.workflowLabels).toEqual(WORKFLOW_LABELS_FIXTURE);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls getLink and listPairs with the initialized port and projectId', async () => {
    vi.mocked(githubApi.getLink).mockResolvedValue({
      link: null,
      running: false,
      latestRunId: null,
      workflowLabels: WORKFLOW_LABELS_FIXTURE,
    });
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

describe('useGitHubSyncStore.load — stale-completion guard', () => {
  it('drops an earlier, slower load once a newer load has started', async () => {
    type LoadResult = {
      link: Link | null;
      running: boolean;
      latestRunId: string | null;
      workflowLabels: WorkflowLabelSet;
    };
    let resolveSlow!: (v: LoadResult) => void;
    const slowPromise = new Promise<LoadResult>((res) => {
      resolveSlow = res;
    });
    vi.mocked(githubApi.listPairs).mockResolvedValue([]);
    vi.mocked(githubApi.getLink)
      .mockImplementationOnce(() => slowPromise)
      .mockResolvedValueOnce({
        link: LINK_FIXTURE,
        running: false,
        latestRunId: 'run-2',
        workflowLabels: WORKFLOW_LABELS_FIXTURE,
      });

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
      resolveSlow({
        link: { ...LINK_FIXTURE, owner: 'stale-owner' },
        running: true,
        latestRunId: 'run-1',
        workflowLabels: WORKFLOW_LABELS_FIXTURE,
      });
      await p1;
    });

    expect(result.current.link).toEqual(LINK_FIXTURE);
  });
});
