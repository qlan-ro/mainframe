/**
 * SkillsSection.unavailable.test.tsx
 *
 * Red until `../SkillsSection` exists (plan Group F4/F5). Pins the
 * CLI-unavailable branch (plan E5): the whole body is replaced by an
 * explanatory block naming both `skills` and `npx skills`, install/uninstall
 * affordances are absent from the DOM (not merely disabled), the section is
 * not rendered as an error and not hidden, and a remote daemon target names
 * the daemon host while a local one does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

vi.mock('@/lib/daemon/active-daemon', () => ({
  getActiveDaemon: vi.fn(() => ({
    id: 'local',
    kind: 'local',
    label: 'Local',
    baseUrl: 'http://127.0.0.1:31415',
    token: null,
  })),
  setActiveDaemon: vi.fn(),
  subscribeActiveDaemon: vi.fn(() => () => {}),
}));

import { SkillsSection } from '../SkillsSection';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';
import * as activeDaemon from '@/lib/daemon/active-daemon';

beforeEach(() => {
  useSkillsCliStore.setState({
    status: 'idle',
    entries: [],
    probe: null,
    installing: false,
    uninstallingKey: null,
    failure: null,
  });
  vi.clearAllMocks();
  vi.mocked(activeDaemon.getActiveDaemon).mockReturnValue({
    id: 'local',
    kind: 'local',
    label: 'Local',
    baseUrl: 'http://127.0.0.1:31415',
    token: null,
  });
});

describe('SkillsSection — CLI unavailable', () => {
  it('names both "skills" and "npx skills"', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    render(<SkillsSection projectId="proj-a" />);

    const block = await screen.findByTestId('skills-section-cli-unavailable');
    expect(block).toHaveTextContent('skills');
    expect(block).toHaveTextContent('npx skills');
  });

  it('removes the Install control and every Uninstall control from the DOM', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-section-cli-unavailable');

    expect(screen.queryByTestId('skills-section-install')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^skills-section-uninstall-/)).not.toBeInTheDocument();
  });

  it('has no copy-affordance text beyond naming the two commands', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    render(<SkillsSection projectId="proj-a" />);

    const block = await screen.findByTestId('skills-section-cli-unavailable');
    const withoutCommandNames = block.textContent?.replace(/npx skills/g, '').replace(/skills/g, '') ?? '';
    expect(withoutCommandNames).not.toMatch(/npm i|npm install|copy/i);
  });

  it('is not rendered as an error state and is not hidden', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    render(<SkillsSection projectId="proj-a" />);

    const block = await screen.findByTestId('skills-section-cli-unavailable');
    expect(block).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the daemon host when the active target is remote', async () => {
    vi.mocked(activeDaemon.getActiveDaemon).mockReturnValue({
      id: 'remote-1',
      kind: 'remote',
      label: 'Office Mac',
      baseUrl: 'https://office-mac.example.com:31415',
      token: 'tok',
    });
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    render(<SkillsSection projectId="proj-a" />);

    const block = await screen.findByTestId('skills-section-cli-unavailable');
    expect(block).toHaveTextContent('Office Mac');
  });

  it('does not name a daemon host when the active target is local', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'unavailable',
      executable: 'skills',
      packageRunner: 'npx skills',
    });

    render(<SkillsSection projectId="proj-a" />);

    const block = await screen.findByTestId('skills-section-cli-unavailable');
    expect(block).not.toHaveTextContent('Local');
  });
});
