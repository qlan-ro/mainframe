/**
 * todos-github.test.ts
 *
 * Red-phase test for the GitHub sync plugin client (`../todos-github`, not yet
 * created — task 30 of the plan implements it against this file). Plugin
 * routes return RAW JSON bodies (no `ApiResponse<T>` envelope), base
 * `/api/plugins/todos/github` (spec "Wire contract").
 *
 * Behaviors covered (each asserting URL, method, body, and extracted field):
 *  1.  getLink — GET /link?projectId=; returns {link, running, latestRunId} verbatim.
 *  2.  linkRepo — PUT /link with the full input body; extracts `.link`; propagates a 409.
 *  3.  unlinkRepo — DELETE /link?projectId= (204, no content).
 *  4.  listPairs — GET /pairs?projectId=; extracts `.pairs`.
 *  5.  deletePair — DELETE /pairs/:todoId (204, no content).
 *  6.  listIssues — GET /issues?projectId=; extracts `.issues`.
 *  7.  importIssues — POST /import with {projectId, issueNumbers}; returns {imported, skipped} verbatim.
 *  8.  publishTask — POST /publish with {projectId, todoId}; extracts `.pair`; propagates a 409.
 *  9.  runSync — POST /sync with {projectId}; extracts `.run`; propagates a 409.
 *  10. getReport — GET /report?projectId=[&runId=]; extracts `.report` (null when no report exists).
 *
 * 204/error handling for plugin routes generally is pinned once in http-plugin.test.ts;
 * this file covers only this client's URL/body/field shape plus the 409s the wire
 * contract calls out by name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLink,
  linkRepo,
  unlinkRepo,
  listPairs,
  deletePair,
  listIssues,
  importIssues,
  publishTask,
  runSync,
  getReport,
  type Link,
  type Pair,
  type RemoteIssue,
  type RunSummary,
  type Report,
} from '../todos-github';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

const PORT = 31415;
const PROJECT_ID = 'proj-abc';
const TODO_ID = 'todo-xyz';

const LINK_FIXTURE: Link = {
  projectId: PROJECT_ID,
  owner: 'qlan-ro',
  repo: 'mainframe',
  remoteName: 'origin',
  credentialLabel: 'github',
  lastSyncedAt: '2026-07-31T00:00:00.000Z',
};

const PAIR_FIXTURE: Pair = {
  todoId: TODO_ID,
  todoNumber: 285,
  issueNumber: 219,
  issueUrl: 'https://github.com/qlan-ro/mainframe/issues/219',
  pairState: 'clean',
  stateReason: null,
};

const ISSUE_FIXTURE: RemoteIssue = {
  number: 42,
  title: 'Fix the login bug',
  labels: ['bug'],
  pairedTodoNumber: null,
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

const REPORT_FIXTURE: Report = {
  runId: 'run-1',
  finishedAt: '2026-07-31T14:22:00.000Z',
  pairsReconciled: 5,
  failure: null,
  rows: [],
};

function mockFetchPluginOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchNoContent(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }),
  );
}

function mockFetchConflict(message: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: message }),
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

// ---------------------------------------------------------------------------
// 1. getLink
// ---------------------------------------------------------------------------

describe('getLink', () => {
  it('calls GET /link with the projectId query param', async () => {
    mockFetchPluginOk({ link: LINK_FIXTURE, running: false, latestRunId: 'run-1' });

    await getLink(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/link?projectId=${PROJECT_ID}`,
      { method: 'GET' },
    );
  });

  it('returns {link, running, latestRunId} verbatim', async () => {
    mockFetchPluginOk({ link: LINK_FIXTURE, running: true, latestRunId: 'run-2' });

    const result = await getLink(PORT, PROJECT_ID);

    expect(result).toEqual({ link: LINK_FIXTURE, running: true, latestRunId: 'run-2' });
  });

  it('returns a null link and null latestRunId for an unlinked project', async () => {
    mockFetchPluginOk({ link: null, running: false, latestRunId: null });

    const result = await getLink(PORT, PROJECT_ID);

    expect(result).toEqual({ link: null, running: false, latestRunId: null });
  });
});

// ---------------------------------------------------------------------------
// 2. linkRepo
// ---------------------------------------------------------------------------

describe('linkRepo', () => {
  const INPUT = {
    projectId: PROJECT_ID,
    owner: 'qlan-ro',
    repo: 'mainframe',
    remoteName: 'origin',
    credentialLabel: 'github',
  };

  it('calls PUT /link with the full input body', async () => {
    mockFetchPluginOk({ link: LINK_FIXTURE });

    await linkRepo(PORT, INPUT);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/github/link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(INPUT),
    });
  });

  it('extracts and returns the .link field', async () => {
    mockFetchPluginOk({ link: LINK_FIXTURE });

    const result = await linkRepo(PORT, INPUT);

    expect(result).toEqual(LINK_FIXTURE);
  });

  it('propagates a 409 when the project is already linked', async () => {
    mockFetchConflict('Project is already linked to a repository');

    await expect(linkRepo(PORT, INPUT)).rejects.toThrow('Project is already linked to a repository');
  });
});

// ---------------------------------------------------------------------------
// 3. unlinkRepo
// ---------------------------------------------------------------------------

describe('unlinkRepo', () => {
  it('calls DELETE /link with the projectId query param', async () => {
    mockFetchNoContent();

    await unlinkRepo(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/link?projectId=${PROJECT_ID}`,
      { method: 'DELETE', headers: {} },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. listPairs
// ---------------------------------------------------------------------------

describe('listPairs', () => {
  it('calls GET /pairs with the projectId query param', async () => {
    mockFetchPluginOk({ pairs: [PAIR_FIXTURE] });

    await listPairs(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/pairs?projectId=${PROJECT_ID}`,
      { method: 'GET' },
    );
  });

  it('extracts and returns the .pairs array', async () => {
    mockFetchPluginOk({ pairs: [PAIR_FIXTURE] });

    const result = await listPairs(PORT, PROJECT_ID);

    expect(result).toEqual([PAIR_FIXTURE]);
  });
});

// ---------------------------------------------------------------------------
// 5. deletePair
// ---------------------------------------------------------------------------

describe('deletePair', () => {
  it('calls DELETE /pairs/:todoId', async () => {
    mockFetchNoContent();

    await deletePair(PORT, TODO_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/github/pairs/${TODO_ID}`, {
      method: 'DELETE',
      headers: {},
    });
  });
});

// ---------------------------------------------------------------------------
// 6. listIssues
// ---------------------------------------------------------------------------

describe('listIssues', () => {
  it('calls GET /issues with the projectId query param', async () => {
    mockFetchPluginOk({ issues: [ISSUE_FIXTURE] });

    await listIssues(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/issues?projectId=${PROJECT_ID}`,
      { method: 'GET' },
    );
  });

  it('extracts and returns the .issues array', async () => {
    mockFetchPluginOk({ issues: [ISSUE_FIXTURE] });

    const result = await listIssues(PORT, PROJECT_ID);

    expect(result).toEqual([ISSUE_FIXTURE]);
  });
});

// ---------------------------------------------------------------------------
// 7. importIssues
// ---------------------------------------------------------------------------

describe('importIssues', () => {
  it('calls POST /import with {projectId, issueNumbers}', async () => {
    mockFetchPluginOk({ imported: [], skipped: [] });

    await importIssues(PORT, PROJECT_ID, [42, 43]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/github/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, issueNumbers: [42, 43] }),
    });
  });

  it('returns {imported, skipped} verbatim', async () => {
    const body = {
      imported: [{ issueNumber: 42, todoId: TODO_ID, todoNumber: 286 }],
      skipped: [{ issueNumber: 43, reason: 'Already paired with task #219' }],
    };
    mockFetchPluginOk(body);

    const result = await importIssues(PORT, PROJECT_ID, [42, 43]);

    expect(result).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// 8. publishTask
// ---------------------------------------------------------------------------

describe('publishTask', () => {
  it('calls POST /publish with {projectId, todoId}', async () => {
    mockFetchPluginOk({ pair: PAIR_FIXTURE });

    await publishTask(PORT, PROJECT_ID, TODO_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/github/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, todoId: TODO_ID }),
    });
  });

  it('extracts and returns the .pair field', async () => {
    mockFetchPluginOk({ pair: PAIR_FIXTURE });

    const result = await publishTask(PORT, PROJECT_ID, TODO_ID);

    expect(result).toEqual(PAIR_FIXTURE);
  });

  it('propagates a 409 when the task is already paired', async () => {
    mockFetchConflict('Task is already paired');

    await expect(publishTask(PORT, PROJECT_ID, TODO_ID)).rejects.toThrow('Task is already paired');
  });
});

// ---------------------------------------------------------------------------
// 9. runSync
// ---------------------------------------------------------------------------

describe('runSync', () => {
  it('calls POST /sync with {projectId}', async () => {
    mockFetchPluginOk({ run: RUN_FIXTURE });

    await runSync(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:${PORT}/api/plugins/todos/github/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    });
  });

  it('extracts and returns the .run field', async () => {
    mockFetchPluginOk({ run: RUN_FIXTURE });

    const result = await runSync(PORT, PROJECT_ID);

    expect(result).toEqual(RUN_FIXTURE);
  });

  it('propagates a 409 while a run is already in progress', async () => {
    mockFetchConflict('A sync run is already in progress');

    await expect(runSync(PORT, PROJECT_ID)).rejects.toThrow('A sync run is already in progress');
  });
});

// ---------------------------------------------------------------------------
// 10. getReport
// ---------------------------------------------------------------------------

describe('getReport', () => {
  it('calls GET /report with only the projectId query param when no runId is given', async () => {
    mockFetchPluginOk({ report: REPORT_FIXTURE });

    await getReport(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/report?projectId=${PROJECT_ID}`,
      { method: 'GET' },
    );
  });

  it('appends &runId= when a runId is given', async () => {
    mockFetchPluginOk({ report: REPORT_FIXTURE });

    await getReport(PORT, PROJECT_ID, 'run-1');

    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/report?projectId=${PROJECT_ID}&runId=run-1`,
      { method: 'GET' },
    );
  });

  it('extracts and returns the .report field', async () => {
    mockFetchPluginOk({ report: REPORT_FIXTURE });

    const result = await getReport(PORT, PROJECT_ID);

    expect(result).toEqual(REPORT_FIXTURE);
  });

  it('returns null when no report exists yet', async () => {
    mockFetchPluginOk({ report: null });

    const result = await getReport(PORT, PROJECT_ID);

    expect(result).toBeNull();
  });
});
