/**
 * SkillsSection.merged.test.tsx
 *
 * Pins the one-list arrangement that replaced the Browse / Installed tabs:
 * what you have comes first, the registry follows, and the two are told apart
 * by their section headers rather than by a mode the user has to pick.
 *
 * Also pins the action a row offers, which is the whole point of merging them:
 * an installed row reads "Installed" and only becomes Uninstall on hover, so
 * the button never claims to install something that is already there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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
import { makeEntry, mockCatalog, mockManifest, resetSkillsStores } from './harness';

const PDF = { source: 'anthropic/skills', skillId: 'pdf', name: 'PDF', installs: 2_800_000, isOfficial: true };
const LINTER = { source: 'yaml/tools', skillId: 'linter', name: 'YAML Linter', installs: 900, isOfficial: false };

beforeEach(() => {
  resetSkillsStores();
  mockCatalog([PDF, LINTER]);
  mockManifest([makeEntry({ name: 'pdf', scope: 'project', source: 'anthropic/skills' })]);
});

describe('SkillsSection — one list', () => {
  it('renders installed rows above registry rows, under their own headers', async () => {
    const { container } = render(<SkillsSection projectId="proj-a" />);

    const installed = await screen.findByTestId('skills-row-anthropic/skills/pdf');
    const available = screen.getByTestId('skills-row-yaml/tools/linter');

    expect(installed.compareDocumentPosition(available) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain('Installed');
    expect(container.textContent).toContain('From skills.sh');
  });

  it('shows an installed skill once, not once per list', async () => {
    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-anthropic/skills/pdf');
    expect(screen.getAllByTestId('skills-row-anthropic/skills/pdf')).toHaveLength(1);
  });

  it('drops the headers when nothing is installed — there is only one list to label', async () => {
    mockManifest([]);

    const { container } = render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-anthropic/skills/pdf');
    expect(container.textContent).not.toContain('From skills.sh');
  });

  it('has no tab strip and no standalone scope control', async () => {
    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-anthropic/skills/pdf');
    expect(screen.queryByTestId('skills-section-tab-browse')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-section-tab-installed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-browse-scope-global')).not.toBeInTheDocument();
  });
});

describe('SkillsSection — the row action', () => {
  it('reads "Installed" at rest and swaps to "Uninstall" on hover', async () => {
    render(<SkillsSection projectId="proj-a" />);

    const row = await screen.findByTestId('skills-row-anthropic/skills/pdf');
    const action = screen.getByTestId('skills-row-action-anthropic/skills/pdf');
    expect(action).toHaveTextContent('Installed');

    fireEvent.mouseEnter(row);
    expect(action).toHaveTextContent('Uninstall');

    fireEvent.mouseLeave(row);
    expect(action).toHaveTextContent('Installed');
  });

  it('swaps on keyboard focus too, so uninstall is reachable without a pointer', async () => {
    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-anthropic/skills/pdf');
    const action = screen.getByTestId('skills-row-action-anthropic/skills/pdf');

    fireEvent.focus(action);
    expect(action).toHaveTextContent('Uninstall');
  });

  it('stays focusable while it reads "Installed" — a disabled button takes no focus', async () => {
    render(<SkillsSection projectId="proj-a" />);

    await screen.findByTestId('skills-row-anthropic/skills/pdf');
    expect(screen.getByTestId('skills-row-action-anthropic/skills/pdf')).toBeEnabled();
  });

  it('offers Install on a registry row', async () => {
    render(<SkillsSection projectId="proj-a" />);

    expect(await screen.findByTestId('skills-row-action-yaml/tools/linter')).toHaveTextContent('Install');
  });
});

describe('SkillsSection — the failure tail', () => {
  it('stays readable underneath the list', async () => {
    render(<SkillsSection projectId="proj-a" />);
    await screen.findByTestId('skills-row-anthropic/skills/pdf');

    act(() => {
      useSkillsCliStore.setState({ failure: { message: 'Install failed', tail: 'npm ERR! 404' } });
    });

    expect(screen.getByTestId('skills-section-failure-tail')).toHaveTextContent('npm ERR! 404');
  });
});
