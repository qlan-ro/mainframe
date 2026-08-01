/**
 * InstallBand.test.tsx
 *
 * Red until `../InstallBand` exists (plan Group F3). Pins the install band's
 * states (plan E3) against a mocked `@/lib/api/skills-cli`; the band shares
 * the real `useSkillsCliStore` so a probe/install call is asserted at the
 * network boundary, never against store internals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  SkillsCliError: class SkillsCliError extends Error {},
}));

import { InstallBand } from '../InstallBand';
import { useSkillsCliStore } from '../use-skills-cli-store';
import * as skillsCliApi from '@/lib/api/skills-cli';

beforeEach(() => {
  act(() => {
    useSkillsCliStore.setState({
      status: 'available',
      entries: [],
      probe: null,
      installing: false,
      uninstallingKey: null,
      failure: null,
    });
  });
  vi.clearAllMocks();
});

describe('InstallBand — empty source', () => {
  it('disables the picker and Install', () => {
    render(<InstallBand projectId="proj-a" />);

    expect(screen.getByTestId('skills-section-install')).toBeDisabled();
    expect(screen.queryByTestId(/^skills-section-skill-option-/)).not.toBeInTheDocument();
  });
});

describe('InstallBand — probe trigger', () => {
  it('does not probe on keystroke; probes once on blur; probes once on Enter', async () => {
    vi.mocked(skillsCliApi.probeSkillsSource).mockResolvedValue({ status: 'probed', skills: [] });

    render(<InstallBand projectId="proj-a" />);
    const source = screen.getByTestId('skills-section-source');

    fireEvent.change(source, { target: { value: 'owner/repo' } });
    expect(skillsCliApi.probeSkillsSource).not.toHaveBeenCalled();

    fireEvent.blur(source);
    await waitFor(() => expect(skillsCliApi.probeSkillsSource).toHaveBeenCalledTimes(1));
    expect(skillsCliApi.probeSkillsSource).toHaveBeenCalledWith('proj-a', 'owner/repo', undefined);

    vi.mocked(skillsCliApi.probeSkillsSource).mockClear();
    fireEvent.change(source, { target: { value: 'owner/repo2' } });
    fireEvent.keyDown(source, { key: 'Enter' });
    await waitFor(() => expect(skillsCliApi.probeSkillsSource).toHaveBeenCalledTimes(1));
  });
});

describe('InstallBand — probing', () => {
  it('shows a spinner on the picker and keeps Install disabled', async () => {
    vi.mocked(skillsCliApi.probeSkillsSource).mockImplementation(() => new Promise(() => {}));

    render(<InstallBand projectId="proj-a" />);
    const source = screen.getByTestId('skills-section-source');
    fireEvent.change(source, { target: { value: 'owner/repo' } });
    fireEvent.blur(source);

    await screen.findByTestId('skills-section-skill-picker-spinner');
    expect(screen.getByTestId('skills-section-install')).toBeDisabled();
  });
});

describe('InstallBand — probed', () => {
  it('lists returned names; Install enables only after an explicit selection', async () => {
    vi.mocked(skillsCliApi.probeSkillsSource).mockResolvedValue({
      status: 'probed',
      skills: [{ name: 'shadcn', description: 'shadcn/ui components' }],
    });

    render(<InstallBand projectId="proj-a" />);
    const source = screen.getByTestId('skills-section-source');
    fireEvent.change(source, { target: { value: 'shadcn/ui' } });
    fireEvent.blur(source);

    const option = await screen.findByTestId('skills-section-skill-option-shadcn');
    expect(screen.getByTestId('skills-section-install')).toBeDisabled();

    fireEvent.click(option);
    expect(screen.getByTestId('skills-section-install')).toBeEnabled();
  });
});

describe('InstallBand — probe unparseable', () => {
  it('swaps the picker for a manual skill-name input and never prints a command', async () => {
    vi.mocked(skillsCliApi.probeSkillsSource).mockResolvedValue({ status: 'unparseable' });

    const { container } = render(<InstallBand projectId="proj-a" />);
    const source = screen.getByTestId('skills-section-source');
    fireEvent.change(source, { target: { value: 'owner/repo' } });
    fireEvent.blur(source);

    const manual = await screen.findByTestId('skills-section-skill-name-input');
    expect(manual).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/npx/);
  });
});

describe('InstallBand — probe returns zero skills', () => {
  it('says so, leaves Install disabled, and does not show manual entry', async () => {
    vi.mocked(skillsCliApi.probeSkillsSource).mockResolvedValue({ status: 'probed', skills: [] });

    render(<InstallBand projectId="proj-a" />);
    const source = screen.getByTestId('skills-section-source');
    fireEvent.change(source, { target: { value: 'owner/repo' } });
    fireEvent.blur(source);

    await screen.findByTestId('skills-section-skill-picker-empty');
    expect(screen.getByTestId('skills-section-install')).toBeDisabled();
    expect(screen.queryByTestId('skills-section-skill-name-input')).not.toBeInTheDocument();
  });
});

describe.each([
  ['leading dash', '-x'],
  ['local path', '/tmp/x'],
  ['host off the allowlist', 'https://evil.example.com/r'],
])('InstallBand — rejected source (%s)', (_label, source) => {
  it('renders an inline error before any process is spawned', () => {
    render(<InstallBand projectId="proj-a" />);
    const input = screen.getByTestId('skills-section-source');

    fireEvent.change(input, { target: { value: source } });
    fireEvent.blur(input);

    expect(screen.getByTestId('skills-section-source-error')).toBeInTheDocument();
    expect(skillsCliApi.probeSkillsSource).not.toHaveBeenCalled();
    expect(skillsCliApi.installSkills).not.toHaveBeenCalled();
  });
});

// Row-level Uninstall disabling while installing is pinned in SkillsSection.test.tsx
// (InstallBand renders no rows in isolation).
describe('InstallBand — installing', () => {
  it('disables every control in the band', () => {
    act(() => {
      useSkillsCliStore.setState({ installing: true });
    });

    render(<InstallBand projectId="proj-a" />);

    expect(screen.getByTestId('skills-section-source')).toBeDisabled();
    expect(screen.getByTestId('skills-section-install')).toBeDisabled();
    expect(screen.getByTestId('skills-section-scope-project')).toBeDisabled();
    expect(screen.getByTestId('skills-section-scope-global')).toBeDisabled();
  });
});
