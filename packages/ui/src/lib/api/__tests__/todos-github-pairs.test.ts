/**
 * todos-github-pairs.test.ts
 *
 * `../todos-github`'s pairing/issues surface: listPairs/deletePair/
 * listIssues/importIssues/publishTask. Plugin routes return RAW JSON bodies
 * (no `ApiResponse<T>` envelope), base `/api/plugins/todos/github` (spec
 * "Wire contract"). Split from todos-github.test.ts (finding #13, todo #286)
 * — link lifecycle lives in todos-github-link.test.ts, sync/report in
 * todos-github-sync.test.ts.
 *
 * Behaviors covered (each asserting URL, method, body, and extracted field):
 *  1. listPairs — GET /pairs?projectId=; extracts `.pairs`.
 *  2. deletePair — DELETE /pairs/:todoId (204, no content).
 *  3. listIssues — GET /issues?projectId=; extracts `.issues`.
 *  4. importIssues — POST /import with {projectId, issueNumbers}; returns {imported, skipped} verbatim.
 *  5. publishTask — POST /publish with {projectId, todoId}; extracts `.pair`; propagates a 409.
 *
 * 204/error handling for plugin routes generally is pinned once in http-plugin.test.ts;
 * this file covers only this client's URL/body/field shape plus the 409 the wire
 * contract calls out by name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listPairs,
  deletePair,
  listIssues,
  importIssues,
  publishTask,
  type Pair,
  type RemoteIssue,
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
