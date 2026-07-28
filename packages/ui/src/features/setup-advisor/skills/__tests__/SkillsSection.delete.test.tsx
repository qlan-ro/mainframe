/**
 * Delete-flow contract for SkillsSection (plan T25, split out per the plan's
 * 300-line guidance): the naming confirmation, success/failure toasts, the
 * D10 identity-switch guard on a held selection and a pending confirm, and
 * the D9 nested-dialog survival guard. See `SkillsSection.test.tsx` for
 * list/search/status/inspect/gating/CLI-suggestion coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Skill } from '@qlan-ro/mainframe-types';

vi.mock('../use-skills-section', () => ({ useSkillsSection: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { success: vi.fn(), error: vi.fn() } }));

import { SkillsSection } from '../SkillsSection';
import { useSkillsSection } from '../use-skills-section';
import type { SkillsSectionState } from '../use-skills-section';
import { mfToast } from '@/lib/toast';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const useSkillsSectionMock = vi.mocked(useSkillsSection);

const reviewProject: Skill = {
  id: 'claude:project:review',
  adapterId: 'claude',
  name: 'review',
  displayName: 'Review',
  description: 'Reviews code for correctness',
  scope: 'project',
  filePath: '/p/.claude/skills/review/SKILL.md',
  content: '# Review',
  invocationName: 'review',
};

interface Fixture {
  state: SkillsSectionState;
  identityKey: string;
  reload: () => void;
  remove: (id: string) => Promise<void>;
}

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    state: { status: 'empty' },
    identityKey: 'claude /p',
    reload: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function AdvisorStub({ children }: { children: React.ReactNode }) {
  return (
    <Dialog open>
      <DialogContent data-testid="automation-recommender-sheet">{children}</DialogContent>
    </Dialog>
  );
}

beforeEach(() => {
  useSkillsSectionMock.mockReset();
  vi.mocked(mfToast.success).mockReset();
  vi.mocked(mfToast.error).mockReset();
});

describe('SkillsSection — delete confirm', () => {
  it('names the skill in the title and its on-disk directory in the body; cancel closes it and never calls remove', () => {
    const remove = vi.fn();
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject] }, remove }));
    render(<SkillsSection />);

    fireEvent.click(screen.getByTestId(`skills-section-delete-${reviewProject.id}`));

    expect(screen.getByTestId('skills-delete-confirm')).toBeTruthy();
    expect(screen.getByText('Delete Review?')).toBeTruthy();
    expect(screen.getByText('Deletes /p/.claude/skills/review from disk. This cannot be undone.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('skills-delete-confirm-cancel'));

    expect(screen.queryByTestId('skills-delete-confirm')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('SkillsSection — delete success', () => {
  it('confirming calls remove, toasts success, and closes the inspect view for the deleted skill', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject] }, remove }));
    render(<SkillsSection />);

    fireEvent.click(screen.getByTestId(`skills-section-row-${reviewProject.id}`));
    fireEvent.click(screen.getByTestId(`skills-section-delete-${reviewProject.id}`));
    fireEvent.click(screen.getByTestId('skills-delete-confirm-confirm'));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(reviewProject.id));
    await waitFor(() => expect(mfToast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('skills-section-inspect')).toBeNull());
  });
});

describe('SkillsSection — delete failure (D10 stale-selection guard)', () => {
  it('toasts the daemon message and keeps the inspect view showing the deleted-attempt skill even once state goes to loading with no skills', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Operation failed'));
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject] }, remove }));
    const { rerender } = render(<SkillsSection />);

    fireEvent.click(screen.getByTestId(`skills-section-row-${reviewProject.id}`));
    fireEvent.click(screen.getByTestId(`skills-section-delete-${reviewProject.id}`));
    fireEvent.click(screen.getByTestId('skills-delete-confirm-confirm'));

    await waitFor(() =>
      expect(mfToast.error).toHaveBeenCalledWith('Could not delete skill', { description: 'Operation failed' }),
    );
    expect(screen.queryByTestId('skills-delete-confirm')).toBeNull();

    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'loading' }, remove }));
    rerender(<SkillsSection />);

    const inspect = screen.getByTestId('skills-section-inspect');
    expect(inspect).toHaveTextContent(reviewProject.displayName);
  });
});

describe('SkillsSection — identity switch drops a held selection (D10)', () => {
  it('closes the inspect view when identityKey changes after an adapter switch', () => {
    useSkillsSectionMock.mockReturnValue(
      fixture({ state: { status: 'ready', skills: [reviewProject] }, identityKey: 'claude /p' }),
    );
    const { rerender } = render(<SkillsSection />);
    fireEvent.click(screen.getByTestId(`skills-section-row-${reviewProject.id}`));
    expect(screen.getByTestId('skills-section-inspect')).toBeTruthy();

    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [] }, identityKey: 'codex /p' }));
    rerender(<SkillsSection />);

    expect(screen.queryByTestId('skills-section-inspect')).toBeNull();
  });

  it('closes the inspect view when identityKey changes after a project switch', () => {
    useSkillsSectionMock.mockReturnValue(
      fixture({ state: { status: 'ready', skills: [reviewProject] }, identityKey: 'claude /a' }),
    );
    const { rerender } = render(<SkillsSection />);
    fireEvent.click(screen.getByTestId(`skills-section-row-${reviewProject.id}`));
    expect(screen.getByTestId('skills-section-inspect')).toBeTruthy();

    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [] }, identityKey: 'claude /b' }));
    rerender(<SkillsSection />);

    expect(screen.queryByTestId('skills-section-inspect')).toBeNull();
  });

  it('closes a pending delete confirmation on an identity switch, and remove is never called against the new identity', () => {
    const remove = vi.fn();
    useSkillsSectionMock.mockReturnValue(
      fixture({ state: { status: 'ready', skills: [reviewProject] }, remove, identityKey: 'claude /a' }),
    );
    const { rerender } = render(<SkillsSection />);
    fireEvent.click(screen.getByTestId(`skills-section-delete-${reviewProject.id}`));
    expect(screen.getByTestId('skills-delete-confirm')).toBeTruthy();

    useSkillsSectionMock.mockReturnValue(
      fixture({ state: { status: 'ready', skills: [] }, remove, identityKey: 'claude /b' }),
    );
    rerender(<SkillsSection />);

    expect(screen.queryByTestId('skills-delete-confirm')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('SkillsSection — nested dialog survival (D9)', () => {
  it('leaves the outer advisor dialog mounted after confirming, and again after cancelling', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject] }, remove }));

    render(
      <AdvisorStub>
        <SkillsSection />
      </AdvisorStub>,
    );

    fireEvent.click(screen.getByTestId(`skills-section-delete-${reviewProject.id}`));
    fireEvent.click(screen.getByTestId('skills-delete-confirm-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(screen.getByTestId('automation-recommender-sheet')).toBeTruthy();
    expect(screen.getByTestId(`skills-section-row-${reviewProject.id}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`skills-section-delete-${reviewProject.id}`));
    fireEvent.click(screen.getByTestId('skills-delete-confirm-cancel'));
    expect(screen.getByTestId('automation-recommender-sheet')).toBeTruthy();
  });
});
