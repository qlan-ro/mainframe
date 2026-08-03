/**
 * SkillsSection.catalog.test.tsx
 *
 * Pins the registry half of the list: the head of skills.sh's leaderboard and
 * nothing past it. The daemon returns the whole thing (~600 rows), so the cut
 * is the store's job and this is where it is asserted — a regression would
 * otherwise surface only as a very long panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SkillsCatalogEntry } from '@qlan-ro/mainframe-types';

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
import { mockCatalog, mockManifest, resetSkillsStores } from './harness';

function makeCatalog(count: number): SkillsCatalogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    source: 'acme/skills',
    skillId: `skill-${i}`,
    name: `Skill ${i}`,
    installs: 1000 - i,
    isOfficial: i === 0,
  }));
}

beforeEach(() => {
  resetSkillsStores();
  mockManifest([]);
});

describe('SkillsSection — catalog', () => {
  it('renders the top 50 rows and drops the 51st', async () => {
    mockCatalog(makeCatalog(60));

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-acme/skills/skill-0');
    expect(screen.getByTestId('skills-row-acme/skills/skill-49')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-row-acme/skills/skill-50')).not.toBeInTheDocument();
  });

  it('renders each row with its name and install count, and the official marker only where the flag is true', async () => {
    mockCatalog([
      { source: 'anthropic/skills', skillId: 'pdf', name: 'PDF', installs: 2_800_000, isOfficial: true },
      { source: 'acme/skills', skillId: 'plain', name: 'Plain', installs: 842, isOfficial: false },
    ]);

    render(<SkillsSection projectId="proj-a" />);

    const official = await screen.findByTestId('skills-row-anthropic/skills/pdf');
    expect(official).toHaveTextContent('PDF');
    expect(official).toHaveTextContent('2.8M');
    expect(official.querySelector('[aria-label="Official"]')).not.toBeNull();

    const plain = screen.getByTestId('skills-row-acme/skills/plain');
    expect(plain).toHaveTextContent('842');
    expect(plain.querySelector('[aria-label="Official"]')).toBeNull();
  });

  it('shows skeletons until the catalog resolves', () => {
    vi.mocked(skillsCliApi.getSkillsCatalog).mockImplementation(() => new Promise(() => {}));

    render(<SkillsSection projectId="proj-a" />);

    expect(screen.getAllByTestId('skills-browse-skeleton').length).toBeGreaterThan(0);
  });

  it('says so when the registry returns no rows at all', async () => {
    mockCatalog([]);

    render(<SkillsSection projectId="proj-a" />);

    expect(await screen.findByTestId('skills-browse-catalog-empty')).toHaveTextContent(
      'The registry returned no skills',
    );
  });
});
