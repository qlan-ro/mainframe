/**
 * BranchChip — the branch manager's toolbar entry (moved out of MainToolbar's
 * suite when the toolbar's left identity section was retired).
 *
 * The chip's whole job is resolving WHICH branch to show and WHETHER the
 * popover may open: a worktree draft has no daemon chat, so a live git read
 * answers for the project ROOT — the chip must show the draft's own branch and
 * keep branch actions locked until the first send stamps a chatId.
 */
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetGitBranch = vi.fn();
vi.mock('@/lib/api/git', () => ({ getGitBranch: (...a: unknown[]) => mockGetGitBranch(...a) }));

// Stub BranchPopover: renders the trigger (children) plus a button that fires
// onBranchChanged, so the chip's refresh wiring can be tested without driving
// the real popover's git actions. Its presence also proves the popover is wired.
vi.mock('../BranchPopover', () => ({
  BranchPopover: (props: { children?: React.ReactNode; onBranchChanged?: () => void }) => (
    <>
      {props.children}
      <button data-testid="mock-branch-changed" onClick={() => props.onBranchChanged?.()}>
        trigger
      </button>
    </>
  ),
}));

import { BranchChip } from '../BranchChip';
import { TooltipProvider } from '@v2/components/ui/tooltip';

// v2 Hint/Tooltip require the v2 TooltipProvider (app-root concern; SidebarProvider mounts it live).
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

type ChipProps = Parameters<typeof BranchChip>[0];

const renderChip = (overrides: Partial<ChipProps> = {}) => render(<BranchChip port={31415} {...overrides} />);

beforeEach(() => {
  mockGetGitBranch.mockReset();
});

describe('BranchChip — branch resolution', () => {
  it('shows the live git branch for a main-repo session, with an open popover', async () => {
    mockGetGitBranch.mockResolvedValue({ branch: 'main' });

    renderChip({ projectId: 'p1', chatId: 'c1' });

    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('main');
    expect(chip).not.toBeDisabled();
    expect(chip.getAttribute('data-worktree')).toBe('false');
    expect(screen.queryByTestId('main-toolbar-branch-wt')).toBeNull();
    expect(mockGetGitBranch).toHaveBeenCalledWith(31415, 'p1', 'c1');
  });

  it('marks a worktree session with a WT badge', async () => {
    mockGetGitBranch.mockResolvedValue({ branch: 'feat/x' });

    renderChip({ projectId: 'p1', chatId: 'c1', branchName: 'feat/x', isWorktree: true });

    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/x');
    expect(chip.getAttribute('data-worktree')).toBe('true');
    expect(screen.getByTestId('main-toolbar-branch-wt').textContent?.trim()).toBe('wt');
  });

  it('prefers the draft worktree branch over the live project-root branch when there is no chatId yet', async () => {
    // A draft attached to a worktree has no daemon chat yet, so the live fetch
    // can only see the project ROOT branch — the chip must show the worktree's.
    mockGetGitBranch.mockResolvedValue({ branch: 'main' });

    renderChip({ projectId: 'p1', branchName: 'feat/wt-draft', isWorktree: true });

    await waitFor(() => expect(mockGetGitBranch).toHaveBeenCalled());
    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/wt-draft');
    expect(chip.getAttribute('data-worktree')).toBe('true');
  });
});

describe('BranchChip — when the popover stays locked', () => {
  it('disables the chip (no popover) for a pre-send worktree draft', async () => {
    // Without a chatId, branch actions would run against the project ROOT while
    // the chip advertises worktree isolation.
    mockGetGitBranch.mockResolvedValue({ branch: 'main' });

    renderChip({ projectId: 'p1', branchName: 'feat/wt-draft', isWorktree: true });

    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip).toBeDisabled();
    expect(screen.queryByTestId('mock-branch-changed')).toBeNull();
    // The pending worktree choice stays visible on the disabled chip.
    expect(screen.getByTestId('main-toolbar-branch-wt').textContent?.trim()).toBe('wt');
  });

  it('renders a disabled stub chip when a branch is persisted but no projectId is available', () => {
    renderChip({ branchName: 'feat/x' });

    const chip = screen.getByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/x');
    expect(chip).toBeDisabled();
    expect(screen.queryByTestId('mock-branch-changed')).toBeNull();
    expect(mockGetGitBranch).not.toHaveBeenCalled();
  });
});

describe('BranchChip — nothing to show', () => {
  it.each([
    { name: 'git reports no branch and none is persisted', props: { projectId: 'p1', chatId: 'c1' }, fetches: true },
    { name: 'there is no projectId and no persisted branch', props: {}, fetches: false },
  ])('renders no chip when $name', async ({ props, fetches }) => {
    mockGetGitBranch.mockResolvedValue({ branch: null });

    renderChip(props);

    if (fetches) await waitFor(() => expect(mockGetGitBranch).toHaveBeenCalled());
    else expect(mockGetGitBranch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('main-toolbar-branch')).toBeNull();
  });
});

describe('BranchChip — refresh after a popover write', () => {
  it('refetches and displays the live branch after BranchPopover reports onBranchChanged', async () => {
    // A BranchPopover write broadcasts no `chat.updated`, so nothing else
    // invalidates the live read — the chip owns its own refetch.
    mockGetGitBranch
      .mockResolvedValueOnce({ branch: 'feat/before' })
      .mockResolvedValueOnce({ branch: 'feat/after-checkout' });

    renderChip({ projectId: 'p1', chatId: 'c1', branchName: 'feat/before', isWorktree: true });

    expect((await screen.findByTestId('main-toolbar-branch')).textContent).toContain('feat/before');

    fireEvent.click(screen.getByTestId('mock-branch-changed'));

    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-branch').textContent).toContain('feat/after-checkout');
    });
    expect(mockGetGitBranch).toHaveBeenCalledWith(31415, 'p1', 'c1');
  });
});
