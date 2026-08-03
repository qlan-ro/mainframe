/**
 * SkillsSection.install.test.tsx
 *
 * Pins the install success outcome for the source band: `installSkills` is
 * called with the typed source, the selected names, and the scope picked on the
 * Install button, success toasts via the mocked `mfToast` (never sonner), and
 * the manifest is refetched so the new skill joins the installed rows.
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
  mfToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    permission: vi.fn(),
  },
}));

import { SkillsSection } from '../SkillsSection';
import * as skillsCliApi from '@/lib/api/skills-cli';
import { mfToast } from '@/lib/toast';
import { mockCatalogUnavailable, mockManifest, resetSkillsStores } from './harness';

beforeEach(() => {
  resetSkillsStores();
  mockManifest([]);
  mockCatalogUnavailable();
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

    fireEvent.click(await screen.findByTestId('skills-section-skill-option-shadcn'));

    vi.mocked(skillsCliApi.getSkillsCliManifest).mockClear();
    fireEvent.click(screen.getByTestId('skills-section-install'));
    fireEvent.click(await screen.findByTestId('skills-section-install-scope-global'));

    await waitFor(() => expect(skillsCliApi.installSkills).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.installSkills).toHaveBeenCalledWith('proj-a', 'shadcn/ui', ['shadcn'], 'global', undefined);

    await waitFor(() => expect(mfToast.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(skillsCliApi.getSkillsCliManifest).toHaveBeenCalled());
  });
});
