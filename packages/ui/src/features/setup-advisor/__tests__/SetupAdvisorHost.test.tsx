/**
 * SetupAdvisorHost.test.tsx (spec AC 9, 13; plan T27)
 *
 * Exercises the real useSetupAdvisor (nav) + useSetupAdvisorStore (data)
 * against a mocked lib/api/setup-advisor and a stubbed SetupAdvisorSheet —
 * the sheet's own rendering is covered by SetupAdvisorSheet.test.tsx, so this
 * file only proves the host wires identity, nav, and data together correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SetupAdvisorReport } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/setup-advisor', () => ({
  getAutomationRecommendations: vi.fn(),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(),
}));

vi.mock('../SetupAdvisorSheet', () => ({
  SetupAdvisorSheet: (props: {
    projectName: string;
    loading: boolean;
    report: SetupAdvisorReport | null;
    copiedIds: ReadonlySet<string>;
    onCopy: (recId: string) => void;
    onRetry: () => void;
  }) => (
    <div data-testid="setup-advisor-sheet-stub">
      <div data-testid="stub-project-name">{props.projectName}</div>
      <div data-testid="stub-loading">{String(props.loading)}</div>
      <div data-testid="stub-rec-ids">
        {props.report ? props.report.recommendations.map((r) => r.id).join(',') : ''}
      </div>
      <div data-testid="stub-copied-ids">{[...props.copiedIds].join(',')}</div>
      <button data-testid="stub-copy" onClick={() => props.onCopy('mcp-supabase')}>
        copy
      </button>
      <button data-testid="stub-retry" onClick={props.onRetry}>
        retry
      </button>
    </div>
  ),
}));

import { SetupAdvisorHost } from '../SetupAdvisorHost';
import { useSetupAdvisor } from '../use-setup-advisor';
import { useSetupAdvisorStore } from '../use-setup-advisor-store';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import * as setupAdvisorApi from '@/lib/api/setup-advisor';

function makeReport(ids: string[]): SetupAdvisorReport {
  return {
    fingerprint: {
      languages: [],
      frameworks: [],
      databases: [],
      externalApis: [],
      testing: [],
      tooling: [],
      gitHost: null,
      hasClaudeConfig: false,
      hasEnvFiles: false,
      hasLockFiles: false,
      dirs: [],
      fileCount: 0,
      signals: [],
    },
    recommendations: ids.map((id) => ({
      id,
      category: 'mcp' as const,
      title: id,
      signal: 'sig',
      why: 'why',
      command: 'cmd',
      adapters: ['*'],
      provenance: 'vendor-official' as const,
    })),
  };
}

function identity(projectId: string | null, projectName = 'mainframe') {
  return { projectId, projectName } as ReturnType<typeof useActiveIdentity>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-1'));
  useSetupAdvisor.setState({ open: false });
  useSetupAdvisorStore.setState({
    report: null,
    reportProjectId: null,
    loading: false,
    error: null,
    copiedByProject: {},
  });
});

describe('SetupAdvisorHost — no active project', () => {
  it('renders nothing when there is no active project', () => {
    vi.mocked(useActiveIdentity).mockReturnValue(identity(null));
    useSetupAdvisor.setState({ open: true });

    const { container } = render(<SetupAdvisorHost />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('SetupAdvisorHost — fetch on the open rising edge', () => {
  // The close and the re-open are two user gestures (the Dialog's onOpenChange,
  // then the toolbar button), so each gets its own act() — batching them into
  // one render would model an interaction that cannot happen.
  it('does not fetch on mount while closed, fetches once on open, and again on every re-open', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(makeReport(['mcp-supabase']));

    render(<SetupAdvisorHost />);
    expect(setupAdvisorApi.getAutomationRecommendations).not.toHaveBeenCalled();

    act(() => useSetupAdvisor.getState().openSheet());
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));

    act(() => useSetupAdvisor.getState().closeSheet());
    act(() => useSetupAdvisor.getState().openSheet());
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(2));
  });

  it('does not re-fetch on an unrelated re-render while open', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(makeReport(['mcp-supabase']));

    const { rerender } = render(<SetupAdvisorHost />);
    act(() => useSetupAdvisor.getState().openSheet());
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));

    rerender(<SetupAdvisorHost />);

    expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1);
  });
});

describe('SetupAdvisorHost — project name and loading', () => {
  it('renders the project name immediately, including while loading', () => {
    let resolveFetch!: (v: SetupAdvisorReport) => void;
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );
    vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-1', 'Mainframe'));
    useSetupAdvisor.setState({ open: true });

    render(<SetupAdvisorHost />);

    expect(screen.getByTestId('stub-project-name').textContent).toBe('Mainframe');
    expect(screen.getByTestId('stub-loading').textContent).toBe('true');
    resolveFetch(makeReport([]));
  });
});

describe('SetupAdvisorHost — copy state survives close/reopen', () => {
  it('keeps a copied id across a close/reopen refetch for the same project', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(makeReport(['mcp-supabase']));
    useSetupAdvisor.setState({ open: true });

    render(<SetupAdvisorHost />);
    await waitFor(() => expect(screen.getByTestId('stub-rec-ids').textContent).toBe('mcp-supabase'));

    fireEvent.click(screen.getByTestId('stub-copy'));
    await waitFor(() => expect(screen.getByTestId('stub-copied-ids').textContent).toBe('mcp-supabase'));

    act(() => useSetupAdvisor.getState().closeSheet());
    act(() => useSetupAdvisor.getState().openSheet());

    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('stub-copied-ids').textContent).toBe('mcp-supabase');
  });
});

describe('SetupAdvisorHost — project switch while open', () => {
  it('drops the previous report, refetches for the new project, and ignores a late response from the old one', async () => {
    let resolveA!: (v: SetupAdvisorReport) => void;
    const slowA = new Promise<SetupAdvisorReport>((res) => {
      resolveA = res;
    });
    vi.mocked(setupAdvisorApi.getAutomationRecommendations)
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce(makeReport(['mcp-b']));
    vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-a'));
    useSetupAdvisor.setState({ open: true });

    const { rerender } = render(<SetupAdvisorHost />);
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));

    vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-b'));
    rerender(<SetupAdvisorHost />);
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(2));

    resolveA(makeReport(['mcp-a']));

    await waitFor(() => expect(screen.getByTestId('stub-rec-ids').textContent).toBe('mcp-b'));
  });
});

describe('SetupAdvisorHost — report/project boundary', () => {
  // Finding 14: the clearing effect runs after commit, so the render that first
  // sees the new projectId still reads the old project's report out of the
  // store. Nothing must reach the sheet under the wrong project's name — not
  // even for the one frame before the refetch starts.
  it('withholds a report fetched for a different project', () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockImplementation(() => new Promise(() => {}));
    useSetupAdvisorStore.setState({ report: makeReport(['mcp-a']), reportProjectId: 'proj-a' });
    vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-b'));
    useSetupAdvisor.setState({ open: true });

    render(<SetupAdvisorHost />);

    expect(screen.getByTestId('stub-rec-ids').textContent).toBe('');
  });

  it('passes the report through once it belongs to the active project', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(makeReport(['mcp-b']));
    useSetupAdvisorStore.setState({ report: makeReport(['mcp-a']), reportProjectId: 'proj-a' });
    vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-b'));
    useSetupAdvisor.setState({ open: true });

    render(<SetupAdvisorHost />);

    await waitFor(() => expect(screen.getByTestId('stub-rec-ids').textContent).toBe('mcp-b'));
  });
});

describe('SetupAdvisorHost — retry', () => {
  it('re-issues the request when the retry callback fires', async () => {
    vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(makeReport(['mcp-supabase']));
    useSetupAdvisor.setState({ open: true });

    render(<SetupAdvisorHost />);
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('stub-retry'));

    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(2));
  });
});
