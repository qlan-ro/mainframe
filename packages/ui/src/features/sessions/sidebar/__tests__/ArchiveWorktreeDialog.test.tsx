/**
 * ArchiveWorktreeDialog — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - pending=null → dialog root is absent from the DOM.
 *  - pending={ remoteId:'chat-1', hasWorktree:true } → dialog root present,
 *    heading text is "Archive session".
 *  - hasWorktree=true → keep/delete worktree buttons present; confirm absent.
 *  - hasWorktree=false → confirm button present; keep/delete buttons absent.
 *  - Clicking sessions-archive-cancel calls resolve('cancel').
 *  - Clicking sessions-archive-keep-worktree calls resolve({ deleteWorktree:false }).
 *  - Clicking sessions-archive-delete-worktree calls resolve({ deleteWorktree:true }).
 *  - Clicking sessions-archive-confirm (hasWorktree=false) calls resolve({ deleteWorktree:false }).
 *
 * The archive-confirm-bridge module is mocked so tests control `pending` state
 * directly via useArchivePrompt.setState and spy on the `resolve` function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { create } from 'zustand';
import type { ArchiveChoice, PendingArchiveRequest } from '../../runtime/archive-confirm-bridge';

// ---------------------------------------------------------------------------
// Controllable mock of the archive-confirm-bridge store
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setPending(pending: PendingArchiveRequest | null): void {
  act(() => {
    mockUseArchivePrompt.setState({ pending, resolve: mockResolve });
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockResolve.mockReset();
  mockUseArchivePrompt.setState({ pending: null, resolve: mockResolve });
});

// ---------------------------------------------------------------------------
// 1. pending=null — nothing renders
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — pending=null renders nothing', () => {
  it('sessions-archive-confirm-dialog is absent when pending is null', () => {
    render(<ArchiveWorktreeDialog />);
    expect(screen.queryByTestId('sessions-archive-confirm-dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. pending set — dialog root and heading are present
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — dialog root and heading when pending is set', () => {
  it('renders sessions-archive-confirm-dialog with heading "Archive session"', () => {
    setPending({ remoteId: 'chat-1', hasWorktree: true });
    render(<ArchiveWorktreeDialog />);

    expect(screen.queryByTestId('sessions-archive-confirm-dialog')).not.toBeNull();
    expect(screen.getByText('Archive session')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. hasWorktree=true — keep/delete buttons present, confirm absent
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — hasWorktree=true shows worktree action buttons', () => {
  it('renders keep and delete worktree buttons but not the confirm button', () => {
    setPending({ remoteId: 'chat-1', hasWorktree: true });
    render(<ArchiveWorktreeDialog />);

    expect(screen.queryByTestId('sessions-archive-keep-worktree')).not.toBeNull();
    expect(screen.queryByTestId('sessions-archive-delete-worktree')).not.toBeNull();
    expect(screen.queryByTestId('sessions-archive-confirm')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. hasWorktree=false — confirm button present, keep/delete absent
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — hasWorktree=false shows only confirm button', () => {
  it('renders sessions-archive-confirm but not the keep/delete worktree buttons', () => {
    setPending({ remoteId: 'chat-1', hasWorktree: false });
    render(<ArchiveWorktreeDialog />);

    expect(screen.queryByTestId('sessions-archive-confirm')).not.toBeNull();
    expect(screen.queryByTestId('sessions-archive-keep-worktree')).toBeNull();
    expect(screen.queryByTestId('sessions-archive-delete-worktree')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking cancel calls resolve('cancel')
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — cancel button calls resolve with "cancel"', () => {
  it('calls resolve exactly once with "cancel" when sessions-archive-cancel is clicked', async () => {
    setPending({ remoteId: 'chat-1', hasWorktree: true });
    render(<ArchiveWorktreeDialog />);

    await userEvent.click(screen.getByTestId('sessions-archive-cancel'));

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith('cancel');
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking keep-worktree calls resolve({ deleteWorktree: false })
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — keep-worktree button calls resolve with deleteWorktree:false', () => {
  it('calls resolve with { deleteWorktree: false } when sessions-archive-keep-worktree is clicked', async () => {
    setPending({ remoteId: 'chat-1', hasWorktree: true });
    render(<ArchiveWorktreeDialog />);

    await userEvent.click(screen.getByTestId('sessions-archive-keep-worktree'));

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith({ deleteWorktree: false });
  });
});

// ---------------------------------------------------------------------------
// 7. Clicking delete-worktree calls resolve({ deleteWorktree: true })
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — delete-worktree button calls resolve with deleteWorktree:true', () => {
  it('calls resolve with { deleteWorktree: true } when sessions-archive-delete-worktree is clicked', async () => {
    setPending({ remoteId: 'chat-1', hasWorktree: true });
    render(<ArchiveWorktreeDialog />);

    await userEvent.click(screen.getByTestId('sessions-archive-delete-worktree'));

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith({ deleteWorktree: true });
  });
});

// ---------------------------------------------------------------------------
// 8. Clicking confirm (hasWorktree=false) calls resolve({ deleteWorktree: false })
// ---------------------------------------------------------------------------

describe('ArchiveWorktreeDialog — confirm button calls resolve with deleteWorktree:false', () => {
  it('calls resolve with { deleteWorktree: false } when sessions-archive-confirm is clicked', async () => {
    setPending({ remoteId: 'chat-1', hasWorktree: false });
    render(<ArchiveWorktreeDialog />);

    await userEvent.click(screen.getByTestId('sessions-archive-confirm'));

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith({ deleteWorktree: false });
  });
});
