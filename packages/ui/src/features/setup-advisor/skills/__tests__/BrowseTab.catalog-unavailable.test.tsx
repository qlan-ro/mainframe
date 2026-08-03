/**
 * BrowseTab.catalog-unavailable.test.tsx
 *
 * The catalog is scraped from the registry's homepage, so it can go away
 * without search going away. Browse degrades to search-only and says so as a
 * prompt, never as an error: there is nothing the user could do about a
 * failed scrape, and searching still works.
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

import { BrowseTab } from '../BrowseTab';
import { useSkillsBrowseStore } from '../use-skills-browse-store';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

const RESULT = { source: 'obscure/repo', skillId: 'yaml-linter', name: 'YAML Linter', installs: 12, isOfficial: null };

beforeEach(() => {
  act(() => {
    useSkillsBrowseStore.getState().reset();
    useSkillsCliStore.setState({ installing: false, uninstallingKey: null });
  });
  vi.clearAllMocks();
});

describe('BrowseTab — catalog unavailable', () => {
  it('prompts the user to search, with no error surface', async () => {
    vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'unavailable' });

    render(<BrowseTab projectId="proj-a" />);

    const note = await screen.findByTestId('skills-browse-catalog-unavailable');
    expect(note).toHaveTextContent('Search skills.sh to find a skill to install');
    expect(note).not.toHaveClass('text-destructive');
    expect(screen.queryByTestId('skills-browse-search-error')).not.toBeInTheDocument();
  });

  it('degrades the same way when the catalog request itself throws', async () => {
    vi.mocked(skillsCliApi.getSkillsCatalog).mockRejectedValue(new Error('Network down'));

    render(<BrowseTab projectId="proj-a" />);

    expect(await screen.findByTestId('skills-browse-catalog-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Network down')).not.toBeInTheDocument();
  });

  it('still searches, and still installs from a result', async () => {
    vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'unavailable' });
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([RESULT]);
    vi.mocked(skillsCliApi.installSkills).mockResolvedValue(undefined);
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });

    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-catalog-unavailable');

    fireEvent.change(screen.getByTestId('skills-browse-search'), { target: { value: 'yaml' } });

    fireEvent.click(await screen.findByTestId('skills-browse-install-obscure/repo-yaml-linter'));

    expect(skillsCliApi.installSkills).toHaveBeenCalledWith(
      'proj-a',
      'obscure/repo',
      ['yaml-linter'],
      'project',
      undefined,
    );
  });
});
