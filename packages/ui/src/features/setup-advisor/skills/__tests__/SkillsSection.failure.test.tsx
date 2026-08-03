/**
 * SkillsSection.failure.test.tsx
 *
 * Pins the failure outcome: a thrown `SkillsCliError` with a tail toasts via
 * the mocked `mfToast` AND renders `skills-section-failure-tail`, the tail
 * persists past toast dismissal, carries no ANSI escape, and the rendered rows
 * equal the re-read manifest, never an optimistic mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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
import * as skillsCliApi from '@/lib/api/skills-cli';
import { mfToast } from '@/lib/toast';
import { makeEntry, mockCatalogUnavailable, mockManifest, resetSkillsStores } from './harness';

const TAIL = 'npm ERR! code E404\nnpm ERR! 404 Not Found';

beforeEach(() => {
  resetSkillsStores();
  mockCatalogUnavailable();
  mockManifest([makeEntry({ name: 'shadcn', scope: 'project' })]);
  vi.mocked(skillsCliApi.uninstallSkills).mockRejectedValue(new SkillsCliError('Uninstall failed', TAIL, 1));
});

describe('SkillsSection — uninstall failure', () => {
  it('toasts and renders the tail, without mutating the row list optimistically', async () => {
    render(<SkillsSection projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-shadcn/ui/shadcn'));

    await waitFor(() => expect(mfToast.error).toHaveBeenCalledTimes(1));

    const tail = await screen.findByTestId('skills-section-failure-tail');
    // Not `toHaveTextContent`: it normalizes the element's text but not the
    // expected string, so an embedded newline could never match.
    expect(tail.textContent).toContain(TAIL);
    expect(tail.textContent).not.toMatch(/\[/);

    // The manifest fetch is re-read after the failed op, and the row that
    // failed to uninstall is still there because the re-read said so.
    expect(await screen.findByTestId('skills-row-shadcn/ui/shadcn')).toBeInTheDocument();
  });

  it('keeps the tail rendered well past a typical toast auto-dismiss duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<SkillsSection projectId="proj-a" />);

    fireEvent.click(await screen.findByTestId('skills-row-action-shadcn/ui/shadcn'));

    await screen.findByTestId('skills-section-failure-tail');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByTestId('skills-section-failure-tail')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
