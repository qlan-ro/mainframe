/**
 * SetupAdvisorHost.section.test.tsx (plan T12)
 *
 * The dialog gains a top-level section switcher beside its title. This file
 * proves the host routes between the two bodies, keeps the existing
 * recommendations fetch behavior byte-identical regardless of which section
 * is showing (D3), and that the switcher sits beside the title rather than
 * stacking below it (a `DialogHeader` is `flex flex-col`, so a naive sibling
 * append would not do this — testid presence alone can't catch that).
 *
 * SetupAdvisorHost.test.tsx already covers the recommendations fetch/copy/
 * project-switch behavior in full; this file only adds section routing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SetupAdvisorReport } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/setup-advisor', () => ({
  getAutomationRecommendations: vi.fn(),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(),
}));

vi.mock('../SetupAdvisorSheet', () => ({
  SetupAdvisorSheet: () => <div data-testid="setup-advisor-sheet-stub">recommendations body</div>,
}));

vi.mock('../skills/SkillsSection', () => ({
  SkillsSection: () => <div data-testid="skills-section-stub">skills body</div>,
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

function identity(projectId: string | null, projectName = 'mainframe') {
  return { projectId, projectName } as ReturnType<typeof useActiveIdentity>;
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

describe('SetupAdvisorHost — section routing', () => {
  it('opens on the recommendations body and does not render the skills body', () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet();

    expect(screen.getByTestId('setup-advisor-sheet-stub')).toBeTruthy();
    expect(screen.queryByTestId('skills-section-stub')).toBeNull();
  });

  it('swaps to the skills body when the skills segment is clicked, keeping the dialog open', () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet();

    fireEvent.click(screen.getByTestId('setup-advisor-section-skills'));

    expect(useSetupAdvisor.getState().open).toBe(true);
    expect(screen.getByTestId('skills-section-stub')).toBeTruthy();
    expect(screen.queryByTestId('setup-advisor-sheet-stub')).toBeNull();
  });

  it('lands on the skills body directly when opened via openSheet("skills")', () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet('skills');

    expect(screen.getByTestId('skills-section-stub')).toBeTruthy();
    expect(screen.queryByTestId('setup-advisor-sheet-stub')).toBeNull();
  });

  it('tracks the active segment via aria-pressed', () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet();

    const recommendationsSeg = screen.getByTestId('setup-advisor-section-recommendations');
    const skillsSeg = screen.getByTestId('setup-advisor-section-skills');
    expect(recommendationsSeg.getAttribute('aria-pressed')).toBe('true');
    expect(skillsSeg.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(skillsSeg);

    expect(recommendationsSeg.getAttribute('aria-pressed')).toBe('false');
    expect(skillsSeg.getAttribute('aria-pressed')).toBe('true');
  });

  it('fetches the report exactly once on the open rising edge regardless of section', async () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet('skills');

    await waitFor(() => expect(setupAdvisorApi.getAutomationRecommendations).toHaveBeenCalledTimes(1));
  });

  it('still exposes automation-recommender-sheet as the DialogContent testid', () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet();

    expect(screen.getByTestId('automation-recommender-sheet')).toBeTruthy();
  });
});

describe('SetupAdvisorHost — header layout', () => {
  it('renders the switcher beside the title inside a flex row, not stacked below it', () => {
    render(<SetupAdvisorHost />);
    useSetupAdvisor.getState().openSheet();

    const row = screen.getByTestId('setup-advisor-header-row');
    expect(row.className).toContain('flex');
    expect(row.className).toContain('items-center');

    const skillsSeg = screen.getByTestId('setup-advisor-section-skills');
    expect(row).toContainElement(skillsSeg);
    expect(row).toContainElement(screen.getByText('Setup Advisor'));
  });
});
