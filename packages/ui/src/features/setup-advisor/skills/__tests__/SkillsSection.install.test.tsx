/**
 * SkillsSection.install.test.tsx
 *
 * Red until `../SkillsSection` and `../InstallBand` exist (plan Group F3/F5).
 * Pins the install success outcome (plan E4): `installSkills` is called with
 * the typed source/selected names/chosen scope, success toasts via the
 * mocked `mfToast` (never sonner), and the manifest is refetched.
 *
 * The band lives under Browse, which is the tab that mounts first, and reads
 * Browse's one scope control rather than owning one.
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
import { useSkillsBrowseStore } from '../use-skills-browse-store';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';
import { mfToast } from '@/lib/toast';

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
    useSkillsBrowseStore.getState().reset();
  });
  vi.clearAllMocks();
  vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({ status: 'available', entries: [] });
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'unavailable' });
});

describe('SkillsSection — install success', () => {
  it('installs the selected names from the probed source into the chosen scope, toasts, and refetches', async () => {
    vi.mocked(skillsCliApi.probeSkillsSource).mockResolvedValue({
      status: 'probed',
      skills: [{ name: 'shadcn', description: 'shadcn/ui components' }],
    });
    vi.mocked(skillsCliApi.installSkills).mockResolvedValue(undefined);

    render(<SkillsSection projectId="proj-a" />);

    const source = screen.getByTestId('skills-section-source');
    fireEvent.change(source, { target: { value: 'shadcn/ui' } });
    fireEvent.blur(source);

    const option = await screen.findByTestId('skills-section-skill-option-shadcn');
    fireEvent.click(option);

    fireEvent.click(screen.getByTestId('skills-browse-scope-global'));

    vi.mocked(skillsCliApi.getSkillsCliManifest).mockClear();
    fireEvent.click(screen.getByTestId('skills-section-install'));

    await waitFor(() => expect(skillsCliApi.installSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.installSkills).toHaveBeenCalledWith('proj-a', 'shadcn/ui', ['shadcn'], 'global', undefined);

    await waitFor(() => expect(mfToast.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(skillsCliApi.getSkillsCliManifest).toHaveBeenCalled());
  });
});
