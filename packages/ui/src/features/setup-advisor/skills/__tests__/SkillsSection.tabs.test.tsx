/**
 * SkillsSection.tabs.test.tsx
 *
 * Pins the Browse / Installed split: Browse is what opens, Installed still
 * renders the CLI manifest, and neither tab leaks the other's controls. Also
 * pins that a failed operation's tail survives a tab switch — it is the only
 * place the CLI's own output is readable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  getSkillsCatalog: vi.fn(),
  searchSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

import { SkillsSection } from '../SkillsSection';
import { useSkillsBrowseStore } from '../use-skills-browse-store';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

const CATALOG_ROW = { source: 'anthropic/skills', skillId: 'pdf', name: 'PDF', installs: 2_800_000, isOfficial: true };

const MANIFEST_ENTRY = {
  name: 'shadcn',
  scope: 'project' as const,
  source: 'shadcn/ui',
  sourceType: 'github',
  skillPath: 'skills/shadcn/SKILL.md',
};

beforeEach(() => {
  act(() => {
    useSkillsCliStore.setState({
      status: 'idle',
      entries: [],
      probe: null,
      installing: false,
      uninstallingKey: null,
      failure: null,
    });
    useSkillsBrowseStore.getState().reset();
  });
  vi.clearAllMocks();
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'available', entries: [CATALOG_ROW] });
  vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [MANIFEST_ENTRY] });
});

describe('SkillsSection — tabs', () => {
  it('opens on Browse', async () => {
    render(<SkillsSection projectId="proj-a" />);

    expect(screen.getByTestId('skills-section-tab-browse')).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('skills-browse-search')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-section-row-project-shadcn')).not.toBeInTheDocument();
  });

  it('renders the manifest on Installed, and hides the registry controls', async () => {
    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    fireEvent.click(screen.getByTestId('skills-section-tab-installed'));

    expect(screen.getByTestId('skills-section-tab-installed')).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('skills-section-row-project-shadcn')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-browse-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-section-source')).not.toBeInTheDocument();
  });

  it('goes back to Browse without re-fetching the catalog', async () => {
    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    fireEvent.click(screen.getByTestId('skills-section-tab-installed'));
    await screen.findByTestId('skills-section-row-project-shadcn');
    fireEvent.click(screen.getByTestId('skills-section-tab-browse'));

    expect(await screen.findByTestId('skills-browse-row-anthropic/skills-pdf')).toBeInTheDocument();
    expect(skillsCliApi.getSkillsCatalog).toHaveBeenCalledTimes(1);
  });

  it('keeps a failure tail readable from either tab', async () => {
    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    act(() => {
      useSkillsCliStore.setState({ failure: { message: 'Install failed', tail: 'npm ERR! 404' } });
    });

    expect(screen.getByTestId('skills-section-failure-tail')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('skills-section-tab-installed'));
    expect(screen.getByTestId('skills-section-failure-tail')).toBeInTheDocument();
  });
});
