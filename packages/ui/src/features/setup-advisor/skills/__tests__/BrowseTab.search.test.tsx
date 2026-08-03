/**
 * BrowseTab.search.test.tsx
 *
 * Pins that search goes to the registry's API rather than filtering the
 * catalog — the point of the whole arrangement, since the catalog is a
 * leaderboard head and filtering it would cap discovery at what is popular.
 * Also pins the one-character floor and the return trip back to the catalog.
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

import { BrowseTab } from '../BrowseTab';
import { useSkillsBrowseStore } from '../use-skills-browse-store';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

const CATALOG_ROW = {
  source: 'anthropic/skills',
  skillId: 'pdf',
  name: 'PDF',
  installs: 2_800_000,
  isOfficial: true,
};

/** Deliberately absent from the catalog: reaching it is what search is for. */
const DEEP_CUT = {
  source: 'obscure/repo',
  skillId: 'yaml-linter',
  name: 'YAML Linter',
  installs: 12,
  isOfficial: null,
};

function type(value: string) {
  fireEvent.change(screen.getByTestId('skills-browse-search'), { target: { value } });
}

beforeEach(() => {
  act(() => {
    useSkillsBrowseStore.getState().reset();
    useSkillsCliStore.setState({ installing: false, uninstallingKey: null });
  });
  vi.clearAllMocks();
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'available', entries: [CATALOG_ROW] });
});

describe('BrowseTab — search', () => {
  it('queries the API and renders a result the catalog does not contain', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([DEEP_CUT]);

    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    type('yaml');

    await waitFor(() => expect(skillsCliApi.searchSkills).toHaveBeenCalledWith('yaml'));
    expect(await screen.findByTestId('skills-browse-row-obscure/repo-yaml-linter')).toHaveTextContent('YAML Linter');
    expect(screen.queryByTestId('skills-browse-row-anthropic/skills-pdf')).not.toBeInTheDocument();
  });

  it('does not query on a single character, and keeps the catalog on screen', async () => {
    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    type('y');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(skillsCliApi.searchSkills).not.toHaveBeenCalled();
    expect(screen.getByTestId('skills-browse-row-anthropic/skills-pdf')).toBeInTheDocument();
  });

  it('returns to the catalog when the query is cleared', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([DEEP_CUT]);

    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    type('yaml');
    await screen.findByTestId('skills-browse-row-obscure/repo-yaml-linter');

    type('');

    expect(await screen.findByTestId('skills-browse-row-anthropic/skills-pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-browse-row-obscure/repo-yaml-linter')).not.toBeInTheDocument();
  });

  it('says when nothing matches, distinct from an empty catalog', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([]);

    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    type('zzzz');

    expect(await screen.findByTestId('skills-browse-no-results')).toHaveTextContent('No skills match that search');
    expect(screen.queryByTestId('skills-browse-catalog-empty')).not.toBeInTheDocument();
  });

  it('surfaces a failed search as an error, not as an empty result', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockRejectedValue(new Error('Registry is unreachable'));

    render(<BrowseTab projectId="proj-a" />);
    await screen.findByTestId('skills-browse-row-anthropic/skills-pdf');

    type('yaml');

    expect(await screen.findByTestId('skills-browse-search-error')).toHaveTextContent('Registry is unreachable');
    expect(screen.queryByTestId('skills-browse-no-results')).not.toBeInTheDocument();
  });
});
