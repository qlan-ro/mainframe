/**
 * SkillsSection.search.test.tsx
 *
 * Pins that search goes to the registry's API rather than filtering the
 * catalog — the point of the whole arrangement, since the catalog is a
 * leaderboard head and filtering it would cap discovery at what is popular.
 * Also pins the one-character floor and the return trip back to the catalog.
 *
 * Installed rows are the exception: the registry's index knows nothing about
 * this machine, so they are filtered here, locally, against the same box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
import * as skillsCliApi from '@/lib/api/skills-cli';
import { makeEntry, mockCatalog, mockManifest, resetSkillsStores } from './harness';

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
  resetSkillsStores();
  mockCatalog([CATALOG_ROW]);
  mockManifest([]);
});

describe('SkillsSection — search', () => {
  it('queries the API and renders a result the catalog does not contain', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([DEEP_CUT]);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    type('yaml');

    await waitFor(() => expect(skillsCliApi.searchSkills).toHaveBeenCalledWith('yaml'));
    expect(await screen.findByTestId('skills-row-obscure/repo/yaml-linter')).toHaveTextContent('YAML Linter');
    expect(screen.queryByTestId('skills-row-anthropic/skills/pdf')).not.toBeInTheDocument();
  });

  it('does not query on a single character, and keeps the catalog on screen', async () => {
    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    type('y');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(skillsCliApi.searchSkills).not.toHaveBeenCalled();
    expect(screen.getByTestId('skills-row-anthropic/skills/pdf')).toBeInTheDocument();
  });

  it('returns to the catalog when the query is cleared', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([DEEP_CUT]);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    type('yaml');
    await screen.findByTestId('skills-row-obscure/repo/yaml-linter');

    type('');

    expect(await screen.findByTestId('skills-row-anthropic/skills/pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-row-obscure/repo/yaml-linter')).not.toBeInTheDocument();
  });

  it('filters the installed rows locally against the same box', async () => {
    mockManifest([
      makeEntry({ name: 'shadcn', scope: 'project', source: 'shadcn/ui' }),
      makeEntry({ name: 'yaml-linter', scope: 'project', source: 'obscure/repo' }),
    ]);
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([]);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-shadcn/ui/shadcn');

    type('yaml');

    expect(await screen.findByTestId('skills-row-obscure/repo/yaml-linter')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-row-shadcn/ui/shadcn')).not.toBeInTheDocument();
  });

  it('says when nothing matches, distinct from an empty catalog', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([]);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    type('zzzz');

    expect(await screen.findByTestId('skills-browse-no-results')).toHaveTextContent('No skills match that search');
    expect(screen.queryByTestId('skills-browse-catalog-empty')).not.toBeInTheDocument();
  });

  it('surfaces a failed search as an error, not as an empty result', async () => {
    vi.mocked(skillsCliApi.searchSkills).mockRejectedValue(new Error('Registry is unreachable'));

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    type('yaml');

    expect(await screen.findByTestId('skills-browse-search-error')).toHaveTextContent('Registry is unreachable');
    expect(screen.queryByTestId('skills-browse-no-results')).not.toBeInTheDocument();
  });
});
