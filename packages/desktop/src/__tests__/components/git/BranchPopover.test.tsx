/**
 * BranchPopover component tests.
 *
 * NOTE: This test suite targets React 19 + @testing-library/react@16 which
 * has a known issue where async state updates triggered inside useEffect on
 * mount cause "not wrapped in act(...)" warnings. Tests are written to
 * document expected behavior and may emit act() warnings in CI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the entire API module before importing the component.
// useBranchActions imports from '../../lib/api' (relative to the hook file at
// renderer/components/git/useBranchActions.ts), which resolves to
// renderer/lib/api/index.ts.
vi.mock('../../../renderer/lib/api', () => ({
  getGitBranches: vi.fn(),
  getGitStatus: vi.fn(),
  gitFetch: vi.fn(),
  gitPush: vi.fn(),
  gitUpdateAll: vi.fn(),
  gitCheckout: vi.fn(),
  gitPull: vi.fn(),
  gitMerge: vi.fn(),
  gitRebase: vi.fn(),
  gitAbort: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitRenameBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
}));

import { TooltipProvider } from '../../../renderer/components/ui/tooltip';
import { BranchPopover } from '../../../renderer/components/git/BranchPopover';
import * as api from '../../../renderer/lib/api';
import { useToastStore } from '../../../renderer/store/toasts';

const mockBranches = {
  current: 'main',
  local: [
    { name: 'main', current: true, tracking: 'origin/main' },
    { name: 'feat/popover', current: false, tracking: 'origin/feat/popover' },
    { name: 'fix/bug', current: false },
  ],
  remote: ['origin/main', 'origin/feat/popover'],
  worktrees: [],
};

const mockStatus = { files: [] };

const defaultProps = {
  projectId: 'proj-1',
  currentBranch: 'main',
  onClose: vi.fn(),
  onBranchChanged: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  vi.mocked(api.getGitBranches).mockResolvedValue(mockBranches);
  vi.mocked(api.getGitStatus).mockResolvedValue(mockStatus);
});

describe('BranchPopover', () => {
  it('renders branch list from mocked API response', async () => {
    await act(async () => {
      render(
        <TooltipProvider>
          <BranchPopover {...defaultProps} />
        </TooltipProvider>,
      );
    });

    // Wait for the async loadBranches call triggered by useEffect to settle.
    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument();
    });

    // main is ungrouped; feat/popover and fix/bug are grouped under their prefixes.
    expect(screen.getByText('popover')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('Local Branches')).toBeInTheDocument();
  });

  it('search input filters displayed branches', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <TooltipProvider>
          <BranchPopover {...defaultProps} />
        </TooltipProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search branches...')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search branches...');

    // Type a search term that matches only fix/bug
    await act(async () => {
      await user.type(searchInput, 'fix');
    });

    await waitFor(() => {
      // 'bug' (the display name for fix/bug) should be visible.
      expect(screen.getByText('bug')).toBeInTheDocument();
      // 'main' should NOT be visible (does not match 'fix').
      expect(screen.queryByText('main')).not.toBeInTheDocument();
    });
  });

  it('fetch button triggers gitFetch API call', async () => {
    const user = userEvent.setup();
    vi.mocked(api.gitFetch).mockResolvedValue({ fetched: true } as never);

    await act(async () => {
      render(
        <TooltipProvider>
          <BranchPopover {...defaultProps} />
        </TooltipProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle('Fetch')).toBeInTheDocument();
    });

    const fetchButton = screen.getByTitle('Fetch');

    await act(async () => {
      await user.click(fetchButton);
    });

    await waitFor(() => {
      expect(api.gitFetch).toHaveBeenCalledWith('proj-1');
    });
  });

  it('New Branch button switches to the new-branch dialog sub-view', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <TooltipProvider>
          <BranchPopover {...defaultProps} />
        </TooltipProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText('New Branch...')).toBeInTheDocument();
    });

    const newBranchButton = screen.getByText('New Branch...');

    await act(async () => {
      await user.click(newBranchButton);
    });

    // The NewBranchDialog should now be visible; it renders a "New Branch"
    // heading and a name input with the placeholder "feature/my-branch".
    await waitFor(() => {
      expect(screen.getByPlaceholderText('feature/my-branch')).toBeInTheDocument();
      expect(screen.getByText('New Branch')).toBeInTheDocument();
    });
  });
});
