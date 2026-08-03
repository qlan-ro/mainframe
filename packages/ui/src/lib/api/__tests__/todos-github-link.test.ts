/**
 * todos-github-link.test.ts
 *
 * `../todos-github`'s link lifecycle: getLink/linkRepo/unlinkRepo. Plugin
 * routes return RAW JSON bodies (no `ApiResponse<T>` envelope), base
 * `/api/plugins/todos/github` (spec "Wire contract"). Split from
 * todos-github.test.ts (finding #13, todo #286) — pairs/issues live in
 * todos-github-pairs.test.ts, sync/report in todos-github-sync.test.ts.
 *
 * Behaviors covered (each asserting URL, method, body, and extracted field):
 *  1. getLink — GET /link?projectId=; returns {link, running, latestRunId, workflowLabels} verbatim.
 *  2. linkRepo — PUT /link with the full input body; extracts `.link`; propagates a 409.
 *  3. unlinkRepo — DELETE /link?projectId= (204, no content).
 *
 * 204/error handling for plugin routes generally is pinned once in http-plugin.test.ts;
 * this file covers only this client's URL/body/field shape plus the 409 the wire
 * contract calls out by name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLink, linkRepo, unlinkRepo, type Link, type WorkflowLabelSet } from '../todos-github';
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

const LINK_FIXTURE: Link = {
  projectId: PROJECT_ID,
  owner: 'qlan-ro',
  repo: 'mainframe',
  remoteName: 'origin',
  credentialLabel: 'github',
  lastSyncedAt: '2026-07-31T00:00:00.000Z',
};

const WORKFLOW_LABELS_FIXTURE: WorkflowLabelSet = {
  prefixes: ['route:', 'gate:'],
  labels: ['ready-for-agent'],
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

describe('getLink', () => {
  it('calls GET /link with the projectId query param', async () => {
    mockFetchPluginOk({
      link: LINK_FIXTURE,
      running: false,
      latestRunId: 'run-1',
      workflowLabels: WORKFLOW_LABELS_FIXTURE,
    });

    await getLink(PORT, PROJECT_ID);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/plugins/todos/github/link?projectId=${PROJECT_ID}`,
      { method: 'GET' },
    );
  });

  it('returns {link, running, latestRunId, workflowLabels} verbatim', async () => {
    mockFetchPluginOk({
      link: LINK_FIXTURE,
      running: true,
      latestRunId: 'run-2',
      workflowLabels: WORKFLOW_LABELS_FIXTURE,
    });

    const result = await getLink(PORT, PROJECT_ID);

    expect(result).toEqual({
      link: LINK_FIXTURE,
      running: true,
      latestRunId: 'run-2',
      workflowLabels: WORKFLOW_LABELS_FIXTURE,
    });
  });

  it('returns a null link and null latestRunId for an unlinked project', async () => {
    mockFetchPluginOk({ link: null, running: false, latestRunId: null, workflowLabels: WORKFLOW_LABELS_FIXTURE });

    const result = await getLink(PORT, PROJECT_ID);

    expect(result.link).toBeNull();
    expect(result.latestRunId).toBeNull();
  });
});

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
