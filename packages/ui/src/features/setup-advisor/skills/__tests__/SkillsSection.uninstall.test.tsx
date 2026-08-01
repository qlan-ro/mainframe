/**
 * SkillsSection.uninstall.test.tsx
 *
 * Red until `../SkillsSection` exists (plan Group F5). Pins the uninstall
 * success outcome (plan E4): `uninstallSkills` is called with that row's
 * name and scope — a global row sends `'global'`, not the project id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

vi.mock('@/lib/toast', () => ({
  mfToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    permission: vi.fn(),
  },
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

describe('SkillsSection — uninstall success', () => {
  it('sends the row scope and name; a global row sends "global"', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'my skill', scope: 'global' })],
    });
    vi.mocked(skillsCliApi.uninstallSkills).mockResolvedValue(undefined);

    render(<SkillsSection projectId="proj-a" />);

    const uninstallButton = await screen.findByTestId('skills-section-uninstall-global-my skill');
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(skillsCliApi.uninstallSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.uninstallSkills).toHaveBeenCalledWith('proj-a', ['my skill'], 'global', undefined);
  });

  it('sends "project" for a project-scoped row', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'shadcn', scope: 'project' })],
    });
    vi.mocked(skillsCliApi.uninstallSkills).mockResolvedValue(undefined);

    render(<SkillsSection projectId="proj-a" />);

    const uninstallButton = await screen.findByTestId('skills-section-uninstall-project-shadcn');
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(skillsCliApi.uninstallSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.uninstallSkills).toHaveBeenCalledWith('proj-a', ['shadcn'], 'project', undefined);
  });
});
