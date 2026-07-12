import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AutomationCreateInput, AutomationSummary } from '@qlan-ro/mainframe-types';
import {
  listAutomations,
  createAutomation,
  getAutomation,
  updateAutomation,
  deleteAutomation,
  setAutomationEnabled,
  startAutomationRun,
  listAutomationRuns,
  getAutomationRun,
  cancelAutomationRun,
  listAutomationInteractions,
  respondAutomationInteraction,
  listAutomationActions,
  listAutomationCredentialLabels,
  getAutomationCredential,
  putAutomationCredential,
  deleteAutomationCredential,
} from '../automations';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

const AUTOMATION_FIXTURE: AutomationSummary = {
  id: 'auto-1',
  name: 'Daily standup',
  scope: 'global',
  projectId: null,
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 1,
  updatedAt: 1,
};

const CREATE_INPUT: AutomationCreateInput = {
  name: 'Daily standup',
  scope: 'global',
  definition: { triggers: [], steps: [] },
};

function mockFetchOk(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    }),
  );
}

function mockFetchEmptyOk(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }),
  );
}

function mockFetchHttpError(status: number, error: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ error }),
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

describe('listAutomations', () => {
  it('calls GET /api/automations against the active daemon', async () => {
    mockFetchOk([AUTOMATION_FIXTURE]);

    const result = await listAutomations();

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations', { method: 'GET' });
    expect(result).toEqual([AUTOMATION_FIXTURE]);
  });

  it('throws when the HTTP response is not ok', async () => {
    mockFetchHttpError(503, 'automation service not available');
    await expect(listAutomations()).rejects.toThrow('automation service not available');
  });
});

describe('createAutomation', () => {
  it('sends POST /api/automations with the create input as the body', async () => {
    mockFetchOk(AUTOMATION_FIXTURE);

    const result = await createAutomation(CREATE_INPUT);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREATE_INPUT),
    });
    expect(result).toEqual(AUTOMATION_FIXTURE);
  });
});

describe('getAutomation', () => {
  it('calls GET /api/automations/:id, URI-encoding the id', async () => {
    mockFetchOk(AUTOMATION_FIXTURE);
    await getAutomation('auto 1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations/auto%201', { method: 'GET' });
  });
});

describe('updateAutomation', () => {
  it('sends PUT /api/automations/:id with the create input as the body', async () => {
    mockFetchOk({ ...AUTOMATION_FIXTURE, name: 'Renamed' });

    await updateAutomation('auto-1', { ...CREATE_INPUT, name: 'Renamed' });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations/auto-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CREATE_INPUT, name: 'Renamed' }),
    });
  });
});

describe('deleteAutomation', () => {
  it('sends DELETE /api/automations/:id and resolves void on the empty envelope', async () => {
    mockFetchEmptyOk();
    const result = await deleteAutomation('auto-1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations/auto-1', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });
});

describe('setAutomationEnabled', () => {
  it('sends PATCH /api/automations/:id/enabled with { enabled }', async () => {
    mockFetchOk({ ...AUTOMATION_FIXTURE, enabled: false });

    await setAutomationEnabled('auto-1', false);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations/auto-1/enabled', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
  });
});

describe('startAutomationRun', () => {
  it('sends a bodyless POST /api/automations/:id/runs', async () => {
    mockFetchOk({
      id: 'run-1',
      automationId: 'auto-1',
      status: 'running',
      trigger: { kind: 'manual' },
      startedAt: 1,
      finishedAt: null,
      error: null,
    });

    const result = await startAutomationRun('auto-1');

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations/auto-1/runs', { method: 'POST' });
    expect(result.id).toBe('run-1');
  });
});

describe('listAutomationRuns', () => {
  it('calls GET /api/automations/:id/runs', async () => {
    mockFetchOk([]);
    await listAutomationRuns('auto-1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automations/auto-1/runs', { method: 'GET' });
  });
});

describe('getAutomationRun', () => {
  it('calls GET /api/automation-runs/:id and returns { run, timeline }', async () => {
    const runDetail = {
      run: {
        id: 'run-1',
        automationId: 'auto-1',
        status: 'succeeded',
        trigger: { kind: 'manual' },
        startedAt: 1,
        finishedAt: 2,
        error: null,
      },
      timeline: [],
    };
    mockFetchOk(runDetail);

    const result = await getAutomationRun('run-1');

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-runs/run-1', { method: 'GET' });
    expect(result).toEqual(runDetail);
  });
});

describe('cancelAutomationRun', () => {
  it('sends a bodyless POST /api/automation-runs/:id/cancel', async () => {
    mockFetchEmptyOk();
    await cancelAutomationRun('run-1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-runs/run-1/cancel', {
      method: 'POST',
    });
  });
});

describe('listAutomationInteractions', () => {
  it('calls GET /api/automation-interactions', async () => {
    mockFetchOk([]);
    await listAutomationInteractions();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-interactions', { method: 'GET' });
  });
});

describe('respondAutomationInteraction', () => {
  it('sends POST .../respond with a wrapped { response } body', async () => {
    mockFetchEmptyOk();
    await respondAutomationInteraction('int-1', { choice: 'yes' });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-interactions/int-1/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: { choice: 'yes' } }),
    });
  });

  it('propagates a 409 error when the interaction was already answered', async () => {
    mockFetchHttpError(409, 'interaction already answered');
    await expect(respondAutomationInteraction('int-1', {})).rejects.toThrow('interaction already answered');
  });
});

describe('listAutomationActions', () => {
  it('calls GET /api/automation-actions', async () => {
    mockFetchOk([]);
    await listAutomationActions();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-actions', { method: 'GET' });
  });
});

describe('listAutomationCredentialLabels', () => {
  it('calls GET /api/automation-credentials and returns { labels }', async () => {
    mockFetchOk({ labels: ['github'] });
    const result = await listAutomationCredentialLabels();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-credentials', { method: 'GET' });
    expect(result).toEqual({ labels: ['github'] });
  });
});

describe('getAutomationCredential', () => {
  it('calls GET /api/automation-credentials/:label', async () => {
    mockFetchOk({ label: 'github', kind: 'token' });
    const result = await getAutomationCredential('github');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-credentials/github', {
      method: 'GET',
    });
    expect(result).toEqual({ label: 'github', kind: 'token' });
  });
});

describe('putAutomationCredential', () => {
  it('sends PUT /api/automation-credentials/:label with { token }', async () => {
    mockFetchEmptyOk();
    await putAutomationCredential('github', 'secret123');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-credentials/github', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'secret123' }),
    });
  });
});

describe('deleteAutomationCredential', () => {
  it('sends DELETE /api/automation-credentials/:label', async () => {
    mockFetchEmptyOk();
    await deleteAutomationCredential('github');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/automation-credentials/github', {
      method: 'DELETE',
    });
  });
});
