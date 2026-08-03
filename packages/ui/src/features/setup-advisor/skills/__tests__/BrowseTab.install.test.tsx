/**
 * BrowseTab.install.test.tsx
 *
 * Installing from a row sends that row's own source and skill id — a skill id
 * is only unique within its source, so a row that installed the wrong pair
 * would look right and land the wrong skill. Scope comes from the one control
 * in the toolbar, shared with the source band below it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  getSkillsCatalog: vi.fn(),
  searchSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

vi.mock('@/lib/toast', () => ({
  mfToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), permission: vi.fn() },
}));

import { BrowseTab } from '../BrowseTab';
import { useSkillsBrowseStore } from '../use-skills-browse-store';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

const ROWS = [
  { source: 'anthropic/skills', skillId: 'pdf', name: 'PDF', installs: 2_800_000, isOfficial: true },
  { source: 'acme/skills', skillId: 'pdf', name: 'Acme PDF', installs: 42, isOfficial: false },
];

beforeEach(() => {
  act(() => {
    useSkillsBrowseStore.getState().reset();
    useSkillsCliStore.setState({ installing: false, uninstallingKey: null, failure: null });
  });
  vi.clearAllMocks();
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'available', entries: ROWS });
  vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });
  vi.mocked(skillsCliApi.installSkills).mockResolvedValue(undefined);
});

describe('BrowseTab — install from a row', () => {
  it("sends that row's source and skill id, not another row sharing the id", async () => {
    render(<BrowseTab projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-browse-install-acme/skills-pdf'));

    await waitFor(() => expect(skillsCliApi.installSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.installSkills).toHaveBeenCalledWith('proj-a', 'acme/skills', ['pdf'], 'project', undefined);
  });

  it('installs to the scope chosen in the toolbar', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-install-anthropic/skills-pdf');

    fireEvent.click(screen.getByTestId('skills-browse-scope-global'));
    fireEvent.click(screen.getByTestId('skills-browse-install-anthropic/skills-pdf'));

    await waitFor(() =>
      expect(skillsCliApi.installSkills).toHaveBeenCalledWith(
        'proj-a',
        'anthropic/skills',
        ['pdf'],
        'global',
        undefined,
      ),
    );
  });

  it('passes the adapter id through', async () => {
    render(<BrowseTab projectId="proj-a" adapterId="codex" />);

    fireEvent.click(await screen.findByTestId('skills-browse-install-anthropic/skills-pdf'));

    await waitFor(() =>
      expect(skillsCliApi.installSkills).toHaveBeenCalledWith(
        'proj-a',
        'anthropic/skills',
        ['pdf'],
        'project',
        'codex',
      ),
    );
  });

  it('marks only the running row busy, and disables every install and the scope control', async () => {
    vi.mocked(skillsCliApi.installSkills).mockImplementation(() => new Promise(() => {}));

    render(<BrowseTab projectId="proj-a" />);
    fireEvent.click(await screen.findByTestId('skills-browse-install-acme/skills-pdf'));

    const running = await screen.findByTestId('skills-browse-install-acme/skills-pdf');
    const other = screen.getByTestId('skills-browse-install-anthropic/skills-pdf');

    await waitFor(() => expect(running).toHaveAttribute('aria-busy', 'true'));
    expect(other).toHaveAttribute('aria-busy', 'false');
    expect(running).toBeDisabled();
    expect(other).toBeDisabled();
    expect(screen.getByTestId('skills-browse-scope-global')).toBeDisabled();
  });
});
