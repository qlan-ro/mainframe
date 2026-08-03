/**
 * SkillsSection.uninstall.test.tsx
 *
 * Pins the uninstall outcome: `uninstallSkills` is called with that row's skill
 * id and the scope it is being removed from — a global row sends `'global'`,
 * not the project id.
 *
 * A row installed in one scope removes on a click, since there is nothing to
 * ask. A row installed in both has to ask which one it means, so it goes
 * through the same scope popover installing uses.
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
import { makeEntry, mockCatalogUnavailable, mockManifest, resetSkillsStores } from './harness';

beforeEach(() => {
  resetSkillsStores();
  mockCatalogUnavailable();
  vi.mocked(skillsCliApi.uninstallSkills).mockResolvedValue(undefined);
});

describe('SkillsSection — uninstall success', () => {
  it('sends the row scope and skill id; a global row sends "global"', async () => {
    mockManifest([makeEntry({ name: 'my skill', scope: 'global' })]);

    render(<SkillsSection projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-shadcn/ui/my skill'));

    await waitFor(() => expect(skillsCliApi.uninstallSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.uninstallSkills).toHaveBeenCalledWith('proj-a', ['my skill'], 'global', undefined);
  });

  it('sends "project" for a project-scoped row', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);

    render(<SkillsSection projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-shadcn/ui/shadcn'));

    await waitFor(() => expect(skillsCliApi.uninstallSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.uninstallSkills).toHaveBeenCalledWith('proj-a', ['shadcn'], 'project', undefined);
  });

  it('asks which scope when the skill is installed in both, and removes only that one', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' }), makeEntry({ name: 'shadcn', scope: 'global' })]);

    render(<SkillsSection projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-shadcn/ui/shadcn'));

    const menu = await screen.findByTestId('skills-row-scope-shadcn/ui/shadcn');
    expect(menu).toHaveTextContent('This project');
    expect(menu).toHaveTextContent('All projects');

    fireEvent.click(screen.getByTestId('skills-row-scope-shadcn/ui/shadcn-global'));

    await waitFor(() => expect(skillsCliApi.uninstallSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.uninstallSkills).toHaveBeenCalledWith('proj-a', ['shadcn'], 'global', undefined);
  });

  it('passes the adapter id through', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);

    render(<SkillsSection projectId="proj-a" adapterId="codex" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-shadcn/ui/shadcn'));

    await waitFor(() =>
      expect(skillsCliApi.uninstallSkills).toHaveBeenCalledWith('proj-a', ['shadcn'], 'project', 'codex'),
    );
  });

  it('marks the row as removing while it runs', async () => {
    mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);
    vi.mocked(skillsCliApi.uninstallSkills).mockImplementation(() => new Promise(() => {}));

    render(<SkillsSection projectId="proj-a" />);

    const action = await screen.findByTestId('skills-row-action-shadcn/ui/shadcn');
    fireEvent.click(action);

    const running = await screen.findByTestId('skills-row-action-shadcn/ui/shadcn');
    await waitFor(() => expect(running).toHaveAttribute('aria-busy', 'true'));
    expect(running).toHaveTextContent('Removing');
  });
});
