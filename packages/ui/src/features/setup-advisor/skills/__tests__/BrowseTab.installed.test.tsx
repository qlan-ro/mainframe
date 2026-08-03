/**
 * BrowseTab.installed.test.tsx
 *
 * Browse marks what the CLI already has. The marker is scope-aware because the
 * action is: installed in the selected scope means there is nothing left to do,
 * installed in the other one means installing here is still a real choice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  getSkillsCatalog: vi.fn(),
  searchSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
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
    useSkillsCliStore.setState({ installing: false, uninstallingKey: null, failure: null, entries: [] });
  });
  vi.clearAllMocks();
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'available', entries: ROWS });
});

function seedManifest(entries: SkillsCliEntry[]) {
  act(() => {
    useSkillsCliStore.setState({ status: 'available', entries });
  });
}

describe('BrowseTab — installed markers', () => {
  it('spends the install button for a skill already installed in the selected scope', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-install-anthropic/skills-pdf');

    seedManifest([{ name: 'pdf', scope: 'project', source: 'anthropic/skills', sourceType: 'github' }]);

    const button = screen.getByTestId('skills-browse-install-anthropic/skills-pdf');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Installed');
    expect(screen.queryByTestId('skills-browse-installed-anthropic/skills-pdf')).not.toBeInTheDocument();
  });

  it('names the other scope and keeps the button live when it is installed there instead', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-install-anthropic/skills-pdf');

    seedManifest([{ name: 'pdf', scope: 'global', source: 'anthropic/skills', sourceType: 'github' }]);

    expect(screen.getByTestId('skills-browse-installed-anthropic/skills-pdf')).toHaveTextContent('Installed globally');
    expect(screen.getByTestId('skills-browse-install-anthropic/skills-pdf')).toBeEnabled();
  });

  it('follows the scope control: the same row flips from marked-elsewhere to spent', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-install-anthropic/skills-pdf');

    seedManifest([{ name: 'pdf', scope: 'global', source: 'anthropic/skills', sourceType: 'github' }]);
    fireEvent.click(screen.getByTestId('skills-browse-scope-global'));

    expect(screen.getByTestId('skills-browse-install-anthropic/skills-pdf')).toBeDisabled();
    expect(screen.queryByTestId('skills-browse-installed-anthropic/skills-pdf')).not.toBeInTheDocument();
  });

  it('says so when the manifest could not be read, rather than implying nothing is installed', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-install-anthropic/skills-pdf');

    act(() => {
      useSkillsCliStore.setState({ status: 'error', error: 'skills CLI failed to start', entries: [] });
    });

    expect(screen.getByTestId('skills-browse-manifest-error')).toBeInTheDocument();
  });

  it('leaves a row from another source untouched by a same-id install', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-install-acme/skills-pdf');

    seedManifest([{ name: 'pdf', scope: 'project', source: 'anthropic/skills', sourceType: 'github' }]);

    const other = screen.getByTestId('skills-browse-install-acme/skills-pdf');
    expect(other).toBeEnabled();
    expect(other).toHaveTextContent(/^Install$/);
    expect(screen.queryByTestId('skills-browse-installed-acme/skills-pdf')).not.toBeInTheDocument();
  });
});
