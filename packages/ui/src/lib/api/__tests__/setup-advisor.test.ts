/**
 * setup-advisor.test.ts
 *
 * URL/method/body shaping only — the envelope unwrap (`request<T>`) is already
 * covered by `http-envelope.test.ts`. Follows the `automations.ts` no-port
 * convention (`api-automations.test.ts`), not the older `getProjects(port, …)`
 * shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SetupAdvisorReport } from '@qlan-ro/mainframe-types';
import { getAutomationRecommendations } from '../setup-advisor';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

const REPORT_FIXTURE: SetupAdvisorReport = {
  fingerprint: {
    languages: ['typescript'],
    frameworks: ['react'],
    databases: [],
    externalApis: [],
    testing: [],
    tooling: [],
    gitHost: null,
    hasClaudeConfig: false,
    hasEnvFiles: false,
    hasLockFiles: false,
    dirs: [],
    fileCount: 3,
    signals: ['TypeScript', 'React'],
  },
  recommendations: [],
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

describe('getAutomationRecommendations', () => {
  it('calls GET /api/projects/:id/automation-recommendations against the active daemon', async () => {
    mockFetchOk(REPORT_FIXTURE);

    const result = await getAutomationRecommendations('proj-1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-1/automation-recommendations', {
      method: 'GET',
    });
    expect(result).toEqual(REPORT_FIXTURE);
  });

  it('URI-encodes a project id containing reserved characters', async () => {
    mockFetchOk(REPORT_FIXTURE);

    await getAutomationRecommendations('proj/one two');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/projects/proj%2Fone%20two/automation-recommendations',
      { method: 'GET' },
    );
  });

  it('throws when the envelope reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, error: 'Project not found' }),
      }),
    );

    await expect(getAutomationRecommendations('missing')).rejects.toThrow('Project not found');
  });
});
