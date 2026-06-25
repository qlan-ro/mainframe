/**
 * WorktreePopover — unit tests for the composer worktree isolator.
 *
 * Strategy:
 *  - Mock @/lib/api/git so network calls never hit the wire.
 *  - Mock useDaemonPort to return a known port.
 *  - Render inside a TooltipProvider (trigger uses Tooltip).
 *  - Open the popover by clicking the trigger (composer-worktree-trigger).
 *  - Radix Popover renders into a portal under document.body — all
 *    screen.getByTestId / screen.findByText queries work across the portal.
 *
 * Behaviors covered:
 *  1. Active-info state: when chat.worktreePath is set, popover shows the branch name
 *  2. Setup state — New tab: branch-name input + base-branch select + Enable button
 *  3. enableWorktree is called with the correct (port, chatId, baseBranch, branchName)
 *  4. Invalid branch name (contains "..") prevents the Enable call
 *  5. Existing tab: shows worktree attach rows when worktrees are present
 *  6. attachWorktree is called when an existing worktree row is clicked
 *  7. Mid-session warning appears when hasMessages=true
 *  8. Cancel button closes the popover (Enable button disappears)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks — hoisted before component import
// ---------------------------------------------------------------------------

const enableWorktreeMock = vi.fn().mockResolvedValue(undefined);
const attachWorktreeMock = vi.fn().mockResolvedValue(undefined);
const getGitBranchesMock = vi.fn().mockResolvedValue({
  current: 'main',
  local: [
    { name: 'main', current: true },
    { name: 'dev', current: false },
  ],
  remote: [],
  worktrees: [],
});
const getProjectWorktreesMock = vi.fn().mockResolvedValue([{ path: '/wt/feat-a', branch: 'refs/heads/feat-a' }]);

vi.mock('@/lib/api/git', () => ({
  enableWorktree: (...a: unknown[]) => enableWorktreeMock(...a),
  attachWorktree: (...a: unknown[]) => attachWorktreeMock(...a),
  getGitBranches: (...a: unknown[]) => getGitBranchesMock(...a),
  getProjectWorktrees: (...a: unknown[]) => getProjectWorktreesMock(...a),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// Import component AFTER mocks are in place
import { WorktreePopover } from '../WorktreePopover';
import type { Chat } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChat(overrides?: Partial<Chat>): Chat {
  return {
    id: 'c1',
    projectId: 'p1',
    adapterId: 'claude',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPopover(chat: Chat, hasMessages = false) {
  return render(
    <TooltipProvider>
      <WorktreePopover chat={chat} hasMessages={hasMessages} />
    </TooltipProvider>,
  );
}

function openPopover() {
  fireEvent.click(screen.getByTestId('composer-worktree-trigger'));
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  enableWorktreeMock.mockClear();
  attachWorktreeMock.mockClear();
  getGitBranchesMock.mockClear();
  getProjectWorktreesMock.mockClear();
});

// ---------------------------------------------------------------------------
// 1. Active-info state — chat already has a worktree
// ---------------------------------------------------------------------------

describe('WorktreePopover — active-info state', () => {
  it('shows the active-info panel when the chat already has a worktree', async () => {
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat);

    openPopover();

    // findAllByText because the branch name also appears on the trigger button
    const matches = await screen.findAllByText('feat/c1');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('composer-worktree-active-info')).toBeInTheDocument();
  });

  it('does NOT show a branch-name input in the active-info state', async () => {
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat);

    openPopover();

    expect(await screen.findByTestId('composer-worktree-active-info')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-worktree-branch-name')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Setup state — New tab inputs are rendered
// ---------------------------------------------------------------------------

describe('WorktreePopover — setup state (New tab)', () => {
  it('renders the branch-name input and Enable button after popover opens', async () => {
    renderPopover(makeChat());

    openPopover();

    expect(await screen.findByTestId('composer-worktree-branch-name')).toBeInTheDocument();
    expect(await screen.findByTestId('composer-worktree-enable')).toBeInTheDocument();
  });

  it('renders the base-branch select', async () => {
    renderPopover(makeChat());

    openPopover();

    expect(await screen.findByTestId('composer-worktree-base-branch')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. enableWorktree is called with correct args
// ---------------------------------------------------------------------------

describe('WorktreePopover — enableWorktree call', () => {
  it('calls enableWorktree(port, chatId, baseBranch, branchName) on Enable click', async () => {
    renderPopover(makeChat());

    openPopover();

    const input = await screen.findByTestId('composer-worktree-branch-name');
    fireEvent.change(input, { target: { value: 'feat/new' } });
    fireEvent.click(screen.getByTestId('composer-worktree-enable'));

    await waitFor(() => expect(enableWorktreeMock).toHaveBeenCalledWith(31415, 'c1', 'main', 'feat/new'));
  });
});

// ---------------------------------------------------------------------------
// 4. Branch name validation blocks invalid names
// ---------------------------------------------------------------------------

describe('WorktreePopover — branch name validation', () => {
  it('does NOT call enableWorktree when the branch name contains ".."', async () => {
    renderPopover(makeChat());

    openPopover();

    const input = await screen.findByTestId('composer-worktree-branch-name');
    fireEvent.change(input, { target: { value: 'bad..name' } });
    fireEvent.click(screen.getByTestId('composer-worktree-enable'));

    expect(enableWorktreeMock).not.toHaveBeenCalled();
  });

  it('does NOT call enableWorktree when the branch name is empty', async () => {
    renderPopover(makeChat());

    openPopover();

    // Enable button with empty input
    const btn = await screen.findByTestId('composer-worktree-enable');
    fireEvent.click(btn);

    expect(enableWorktreeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Existing tab — worktree rows are rendered
// ---------------------------------------------------------------------------

describe('WorktreePopover — Existing tab', () => {
  it('shows the Existing tab and a worktree row for each entry', async () => {
    renderPopover(makeChat());

    openPopover();

    // Switch to Existing tab
    const existingTab = await screen.findByTestId('composer-worktree-tab-existing');
    fireEvent.click(existingTab);

    expect(await screen.findByTestId('composer-worktree-attach-/wt/feat-a')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6. attachWorktree is called when a worktree row is clicked
// ---------------------------------------------------------------------------

describe('WorktreePopover — attachWorktree call', () => {
  it('calls attachWorktree with the correct args when a row is clicked', async () => {
    renderPopover(makeChat());

    openPopover();

    const existingTab = await screen.findByTestId('composer-worktree-tab-existing');
    fireEvent.click(existingTab);

    const row = await screen.findByTestId('composer-worktree-attach-/wt/feat-a');
    fireEvent.click(row);

    await waitFor(() => expect(attachWorktreeMock).toHaveBeenCalledWith(31415, 'c1', '/wt/feat-a', 'feat-a'));
  });
});

// ---------------------------------------------------------------------------
// 7. Mid-session warning appears when hasMessages=true
// ---------------------------------------------------------------------------

describe('WorktreePopover — mid-session warning', () => {
  it('shows a warning when hasMessages=true', async () => {
    renderPopover(makeChat(), /* hasMessages= */ true);

    openPopover();

    expect(await screen.findByTestId('composer-worktree-mid-session-warning')).toBeInTheDocument();
  });

  it('does NOT show a warning when hasMessages=false', async () => {
    renderPopover(makeChat(), /* hasMessages= */ false);

    openPopover();

    await screen.findByTestId('composer-worktree-branch-name');
    expect(screen.queryByTestId('composer-worktree-mid-session-warning')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8. Cancel button closes the popover
// ---------------------------------------------------------------------------

describe('WorktreePopover — cancel closes the popover', () => {
  it('removes the Enable button from the DOM after clicking Cancel', async () => {
    renderPopover(makeChat());

    openPopover();

    await screen.findByTestId('composer-worktree-enable');

    fireEvent.click(screen.getByTestId('composer-worktree-cancel'));

    await waitFor(() => expect(screen.queryByTestId('composer-worktree-enable')).not.toBeInTheDocument());
  });
});
