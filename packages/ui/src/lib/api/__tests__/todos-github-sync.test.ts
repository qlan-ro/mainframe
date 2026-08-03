/**
 * todos-github-sync.test.ts
 *
 * `../todos-github`'s run surface: runSync/getReport. Plugin routes return
 * RAW JSON bodies (no `ApiResponse<T>` envelope), base
 * `/api/plugins/todos/github` (spec "Wire contract"). Split from
 * todos-github.test.ts (finding #13, todo #286) — link lifecycle lives in
 * todos-github-link.test.ts, pairs/issues in todos-github-pairs.test.ts.
 *
 * Behaviors covered (each asserting URL, method, body, and extracted field):
 *  1. runSync — POST /sync with {projectId}; extracts `.run`; propagates a 409.
 *  2. getReport — GET /report?projectId=[&runId=]; extracts `.report` (null when no report exists).
 *
 * 204/error handling for plugin routes generally is pinned once in http-plugin.test.ts;
 * this file covers only this client's URL/body/field shape plus the 409 the wire
 * contract calls out by name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSync, getReport, type RunSummary, type Report } from '../todos-github';
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
