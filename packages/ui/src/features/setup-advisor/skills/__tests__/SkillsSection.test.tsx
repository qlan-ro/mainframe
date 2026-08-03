/**
 * SkillsSection.test.tsx
 *
 * Pins the manifest half of the list against a mocked `@/lib/api/skills-cli`:
 * what a row carries, how one skill installed in two scopes collapses into one
 * row, and what the panel says when the manifest can't be read at all.
 *
 * Ordering and the row action live in SkillsSection.merged.test.tsx; the
 * registry half in the catalog and search suites; install and uninstall
 * outcomes in the {row-install,install,uninstall,failure} trio; the
 * CLI-unavailable branch in SkillsSection.unavailable.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';
import { makeEntry, mockCatalogUnavailable, mockManifest, resetSkillsStores } from './harness';

beforeEach(() => {
  resetSkillsStores();
  mockCatalogUnavailable();
});

describe('SkillsSection — loading', () => {
  it('renders skeleton rows, not a spinner', () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(() => new Promise(() => {}));
    vi.mocked(skillsCliApi.getSkillsCatalog).mockImplementation(() => new Promise(() => {}));

    render(<SkillsSection projectId="proj-a" />);

    expect(screen.getAllByTestId('skills-browse-skeleton').length).toBeGreaterThan(0);
  });
});

describe('SkillsSection — installed rows', () => {
  it('renders one row per skill, keyed by source and id, showing both', async () => {
    mockManifest([
      makeEntry({ name: 'shadcn', scope: 'project', source: 'shadcn/ui' }),
      makeEntry({ name: 'my skill', scope: 'global', source: 'acme/skills' }),
    ]);

    render(<SkillsSection projectId="proj-a" />);

    const projectRow = await screen.findByTestId('skills-row-shadcn/ui/shadcn');
    const globalRow = await screen.findByTestId('skills-row-acme/skills/my skill');

    expect(projectRow).toHaveTextContent('shadcn');
    expect(projectRow).toHaveTextContent('shadcn/ui');
    expect(globalRow).toHaveTextContent('my skill');
    expect(globalRow).toHaveTextContent('acme/skills');
  });

  it('collapses one skill installed in both scopes into a single row', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' }), makeEntry({ name: 'shadcn', scope: 'global' })]);

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-shadcn/ui/shadcn');
    expect(screen.getAllByTestId('skills-row-shadcn/ui/shadcn')).toHaveLength(1);
  });

  it('keeps a source-less local skill under its own key, with no source and still removable', async () => {
    mockManifest([{ name: 'no-source', scope: 'project', source: null, sourceType: null, skillPath: null }]);

    render(<SkillsSection projectId="proj-a" />);

    const row = await screen.findByTestId('skills-row-local:no-source');
    expect(row).toHaveTextContent('no-source');
    expect(screen.getByTestId('skills-row-action-local:no-source')).toHaveTextContent('Installed');
  });

  it('disables every row action while an install is in flight', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' }), makeEntry({ name: 'my skill', scope: 'global' })]);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-shadcn/ui/shadcn');

    act(() => {
      useSkillsCliStore.setState({ installing: true });
    });

    expect(screen.getByTestId('skills-row-action-shadcn/ui/shadcn')).toBeDisabled();
    expect(screen.getByTestId('skills-row-action-shadcn/ui/my skill')).toBeDisabled();
  });
});

describe('SkillsSection — manifest unreadable', () => {
  it('says none are marked, rather than letting every row read as new', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockRejectedValue(new Error('502 Bad Gateway'));

    render(<SkillsSection projectId="proj-a" />);

    expect(await screen.findByTestId('skills-browse-manifest-error')).toHaveTextContent(
      "Couldn't read your installed skills, so none are marked here.",
    );
  });

  it('is absent once the manifest reads cleanly', async () => {
    mockManifest([]);

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-browse-catalog-unavailable');
    expect(screen.queryByTestId('skills-browse-manifest-error')).not.toBeInTheDocument();
  });
});

describe('SkillsSection — adapter note', () => {
  it('renders when adapterId is present and is not "claude"', async () => {
    mockManifest([]);

    render(<SkillsSection projectId="proj-a" adapterId="codex" />);

    const note = await screen.findByTestId('skills-section-adapter-note');
    expect(note).toHaveTextContent("The composer and sidebar skill lists show Claude's skills.");
  });

  it('is absent when adapterId is "claude"', async () => {
    mockManifest([]);

    render(<SkillsSection projectId="proj-a" adapterId="claude" />);

    await screen.findByTestId('skills-browse-catalog-unavailable');
    expect(screen.queryByTestId('skills-section-adapter-note')).not.toBeInTheDocument();
  });

  it('is absent when adapterId is undefined', async () => {
    mockManifest([]);

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-browse-catalog-unavailable');
    expect(screen.queryByTestId('skills-section-adapter-note')).not.toBeInTheDocument();
  });
});
