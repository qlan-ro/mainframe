/**
 * SkillsSection.test.tsx
 *
 * Red until `../SkillsSection` exists (plan Group F5). Pins the manifest
 * render states (plan E2) against a mocked `@/lib/api/skills-cli`. Install
 * band interaction is covered by InstallBand.test.tsx; success/failure
 * outcomes by the SkillsSection.{install,uninstall,failure}.test.tsx trio;
 * the CLI-unavailable branch by SkillsSection.unavailable.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

import { SkillsSection } from '../SkillsSection';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

function makeEntry(overrides: Partial<SkillsCliEntry> & { name: string; scope: 'project' | 'global' }): SkillsCliEntry {
  return {
    source: 'shadcn/ui',
    sourceType: 'github',
    skillPath: `skills/${overrides.name}/SKILL.md`,
    ...overrides,
  };
}

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
  });
  vi.clearAllMocks();
});

describe('SkillsSection — loading', () => {
  it('renders skeleton rows, not a spinner', () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockImplementation(() => new Promise(() => {}));

    render(<SkillsSection projectId="proj-a" />);

    expect(screen.getAllByTestId('skills-section-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('skills-section-empty')).not.toBeInTheDocument();
  });
});

describe('SkillsSection — populated', () => {
  it('renders one row per entry, project and global scopes in one list, keyed by scope and name', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [
        makeEntry({ name: 'shadcn', scope: 'project', source: 'shadcn/ui' }),
        makeEntry({ name: 'my skill', scope: 'global', source: 'acme/skills' }),
      ],
    });

    render(<SkillsSection projectId="proj-a" />);

    const projectRow = await screen.findByTestId('skills-section-row-project-shadcn');
    const globalRow = await screen.findByTestId('skills-section-row-global-my skill');

    expect(projectRow).toHaveTextContent('shadcn');
    expect(projectRow).toHaveTextContent('shadcn/ui');
    expect(globalRow).toHaveTextContent('my skill');
    expect(globalRow).toHaveTextContent('acme/skills');
  });

  it('renders two entries sharing a name across scopes as two distinct rows', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'shadcn', scope: 'project' }), makeEntry({ name: 'shadcn', scope: 'global' })],
    });

    render(<SkillsSection projectId="proj-a" />);

    const projectRow = await screen.findByTestId('skills-section-row-project-shadcn');
    const globalRow = await screen.findByTestId('skills-section-row-global-shadcn');

    expect(projectRow).not.toBe(globalRow);
  });

  it('keeps the Uninstall slot present on every row whether or not one is running', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'shadcn', scope: 'project' }), makeEntry({ name: 'my skill', scope: 'global' })],
    });

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-section-row-project-shadcn');

    act(() => {
      useSkillsCliStore.setState({ uninstallingKey: 'project:shadcn' });
    });

    const running = screen.getByTestId('skills-section-uninstall-project-shadcn');
    const other = screen.getByTestId('skills-section-uninstall-global-my skill');

    expect(running).toBeInTheDocument();
    expect(other).toBeInTheDocument();
    expect(running).toHaveAttribute('aria-busy', 'true');
  });

  it('disables every row Uninstall while an install is in flight', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'shadcn', scope: 'project' }), makeEntry({ name: 'my skill', scope: 'global' })],
    });

    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-section-row-project-shadcn');

    act(() => {
      useSkillsCliStore.setState({ installing: true });
    });

    expect(screen.getByTestId('skills-section-uninstall-project-shadcn')).toBeDisabled();
    expect(screen.getByTestId('skills-section-uninstall-global-my skill')).toBeDisabled();
  });
});

describe('SkillsSection — empty', () => {
  it('renders "No skills installed by the CLI"', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });

    render(<SkillsSection projectId="proj-a" />);

    const empty = await screen.findByTestId('skills-section-empty');
    expect(empty).toHaveTextContent('No skills installed by the CLI');
  });
});

describe('SkillsSection — adapter note', () => {
  it('renders when adapterId is present and is not "claude"', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });

    render(<SkillsSection projectId="proj-a" adapterId="codex" />);

    const note = await screen.findByTestId('skills-section-adapter-note');
    expect(note).toHaveTextContent("The composer and sidebar skill lists show Claude's skills.");
  });

  it('is absent when adapterId is "claude"', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });

    render(<SkillsSection projectId="proj-a" adapterId="claude" />);

    await screen.findByTestId('skills-section-empty');
    expect(screen.queryByTestId('skills-section-adapter-note')).not.toBeInTheDocument();
  });

  it('is absent when adapterId is undefined', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-section-empty');
    expect(screen.queryByTestId('skills-section-adapter-note')).not.toBeInTheDocument();
  });
});
