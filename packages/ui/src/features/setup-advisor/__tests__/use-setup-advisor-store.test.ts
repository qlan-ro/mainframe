// @vitest-environment jsdom
/**
 * use-setup-advisor-store.test.ts
 *
 * Behaviors covered (spec AC 13, Decisions 15 and 21):
 *  1. load — success sets {report, reportProjectId}, loading false, error null.
 *  2. load — stale-response guard, success path (A resolves after B; B wins).
 *  3. load — stale-response guard, failure path (A rejects after B; B untouched).
 *  4. clearForProjectSwitch — drops the report, leaves copiedByProject untouched.
 *  5. markCopied — per-project isolation.
 *  6. selectCopiedCount — intersection of copied ids with the current report's ids.
 *  7. error — set on reject, cleared by a subsequent successful load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SetupAdvisorReport, AutomationRecommendation } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Mock @/lib/api/setup-advisor BEFORE importing the store
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/setup-advisor', () => ({
  getAutomationRecommendations: vi.fn(),
}));

import { useSetupAdvisorStore, selectCopiedCount } from '../use-setup-advisor-store';
import * as setupAdvisorApi from '@/lib/api/setup-advisor';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRec(overrides: Partial<AutomationRecommendation> & { id: string }): AutomationRecommendation {
  return {
    category: 'mcp',
    title: 'Add the Supabase MCP server',
    signal: '@supabase/supabase-js in package.json',
    why: 'Query your database from Claude Code.',
    command: 'claude mcp add supabase npx @supabase/mcp-server',
    adapters: ['*'],
    provenance: 'vendor-official',
    ...overrides,
  };
}

function makeReport(recommendations: AutomationRecommendation[]): SetupAdvisorReport {
  return {
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
    recommendations,
  };
}

const REPORT_A = makeReport([makeRec({ id: 'mcp-supabase' })]);
const REPORT_B = makeReport([makeRec({ id: 'mcp-github', title: 'Add the GitHub MCP server' })]);

// ---------------------------------------------------------------------------
// Reset store + mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  act(() => {
    useSetupAdvisorStore.setState({
      report: null,
      reportProjectId: null,
      loading: false,
      error: null,
      copiedByProject: {},
    });
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. load — success
// ---------------------------------------------------------------------------

describe('useSetupAdvisorStore.load — success', () => {
  it('stores the report and project id, clears loading and error', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(REPORT_A);

    const { result } = renderHook(() => useSetupAdvisorStore());

    await act(async () => {
      await result.current.load('proj-a');
    });

    expect(result.current.report).toEqual(REPORT_A);
    expect(result.current.reportProjectId).toBe('proj-a');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading to true synchronously before the fetch resolves', () => {
    let resolveFetch!: (v: SetupAdvisorReport) => void;
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );

    const { result } = renderHook(() => useSetupAdvisorStore());

    act(() => {
      void result.current.load('proj-a');
    });

    expect(result.current.loading).toBe(true);
    resolveFetch(REPORT_A);
  });
});

// ---------------------------------------------------------------------------
// 2. load — stale-response guard
// ---------------------------------------------------------------------------

describe('useSetupAdvisorStore.load — stale-response guard', () => {
  it('discards a late success from an earlier project once a newer load has started', async () => {
    let resolveA!: (v: SetupAdvisorReport) => void;
    const slowA = new Promise<SetupAdvisorReport>((res) => {
      resolveA = res;
    });
    vi.mocked(setupAdvisorApi.getAutomationRecommendations)
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce(REPORT_B);

    const { result } = renderHook(() => useSetupAdvisorStore());

    let pA!: Promise<void>;
    act(() => {
      pA = result.current.load('proj-a');
    });

    await act(async () => {
      await result.current.load('proj-b');
    });

    await act(async () => {
      resolveA(REPORT_A);
      await pA;
    });

    expect(result.current.report).toEqual(REPORT_B);
    expect(result.current.reportProjectId).toBe('proj-b');
  });

  it('discards a late rejection from an earlier project — no overwrite, no error', async () => {
    let rejectA!: (err: Error) => void;
    const slowA = new Promise<SetupAdvisorReport>((_res, rej) => {
      rejectA = rej;
    });
    vi.mocked(setupAdvisorApi.getAutomationRecommendations)
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce(REPORT_B);

    const { result } = renderHook(() => useSetupAdvisorStore());

    let pA!: Promise<void>;
    act(() => {
      pA = result.current.load('proj-a');
    });

    await act(async () => {
      await result.current.load('proj-b');
    });

    await act(async () => {
      rejectA(new Error('project A fingerprint failed'));
      await pA;
    });

    expect(result.current.report).toEqual(REPORT_B);
    expect(result.current.reportProjectId).toBe('proj-b');
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. clearForProjectSwitch
// ---------------------------------------------------------------------------

describe('useSetupAdvisorStore.clearForProjectSwitch', () => {
  it('drops the report but leaves copiedByProject untouched', () => {
    act(() => {
      useSetupAdvisorStore.setState({
        report: REPORT_A,
        reportProjectId: 'proj-a',
        copiedByProject: { 'proj-a': new Set(['mcp-supabase']) },
      });
    });

    const { result } = renderHook(() => useSetupAdvisorStore());

    act(() => {
      result.current.clearForProjectSwitch();
    });

    expect(result.current.report).toBeNull();
    expect(result.current.reportProjectId).toBeNull();
    expect(result.current.copiedByProject['proj-a']).toEqual(new Set(['mcp-supabase']));
  });
});

// ---------------------------------------------------------------------------
// 4. markCopied — per-project isolation
// ---------------------------------------------------------------------------

describe('useSetupAdvisorStore.markCopied', () => {
  it('records a copied id under its own project only', () => {
    const { result } = renderHook(() => useSetupAdvisorStore());

    act(() => {
      result.current.markCopied('proj-a', 'mcp-supabase');
    });

    expect(result.current.copiedByProject['proj-a']).toEqual(new Set(['mcp-supabase']));
    expect(result.current.copiedByProject['proj-b']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. selectCopiedCount — intersection with the current report's ids
// ---------------------------------------------------------------------------

describe('selectCopiedCount', () => {
  it('counts only ids present in both copiedByProject and the current report — 3 seeded, 2 in the report, count is 2', () => {
    const report = makeReport([makeRec({ id: 'mcp-a' }), makeRec({ id: 'mcp-b' })]);

    act(() => {
      useSetupAdvisorStore.setState({
        report,
        reportProjectId: 'proj-a',
        copiedByProject: { 'proj-a': new Set(['mcp-a', 'mcp-b', 'mcp-c']) },
      });
    });

    expect(selectCopiedCount(useSetupAdvisorStore.getState())).toBe(2);
  });

  it('is 0 when nothing has been copied for the current project', () => {
    act(() => {
      useSetupAdvisorStore.setState({ report: REPORT_A, reportProjectId: 'proj-a', copiedByProject: {} });
    });

    expect(selectCopiedCount(useSetupAdvisorStore.getState())).toBe(0);
  });

  it('ignores copied ids recorded under a different project', () => {
    act(() => {
      useSetupAdvisorStore.setState({
        report: REPORT_B,
        reportProjectId: 'proj-b',
        copiedByProject: { 'proj-a': new Set(['mcp-github']) },
      });
    });

    expect(selectCopiedCount(useSetupAdvisorStore.getState())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. error — set on reject, cleared by a subsequent successful load
// ---------------------------------------------------------------------------

describe('useSetupAdvisorStore.load — error handling', () => {
  it('sets error on a rejected fetch', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockRejectedValue(
      new Error('Could not analyze this project'),
    );

    const { result } = renderHook(() => useSetupAdvisorStore());

    await act(async () => {
      await result.current.load('proj-a');
    });

    expect(result.current.error).toBe('Could not analyze this project');
    expect(result.current.loading).toBe(false);
  });

  it('clears a previous error on the next successful load', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations)
      .mockRejectedValueOnce(new Error('Could not analyze this project'))
      .mockResolvedValueOnce(REPORT_A);

    const { result } = renderHook(() => useSetupAdvisorStore());

    await act(async () => {
      await result.current.load('proj-a');
    });
    expect(result.current.error).toBe('Could not analyze this project');

    await act(async () => {
      await result.current.load('proj-a');
    });

    expect(result.current.error).toBeNull();
    expect(result.current.report).toEqual(REPORT_A);
  });
});
