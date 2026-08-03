/**
 * SkillsSection.loading.test.tsx
 *
 * Pins what the panel says while it is reading. Two reads feed one list and
 * they land at different times, so the cases that matter are the asymmetric
 * ones: the registry answering before the manifest must not put a row on
 * screen, because the row's action would be claiming the skill isn't installed
 * before anything knows. A refresh is the opposite case — the rows are already
 * true, so they stay, and the search field carries the only signal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

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
import { makeEntry, mockCatalog, mockCatalogUnavailable, mockManifest, resetSkillsStores } from './harness';

const PDF = { source: 'anthropic/skills', skillId: 'pdf', name: 'PDF', installs: 2_800_000, isOfficial: true };

/** Lets both mocked reads settle without asserting on either. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetSkillsStores();
});

describe('SkillsSection — first read', () => {
  it('holds the whole list in skeletons until the manifest lands, even once the catalog has', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(() => new Promise(() => {}));
    mockCatalog([PDF]);

    render(<SkillsSection projectId="proj-a" />);
    await flush();

    expect(screen.queryByTestId('skills-row-anthropic/skills/pdf')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skills-browse-skeleton').length).toBeGreaterThan(0);
  });

  it('marks the search field as loading until both reads settle', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(() => new Promise(() => {}));
    vi.mocked(skillsCliApi.getSkillsCatalog).mockImplementation(() => new Promise(() => {}));

    render(<SkillsSection projectId="proj-a" />);

    expect(screen.getByTestId('skills-browse-loading')).toBeInTheDocument();
  });

  it('drops the loading mark once the list is real', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);
    mockCatalog([PDF]);

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-shadcn/ui/shadcn');
    await waitFor(() => expect(screen.queryByTestId('skills-browse-loading')).not.toBeInTheDocument());
  });
});

describe('SkillsSection — refresh', () => {
  it('keeps the rows and marks the field instead of blanking back to skeletons', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);
    mockCatalogUnavailable();

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-shadcn/ui/shadcn');

    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(() => new Promise(() => {}));
    act(() => {
      void useSkillsCliStore.getState().loadManifest('proj-a');
    });

    expect(screen.getByTestId('skills-row-shadcn/ui/shadcn')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-browse-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('skills-browse-loading')).toBeInTheDocument();
  });
});

describe('SkillsSection — search', () => {
  it('marks the field while a query is in flight and clears it when results land', async () => {
    mockManifest([]);
    mockCatalog([PDF]);
    vi.mocked(skillsCliApi.searchSkills).mockResolvedValue([
      { source: 'acme/skills', skillId: 'pdf-tools', name: 'PDF Tools', installs: 12 },
    ]);

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    fireEvent.change(screen.getByTestId('skills-browse-search'), { target: { value: 'pdf' } });

    expect(screen.getByTestId('skills-browse-loading')).toBeInTheDocument();

    await screen.findByTestId('skills-row-acme/skills/pdf-tools');
    await waitFor(() => expect(screen.queryByTestId('skills-browse-loading')).not.toBeInTheDocument());
  });
});
