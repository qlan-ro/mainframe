/**
 * SkillsSection.catalog-unavailable.test.tsx
 *
 * The catalog is scraped from the registry's homepage, so it can go away
 * without search going away. The list degrades to search-only and says so as a
 * prompt, never as an error: there is nothing the user could do about a failed
 * scrape, and searching still works.
 *
 * Installed rows come from the CLI, not the registry, so they must survive a
 * failed scrape — losing them would say "you have nothing" on the strength of
 * a broken HTTP call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
import { makeEntry, mockCatalogUnavailable, mockManifest, openScopeMenu, resetSkillsStores } from './harness';

const RESULT = { source: 'obscure/repo', skillId: 'yaml-linter', name: 'YAML Linter', installs: 12, isOfficial: null };

beforeEach(() => {
  resetSkillsStores();
  mockManifest([]);
});

describe('SkillsSection — catalog unavailable', () => {
  it('prompts the user to search, with no error surface', async () => {
    mockCatalogUnavailable();

    render(<SkillsSection projectId="proj-a" />);

    const note = await screen.findByTestId('skills-browse-catalog-unavailable');
    expect(note).toHaveTextContent('Search skills.sh to find a skill to install');
    expect(note).not.toHaveClass('text-destructive');
    expect(screen.queryByTestId('skills-browse-search-error')).not.toBeInTheDocument();
  });

  it('degrades the same way when the catalog request itself throws', async () => {
    vi.mocked(skillsCliApi.getSkillsCatalog).mockRejectedValue(new Error('Network down'));

    render(<SkillsSection projectId="proj-a" />);

    expect(await screen.findByTestId('skills-browse-catalog-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Network down')).not.toBeInTheDocument();
  });

  it('keeps the installed rows, which do not come from the registry', async () => {
    mockCatalogUnavailable();
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);

    render(<SkillsSection projectId="proj-a" />);

    expect(await screen.findByTestId('skills-row-shadcn/ui/shadcn')).toHaveTextContent('shadcn');
    expect(screen.getByTestId('skills-browse-catalog-unavailable')).toBeInTheDocument();
  });

  it('still searches, and still installs from a result', async () => {
    mockCatalogUnavailable();
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([RESULT]);
    vi.mocked(skillsCliApi.installSkills).mockResolvedValue(undefined);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-browse-catalog-unavailable');

    fireEvent.change(screen.getByTestId('skills-browse-search'), { target: { value: 'yaml' } });

    await openScopeMenu('obscure/repo/yaml-linter');
    fireEvent.click(await screen.findByTestId('skills-row-scope-obscure/repo/yaml-linter-project'));

    expect(skillsCliApi.installSkills).toHaveBeenCalledWith(
      'proj-a',
      'obscure/repo',
      ['yaml-linter'],
      'project',
      undefined,
    );
  });
});
