/**
 * SkillsSection.row-install.test.tsx
 *
 * Installing from a row sends that row's own source and skill id — a skill id
 * is only unique within its source, so a row that installed the wrong pair
 * would look right and land the wrong skill.
 *
 * Scope is asked by the Install button itself, at the moment of installing,
 * rather than read off a control set minutes earlier. That makes the popover
 * part of the install path, so every case here goes through it.
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

vi.mock('@/lib/toast', () => ({
  mfToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), permission: vi.fn() },
}));

import { SkillsSection } from '../SkillsSection';
import * as skillsCliApi from '@/lib/api/skills-cli';
import { mockCatalog, mockManifest, resetSkillsStores } from './harness';

const ROWS = [
  { source: 'anthropic/skills', skillId: 'pdf', name: 'PDF', installs: 2_800_000, isOfficial: true },
  { source: 'acme/skills', skillId: 'pdf', name: 'Acme PDF', installs: 42, isOfficial: false },
];

/** Opens a row's scope popover and picks one, the way a user installs. */
async function install(key: string, scope: 'project' | 'global') {
  fireEvent.click(await screen.findByTestId(`skills-row-action-${key}`));
  fireEvent.click(await screen.findByTestId(`skills-row-scope-${key}-${scope}`));
}

beforeEach(() => {
  resetSkillsStores();
  mockCatalog(ROWS);
  mockManifest([]);
  vi.mocked(skillsCliApi.installSkills).mockResolvedValue(undefined);
});

describe('SkillsSection — install from a row', () => {
  it("sends that row's source and skill id, not another row sharing the id", async () => {
    render(<SkillsSection projectId="proj-a" />);

    await install('acme/skills/pdf', 'project');

    await waitFor(() => expect(skillsCliApi.installSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.installSkills).toHaveBeenCalledWith('proj-a', 'acme/skills', ['pdf'], 'project', undefined);
  });

  it('installs to the scope picked in the row popover', async () => {
    render(<SkillsSection projectId="proj-a" />);

    await install('anthropic/skills/pdf', 'global');

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

  it("names the scopes in the user's terms, not the CLI's", async () => {
    render(<SkillsSection projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-acme/skills/pdf'));

    const menu = await screen.findByTestId('skills-row-scope-acme/skills/pdf');
    expect(menu).toHaveTextContent('This project');
    expect(menu).toHaveTextContent('All projects');
  });

  it('passes the adapter id through', async () => {
    render(<SkillsSection projectId="proj-a" adapterId="codex" />);

    await install('anthropic/skills/pdf', 'project');

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

  it('marks only the running row busy, and disables every other action', async () => {
    vi.mocked(skillsCliApi.installSkills).mockImplementation(() => new Promise(() => {}));

    render(<SkillsSection projectId="proj-a" />);
    await install('acme/skills/pdf', 'project');

    const running = await screen.findByTestId('skills-row-action-acme/skills/pdf');
    const other = screen.getByTestId('skills-row-action-anthropic/skills/pdf');

    await waitFor(() => expect(running).toHaveAttribute('aria-busy', 'true'));
    expect(running).toHaveTextContent('Installing');
    expect(other).not.toHaveAttribute('aria-busy', 'true');
    expect(running).toBeDisabled();
    expect(other).toBeDisabled();
  });
});
