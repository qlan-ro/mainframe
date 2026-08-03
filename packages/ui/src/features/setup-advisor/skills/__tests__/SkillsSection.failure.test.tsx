/**
 * SkillsSection.failure.test.tsx
 *
 * Red until `../SkillsSection` exists (plan Group F5). Pins the failure
 * outcome (plan E4): a thrown `SkillsCliError` with a tail toasts via the
 * mocked `mfToast` AND renders `skills-section-failure-tail`, the tail
 * persists past toast dismissal, carries no ANSI escape, and the rendered
 * rows equal the re-read manifest, never an optimistic mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';

// `vi.hoisted` because `vi.mock`'s factory is hoisted above the module body and
// runs during the first import of the mocked module — a plain class declaration
// here would still be in its temporal dead zone by then.
const { SkillsCliError } = vi.hoisted(() => ({
  SkillsCliError: class SkillsCliError extends Error {
    readonly tail?: string;
    readonly exitCode?: number | null;

    constructor(message: string, tail?: string, exitCode?: number | null) {
      super(message);
      this.name = 'SkillsCliError';
      this.tail = tail;
      this.exitCode = exitCode;
    }
  },
}));

vi.mock('@/lib/api/skills-cli', () => ({
  getSkillsCliManifest: vi.fn(),
  probeSkillsSource: vi.fn(),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
  getSkillsCatalog: vi.fn(),
  searchSkills: vi.fn(),
  SkillsCliError,
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

function makeEntry(overrides: Partial<SkillsCliEntry> & { name: string; scope: 'project' | 'global' }): SkillsCliEntry {
  return {
    source: 'shadcn/ui',
    sourceType: 'github',
    skillPath: `skills/${overrides.name}/SKILL.md`,
    ...overrides,
  };
}

/** Renders the section and opens Installed — Browse is what mounts first. */
function renderInstalled(projectId: string) {
  const result = render(<SkillsSection projectId={projectId} />);
  fireEvent.click(screen.getByTestId('skills-section-tab-installed'));
  return result;
}

const TAIL = 'npm ERR! code E404\nnpm ERR! 404 Not Found';

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
  vi.mocked(skillsCliApi.getSkillsCatalog).mockResolvedValue({ status: 'unavailable' });
});

describe('SkillsSection — uninstall failure', () => {
  it('toasts and renders the tail, without mutating the row list optimistically', async () => {
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'shadcn', scope: 'project' })],
    });
    vi.mocked(skillsCliApi.uninstallSkills).mockRejectedValue(new SkillsCliError('Uninstall failed', TAIL, 1));

    renderInstalled('proj-a');

    const uninstallButton = await screen.findByTestId('skills-section-uninstall-project-shadcn');
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(mfToast.error).toHaveBeenCalledTimes(1));

    const tail = await screen.findByTestId('skills-section-failure-tail');
    // Not `toHaveTextContent`: it normalizes the element's text but not the
    // expected string, so an embedded newline could never match.
    expect(tail.textContent).toContain(TAIL);
    expect(tail.textContent).not.toMatch(/\[/);

    // The manifest fetch is re-read after the failed op, and the row that
    // failed to uninstall is still there because the re-read said so.
    expect(await screen.findByTestId('skills-section-row-project-shadcn')).toBeInTheDocument();
  });

  it('keeps the tail rendered well past a typical toast auto-dismiss duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(skillsCliApi.getSkillsCliManifest).mockResolvedValue({
      status: 'available',
      entries: [makeEntry({ name: 'shadcn', scope: 'project' })],
    });
    vi.mocked(skillsCliApi.uninstallSkills).mockRejectedValue(new SkillsCliError('Uninstall failed', TAIL, 1));

    renderInstalled('proj-a');

    const uninstallButton = await screen.findByTestId('skills-section-uninstall-project-shadcn');
    fireEvent.click(uninstallButton);

    await screen.findByTestId('skills-section-failure-tail');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByTestId('skills-section-failure-tail')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
