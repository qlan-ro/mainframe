/**
 * SetupAdvisorHost.section.test.tsx (spec AC 1, 4; plan T31)
 *
 * Exercises the section switcher the host adds to its dialog header: default
 * landing section, section-swap on click, opening straight onto Skills, and
 * that the existing fetch/revalidation wiring (report fetch + project-switch
 * clear-and-refetch) still runs when the sheet opens on Skills rather than
 * Recommendations. Mirrors SetupAdvisorHost.test.tsx's mock shape.
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
  SetupAdvisorSheet: () => <div data-testid="setup-advisor-sheet-stub" />,
}));

vi.mock('../skills/SkillsSection', () => ({
  SkillsSection: () => <div data-testid="skills-section-stub" />,
}));

import { SetupAdvisorHost } from '../SetupAdvisorHost';
import { useSetupAdvisor } from '../use-setup-advisor';
import { useSetupAdvisorStore } from '../use-setup-advisor-store';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import * as setupAdvisorApi from '@/lib/api/setup-advisor';

function makeReport(): SetupAdvisorReport {
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
    recommendations: [],
  };
}

function identity(projectId: string | null, adapterId = 'claude') {
  return { projectId, projectName: 'mainframe', adapterId } as ReturnType<typeof useActiveIdentity>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-1'));
  vi.mocked(setupAdvisorApi.getAutomationRecommendations).mockResolvedValue(makeReport());
  useSetupAdvisor.setState({ open: false, section: 'recommendations' });
  useSetupAdvisorStore.setState({
    report: null,
    reportProjectId: null,
    loading: false,
    error: null,
    copiedByProject: {},
  });
});

describe('SetupAdvisorHost — section switcher', () => {
  it('renders the segmented control in the header with the active section pressed', () => {
    act(() => useSetupAdvisor.getState().openSheet());
    render(<SetupAdvisorHost />);

    const recs = screen.getByTestId('setup-advisor-section-recommendations');
    const skills = screen.getByTestId('setup-advisor-section-skills');
    // v2 Tabs semantics: the active trigger carries data-state="active".
    expect(recs.getAttribute('data-state')).toBe('active');
    expect(skills.getAttribute('data-state')).toBe('inactive');

    const title = screen.getByRole('heading', { level: 2 });
    expect(title.parentElement?.contains(recs)).toBe(true);
  });

  it('renders the recommendations body, not the skills stub, on a default open', () => {
    act(() => useSetupAdvisor.getState().openSheet());
    render(<SetupAdvisorHost />);

    expect(screen.getByTestId('setup-advisor-sheet-stub')).toBeTruthy();
    expect(screen.queryByTestId('skills-section-stub')).toBeNull();
  });

  it('swaps the body to skills on click, and back to recommendations on click', () => {
    act(() => useSetupAdvisor.getState().openSheet());
    render(<SetupAdvisorHost />);

    fireEvent.mouseDown(screen.getByTestId('setup-advisor-section-skills'));
    expect(screen.getByTestId('skills-section-stub')).toBeTruthy();
    expect(screen.queryByTestId('setup-advisor-sheet-stub')).toBeNull();

    fireEvent.mouseDown(screen.getByTestId('setup-advisor-section-recommendations'));
    expect(screen.getByTestId('setup-advisor-sheet-stub')).toBeTruthy();
    expect(screen.queryByTestId('skills-section-stub')).toBeNull();
  });

  it('renders the skills stub on first paint when opened straight onto skills', () => {
    act(() => useSetupAdvisor.getState().openSheet('skills'));
    render(<SetupAdvisorHost />);

    expect(screen.getByTestId('skills-section-stub')).toBeTruthy();
    expect(screen.queryByTestId('setup-advisor-sheet-stub')).toBeNull();
  });
});

describe('SetupAdvisorHost — recommendation fetch still runs when opened onto skills', () => {
  it('still fetches the recommendation report exactly once', async () => {
    act(() => useSetupAdvisor.getState().openSheet('skills'));
    render(<SetupAdvisorHost />);

    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));
    expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledWith('proj-1');
  });

  it('clears the stale report and refetches when the project switches while open on skills', async () => {
    act(() => useSetupAdvisor.getState().openSheet('skills'));
    const { rerender } = render(<SetupAdvisorHost />);
    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));

    useSetupAdvisorStore.setState({ report: makeReport(), reportProjectId: 'proj-1' });
    vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-2'));
    rerender(<SetupAdvisorHost />);

    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(2));
    expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenLastCalledWith('proj-2');
  });
});

describe('SetupAdvisorHost — header layout', () => {
  it('keeps the switcher in the same flex row as the title, with the title still truncating', () => {
    act(() => useSetupAdvisor.getState().openSheet());
    render(<SetupAdvisorHost />);

    const title = screen.getByRole('heading', { level: 2 });
    // v2 Tabs wrap the triggers in TabsList inside the Tabs root; the ROOT
    // shares the header row with the title.
    const switcher = screen.getByTestId('setup-advisor-section-recommendations').closest('[data-slot="tabs"]');
    expect(switcher).not.toBeNull();
    expect(title.parentElement).toBe(switcher?.parentElement);
    expect(title.className).toContain('min-w-0');
  });
});
