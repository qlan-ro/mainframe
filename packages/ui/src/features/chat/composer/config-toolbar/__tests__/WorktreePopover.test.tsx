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
import { useDraftConfigStore, setDraftConfig, getDraftConfig } from '@/features/sessions/runtime/draft-config';

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
  useDraftConfigStore.setState({ drafts: new Map() });
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

// ---------------------------------------------------------------------------
// 9. Trigger shape — fixed 26x20 rounded-sm icon button (RADIUS.sm), matching
//    the design's distinct icon-button family (03-content.jsx:599-608), not the
//    auto-sized rounded-[11px] pill shared with the text-bearing chips.
// ---------------------------------------------------------------------------

describe('WorktreePopover — trigger shape', () => {
  it('trigger has w-[26px] and rounded-sm, not rounded-[11px]', () => {
    renderPopover(makeChat());

    const trigger = screen.getByTestId('composer-worktree-trigger');
    expect(trigger.className).toContain('w-[26px]');
    expect(trigger.className).toContain('rounded-sm');
    expect(trigger.className).not.toContain('rounded-[11px]');
  });

  it('GitFork glyph renders at 13px (design size), not 11px', () => {
    renderPopover(makeChat());

    const trigger = screen.getByTestId('composer-worktree-trigger');
    const svg = trigger.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('width')).toBe('13');
    expect(svg!.getAttribute('height')).toBe('13');
  });
});

// ---------------------------------------------------------------------------
// 10. Isolated-state indicator — absolute 5px corner dot (design 03-content.jsx:602),
//     matching the FeaturesPopover treatment, not an inline Check glyph.
// ---------------------------------------------------------------------------

describe('WorktreePopover — isolated-state indicator', () => {
  it('renders an absolute 5px corner dot when isolated, not a Check icon', () => {
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat);

    const trigger = screen.getByTestId('composer-worktree-trigger');
    const dot = trigger.querySelector('span[aria-hidden]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('absolute');
    expect(dot!.className).toContain('size-[5px]');
    expect(dot!.className).toContain('rounded-full');

    // No Check glyph (lucide Check renders a <svg> with a polyline path) inside the trigger
    const svgs = trigger.querySelectorAll('svg');
    expect(svgs.length).toBe(1); // only GitFork
  });

  it('corner dot uses the primary accent color, not success', () => {
    const chat = makeChat({ worktreePath: '/wt/c1', branchName: 'feat/c1' });
    renderPopover(chat);

    const trigger = screen.getByTestId('composer-worktree-trigger');
    const dot = trigger.querySelector('span[aria-hidden]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('bg-primary');
    expect(dot!.className).not.toContain('bg-mf-success');
  });

  it('does NOT render the corner dot when not isolated', () => {
    renderPopover(makeChat());

    const trigger = screen.getByTestId('composer-worktree-trigger');
    const dot = trigger.querySelector('span[aria-hidden]');
    expect(dot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Draft mode (todo #223) — a __LOCALID_* chat has no daemon chat yet, so the
// choice is stashed in the draft config and carried into first-send creation.
// ---------------------------------------------------------------------------

const DRAFT_ID = '__LOCALID_d1';

function makeDraftChat(overrides?: Partial<Chat>): Chat {
  return makeChat({ id: DRAFT_ID, ...overrides });
}

describe('WorktreePopover — draft mode stashes instead of calling the daemon', () => {
  it('Existing-tab attach patches the draft config and never calls attachWorktree', async () => {
    setDraftConfig(DRAFT_ID, { projectId: 'p1', adapterId: 'claude' });
    renderPopover(makeDraftChat());

    openPopover();
    fireEvent.click(await screen.findByTestId('composer-worktree-tab-existing'));
    fireEvent.click(await screen.findByTestId('composer-worktree-attach-/wt/feat-a'));

    await waitFor(() => expect(getDraftConfig(DRAFT_ID)?.worktreePath).toBe('/wt/feat-a'));
    expect(getDraftConfig(DRAFT_ID)?.branchName).toBe('feat-a');
    expect(attachWorktreeMock).not.toHaveBeenCalled();
  });

  it('New-tab enable stashes a pendingWorktree and never calls enableWorktree', async () => {
    setDraftConfig(DRAFT_ID, { projectId: 'p1', adapterId: 'claude' });
    renderPopover(makeDraftChat());

    openPopover();
    const input = await screen.findByTestId('composer-worktree-branch-name');
    fireEvent.change(input, { target: { value: 'feat/new' } });
    fireEvent.click(screen.getByTestId('composer-worktree-enable'));

    await waitFor(() =>
      expect(getDraftConfig(DRAFT_ID)?.pendingWorktree).toEqual({ baseBranch: 'main', branchName: 'feat/new' }),
    );
    expect(enableWorktreeMock).not.toHaveBeenCalled();
  });
});

describe('WorktreePopover — draft panel reflects the stashed choice', () => {
  it('shows the draft panel for an attached draft worktree and cancel clears it', async () => {
    setDraftConfig(DRAFT_ID, {
      projectId: 'p1',
      adapterId: 'claude',
      worktreePath: '/wt/feat-a',
      branchName: 'feat-a',
    });
    // ComposerToolbar synthesizes the draft chat from the same draft config.
    renderPopover(makeDraftChat({ worktreePath: '/wt/feat-a', branchName: 'feat-a' }));

    openPopover();

    expect(await screen.findByTestId('composer-worktree-draft-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('composer-worktree-draft-cancel'));

    expect(getDraftConfig(DRAFT_ID)?.worktreePath).toBeUndefined();
    expect(getDraftConfig(DRAFT_ID)?.branchName).toBeUndefined();
  });

  it('shows the draft panel for a pending new worktree and cancel clears the intent', async () => {
    setDraftConfig(DRAFT_ID, {
      projectId: 'p1',
      adapterId: 'claude',
      pendingWorktree: { baseBranch: 'main', branchName: 'feat/new' },
    });
    renderPopover(makeDraftChat());

    openPopover();

    const panel = await screen.findByTestId('composer-worktree-draft-panel');
    expect(panel.textContent).toContain('feat/new');
    fireEvent.click(screen.getByTestId('composer-worktree-draft-cancel'));

    expect(getDraftConfig(DRAFT_ID)?.pendingWorktree).toBeUndefined();
  });
});
