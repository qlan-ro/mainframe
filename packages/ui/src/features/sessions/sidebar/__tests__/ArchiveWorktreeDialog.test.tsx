/**
 * ArchiveWorktreeDialog — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - pending=null → dialog root is absent from the DOM; pending set → dialog
 *    root present with heading "Archive session".
 *  - hasWorktree=true → keep/delete worktree buttons present, confirm absent;
 *    hasWorktree=false → confirm button present, keep/delete absent.
 *  - Clicking sessions-archive-cancel/keep-worktree/delete-worktree/confirm
 *    calls resolve with the matching choice.
 *
 * The archive-confirm-bridge module is mocked so tests control `pending` state
 * directly via useArchivePrompt.setState and spy on the `resolve` function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { create } from 'zustand';
import type { ArchiveChoice, PendingArchiveRequest } from '../../runtime/archive-confirm-bridge';

interface MockArchivePromptState {
  pending: PendingArchiveRequest | null;
  request: (remoteId: string, opts: { hasWorktree: boolean }) => Promise<ArchiveChoice>;
  resolve: (choice: ArchiveChoice) => void;
}

const mockResolve = vi.fn();

const mockUseArchivePrompt = create<MockArchivePromptState>(() => ({
  pending: null,
  request: (_remoteId, _opts) => Promise.resolve('cancel' as ArchiveChoice),
  resolve: mockResolve,
}));

vi.mock('../../runtime/archive-confirm-bridge', () => ({
  useArchivePrompt: mockUseArchivePrompt,
}));

// Import the component AFTER the mock is registered
const { ArchiveWorktreeDialog } = await import('../ArchiveWorktreeDialog');

function setPending(pending: PendingArchiveRequest | null): void {
  act(() => {
    mockUseArchivePrompt.setState({ pending, resolve: mockResolve });
  });
}

beforeEach(() => {
  mockResolve.mockReset();
  mockUseArchivePrompt.setState({ pending: null, resolve: mockResolve });
});

describe('ArchiveWorktreeDialog', () => {
  it('renders the dialog with a heading only once a request is pending', () => {
    const { rerender } = render(<ArchiveWorktreeDialog />);
    expect(screen.queryByTestId('sessions-archive-confirm-dialog')).toBeNull();

    setPending({ remoteId: 'chat-1', hasWorktree: true });
    rerender(<ArchiveWorktreeDialog />);

    expect(screen.queryByTestId('sessions-archive-confirm-dialog')).not.toBeNull();
    expect(screen.getByText('Archive session')).toBeTruthy();
  });

  it.each([
    {
      hasWorktree: true,
      present: ['sessions-archive-keep-worktree', 'sessions-archive-delete-worktree'],
      absent: ['sessions-archive-confirm'],
    },
    {
      hasWorktree: false,
      present: ['sessions-archive-confirm'],
      absent: ['sessions-archive-keep-worktree', 'sessions-archive-delete-worktree'],
    },
  ])('shows the correct action buttons when hasWorktree=$hasWorktree', ({ hasWorktree, present, absent }) => {
    setPending({ remoteId: 'chat-1', hasWorktree });
    render(<ArchiveWorktreeDialog />);

    for (const testId of present) {
      expect(screen.queryByTestId(testId)).not.toBeNull();
    }
    for (const testId of absent) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });

  it('resolves with the matching choice for cancel, keep, delete, and confirm actions', async () => {
    setPending({ remoteId: 'chat-1', hasWorktree: true });
    const { unmount } = render(<ArchiveWorktreeDialog />);

    await userEvent.click(screen.getByTestId('sessions-archive-cancel'));
    await userEvent.click(screen.getByTestId('sessions-archive-keep-worktree'));
    await userEvent.click(screen.getByTestId('sessions-archive-delete-worktree'));
    unmount();

    setPending({ remoteId: 'chat-2', hasWorktree: false });
    render(<ArchiveWorktreeDialog />);
    await userEvent.click(screen.getByTestId('sessions-archive-confirm'));

    expect(mockResolve).toHaveBeenCalledTimes(4);
    expect(mockResolve).toHaveBeenNthCalledWith(1, 'cancel');
    expect(mockResolve).toHaveBeenNthCalledWith(2, { deleteWorktree: false });
    expect(mockResolve).toHaveBeenNthCalledWith(3, { deleteWorktree: true });
    expect(mockResolve).toHaveBeenNthCalledWith(4, { deleteWorktree: false });
  });
});
