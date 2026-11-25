/**
 * WorktreePopover — unit tests for the composer worktree isolator.
 *
 * Strategy:
 *  - Mock @/lib/api/git so network calls never hit the wire.
 *  - Mock useDaemonPort to return a known port.
 *  - Render inside the **v2** TooltipProvider (the trigger is Hint-wrapped and
 *    the v2 Hint carries no provider of its own; the v1 one satisfies nothing).
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
 *  9. The caller owns open/onOpenChange and the trigger (live chats only; a
 *     draft picks its worktree in DraftBranchPicker)
 */
import { useState } from 'react';
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

let daemonIsLocal = false;
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));
const openPathMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/host', () => ({ useHost: () => ({ fs: { openPath: openPathMock } }) }));

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
    temporary: false,
    noProject: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function Harness({ chat, hasMessages, busy }: { chat: Chat; hasMessages: boolean; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <WorktreePopover chat={chat} hasMessages={hasMessages} busy={busy} open={open} onOpenChange={setOpen}>
      <button type="button" data-testid="composer-worktree-trigger" />
    </WorktreePopover>
  );
}

function renderPopover(chat: Chat, hasMessages = false, busy = false) {
  return render(
    <TooltipProvider>
      <Harness chat={chat} hasMessages={hasMessages} busy={busy} />
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
  openPathMock.mockClear();
  daemonIsLocal = false;
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

  it('lists the other worktrees the isolated session can move to, excluding its own', async () => {
    getProjectWorktreesMock.mockResolvedValueOnce([
      { path: '/wt/c1', branch: 'refs/heads/feat/c1' },
      { path: '/wt/feat-a', branch: 'refs/heads/feat-a' },
    ]);
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat);

    openPopover();

    expect(await screen.findByTestId('composer-worktree-attach-/wt/feat-a')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-worktree-attach-/wt/c1')).not.toBeInTheDocument();
    // The New tab stays hidden for an already-isolated session.
    expect(screen.queryByTestId('composer-worktree-tab-new')).not.toBeInTheDocument();
  });

  it('attaches the isolated session to the worktree row that was clicked', async () => {
    getProjectWorktreesMock.mockResolvedValueOnce([
      { path: '/wt/c1', branch: 'refs/heads/feat/c1' },
      { path: '/wt/feat-a', branch: 'refs/heads/feat-a' },
    ]);
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat);

    openPopover();

    fireEvent.click(await screen.findByTestId('composer-worktree-attach-/wt/feat-a'));

    await waitFor(() => {
      expect(attachWorktreeMock).toHaveBeenCalledWith(31415, 'c1', '/wt/feat-a', 'feat-a');
    });
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

  it('renders a per-branch testid on each base-branch option row', async () => {
    renderPopover(makeChat());

    openPopover();

    fireEvent.click(await screen.findByTestId('composer-worktree-base-branch'));

    expect(await screen.findByTestId('composer-worktree-base-branch-option-main')).toBeInTheDocument();
    expect(screen.getByTestId('composer-worktree-base-branch-option-dev')).toBeInTheDocument();
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

    // Switch to Existing tab. Radix `TabsTrigger` activates on mouse-DOWN, not
    // click — a `click` here selects nothing and the New tab stays rendered.
    const existingTab = await screen.findByTestId('composer-worktree-tab-existing');
    fireEvent.mouseDown(existingTab);

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
    fireEvent.mouseDown(existingTab);

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
// 7b. A turn in flight — every rebind restarts the CLI, so the popover explains
//     itself and withholds all of them (the daemon refuses these with 409 too).
// ---------------------------------------------------------------------------

describe('WorktreePopover — a turn in flight', () => {
  it('shows the setup form disabled, and says when it will be available', async () => {
    renderPopover(makeChat(), /* hasMessages= */ true, /* busy= */ true);

    openPopover();

    expect((await screen.findByTestId('composer-worktree-busy')).textContent).toBe(
      'Available once the current response finishes — rebinding now would cut it off.',
    );
    expect(screen.getByTestId('composer-worktree-branch-name')).toBeDisabled();
    expect(screen.getByTestId('composer-worktree-base-branch')).toBeDisabled();
    expect(screen.getByTestId('composer-worktree-enable')).toBeDisabled();
  });

  it('lists the existing worktrees, disabled', async () => {
    renderPopover(makeChat(), /* hasMessages= */ false, /* busy= */ true);

    openPopover();
    await screen.findByTestId('composer-worktree-busy');

    fireEvent.mouseDown(screen.getByTestId('composer-worktree-tab-existing'));

    const row = await screen.findByTestId('composer-worktree-attach-/wt/feat-a');
    expect(row).toBeDisabled();

    fireEvent.click(row);
    expect(attachWorktreeMock).not.toHaveBeenCalled();
  });

  it('lists the move-to worktrees of an isolated session, disabled', async () => {
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat, /* hasMessages= */ true, /* busy= */ true);

    openPopover();

    expect(await screen.findByTestId('composer-worktree-active-info')).toBeInTheDocument();
    expect(screen.getByTestId('composer-worktree-busy')).toBeInTheDocument();
    expect(await screen.findByTestId('composer-worktree-attach-/wt/feat-a')).toBeDisabled();
  });

  it('restores the setup form once the response finishes', async () => {
    const { rerender } = renderPopover(makeChat(), /* hasMessages= */ false, /* busy= */ true);

    openPopover();
    await screen.findByTestId('composer-worktree-busy');

    rerender(
      <TooltipProvider>
        <Harness chat={makeChat()} hasMessages={false} busy={false} />
      </TooltipProvider>,
    );

    expect(await screen.findByTestId('composer-worktree-enable')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-worktree-busy')).not.toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// 9. Open state belongs to the caller (the bottom strip, K8)
// ---------------------------------------------------------------------------

describe('WorktreePopover — controlled open state', () => {
  it('stays closed, and fetches nothing, until the caller opens it', () => {
    render(
      <TooltipProvider>
        <WorktreePopover chat={makeChat()} hasMessages={false} busy={false} open={false} onOpenChange={vi.fn()}>
          <button data-testid="composer-worktree-trigger" />
        </WorktreePopover>
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('composer-worktree-popover')).not.toBeInTheDocument();
    expect(getGitBranchesMock).not.toHaveBeenCalled();
  });

  it('asks the caller to open when its trigger is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <TooltipProvider>
        <WorktreePopover chat={makeChat()} hasMessages={false} busy={false} open={false} onOpenChange={onOpenChange}>
          <button data-testid="composer-worktree-trigger" />
        </WorktreePopover>
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('composer-worktree-trigger'));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('asks the caller to close after enabling a worktree', async () => {
    const onOpenChange = vi.fn();
    render(
      <TooltipProvider>
        <WorktreePopover chat={makeChat()} hasMessages={false} busy={false} open onOpenChange={onOpenChange}>
          <button data-testid="composer-worktree-trigger" />
        </WorktreePopover>
      </TooltipProvider>,
    );
    fireEvent.change(await screen.findByTestId('composer-worktree-branch-name'), { target: { value: 'feat/x' } });

    fireEvent.click(screen.getByTestId('composer-worktree-enable'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

// ---------------------------------------------------------------------------
// 10. Open folder — only when the daemon shares this machine's filesystem
// ---------------------------------------------------------------------------

describe('WorktreePopover — Open folder', () => {
  const isolated = () => makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });

  it('opens the worktree folder through the host when the daemon is local', async () => {
    daemonIsLocal = true;
    renderPopover(isolated());
    openPopover();

    fireEvent.click(await screen.findByTestId('composer-worktree-open-folder'));

    expect(openPathMock).toHaveBeenCalledExactlyOnceWith('/wt/c1');
  });

  it('offers no Open folder for a remote daemon', async () => {
    renderPopover(isolated());
    openPopover();
    await screen.findByTestId('composer-worktree-active-info');

    expect(screen.queryByTestId('composer-worktree-open-folder')).not.toBeInTheDocument();
  });
});
