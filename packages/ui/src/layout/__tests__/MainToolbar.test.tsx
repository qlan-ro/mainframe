import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@/store/theme';
import { useUiPrefs } from '@/store/ui-prefs';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

const mockGetGitBranch = vi.fn();
vi.mock('@/lib/api/git', () => ({ getGitBranch: (...a: unknown[]) => mockGetGitBranch(...a) }));

// Stub BranchPopover: renders the trigger (children) plus a button that fires
// onBranchChanged, so MainToolbar's own refresh wiring can be tested without
// driving the real popover's git actions.
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: (props: { children?: React.ReactNode; onBranchChanged?: () => void }) => (
    <>
      {props.children}
      <button data-testid="mock-branch-changed" onClick={() => props.onBranchChanged?.()}>
        trigger
      </button>
    </>
  ),
}));

import { MainToolbar } from '../MainToolbar';

beforeEach(() => {
  localStorage.clear();
  useTheme.getState().setMode('light');
  useUiPrefs.setState({ inspectorVisible: false });
  mockEmit.mockReset();
  mockGetGitBranch.mockReset();
});

describe('MainToolbar — root element', () => {
  it('renders the main-toolbar root with a drag region', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    const toolbar = screen.getByTestId('main-toolbar');
    expect(toolbar).toBeDefined();
    expect(toolbar.hasAttribute('data-drag-region')).toBe(true);
  });
});

describe('MainToolbar — project name', () => {
  it('renders the project name text', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(screen.getByText('mainframe')).toBeDefined();
  });
});

describe('MainToolbar — branch chip', () => {
  it('renders a neutral, interactive chip for a main-repo session using the live git branch', async () => {
    mockGetGitBranch.mockResolvedValue({ branch: 'main' });

    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        projectId="p1"
        chatId="c1"
        windowStyle="glass"
        port={31415}
      />,
    );

    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('main');
    expect(chip).not.toBeDisabled();
    expect(chip.getAttribute('data-worktree')).toBe('false');
    expect(chip.className).not.toContain('border-primary');
    expect(screen.queryByTestId('main-toolbar-branch-wt')).toBeNull();
    expect(mockGetGitBranch).toHaveBeenCalledWith(31415, 'p1', 'c1');
  });

  it('renders an accented chip with a WT badge for a worktree session', async () => {
    mockGetGitBranch.mockResolvedValue({ branch: 'feat/x' });

    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        branchName="feat/x"
        isWorktree
        projectId="p1"
        chatId="c1"
        windowStyle="glass"
        port={31415}
      />,
    );

    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/x');
    expect(chip.getAttribute('data-worktree')).toBe('true');
    expect(chip.className).toContain('border-primary');
    expect(screen.getByTestId('main-toolbar-branch-wt').textContent?.trim()).toBe('wt');
  });

  it('prefers the draft worktree branch over the live project-root branch when there is no chatId yet', async () => {
    // A draft attached to a worktree has no daemon chat yet, so the live fetch
    // can only see the project ROOT branch — the chip must show the worktree's.
    mockGetGitBranch.mockResolvedValue({ branch: 'main' });

    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        branchName="feat/wt-draft"
        isWorktree
        projectId="p1"
        windowStyle="glass"
        port={31415}
      />,
    );

    await waitFor(() => expect(mockGetGitBranch).toHaveBeenCalled());
    const chip = await screen.findByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/wt-draft');
    expect(chip.getAttribute('data-worktree')).toBe('true');
  });

  it('renders a disabled stub chip when a branch is persisted but no projectId is available', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        branchName="feat/x"
        windowStyle="glass"
        port={31415}
      />,
    );

    const chip = screen.getByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/x');
    expect(chip).toBeDisabled();
    expect(mockGetGitBranch).not.toHaveBeenCalled();
  });

  it('does not render the chip when git reports no branch and none is persisted', async () => {
    mockGetGitBranch.mockResolvedValue({ branch: null });

    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        projectId="p1"
        chatId="c1"
        windowStyle="glass"
        port={31415}
      />,
    );

    await waitFor(() => expect(mockGetGitBranch).toHaveBeenCalled());
    expect(screen.queryByTestId('main-toolbar-branch')).toBeNull();
  });

  it('does not render the chip when there is no projectId and no persisted branch', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(screen.queryByTestId('main-toolbar-branch')).toBeNull();
    expect(mockGetGitBranch).not.toHaveBeenCalled();
  });
});

describe('MainToolbar — branch chip refresh after popover write', () => {
  it('refetches and displays the live branch after BranchPopover reports onBranchChanged', async () => {
    mockGetGitBranch
      .mockResolvedValueOnce({ branch: 'feat/before' })
      .mockResolvedValueOnce({ branch: 'feat/after-checkout' });

    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        branchName="feat/before"
        isWorktree
        projectId="p1"
        chatId="c1"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect((await screen.findByTestId('main-toolbar-branch')).textContent).toContain('feat/before');

    fireEvent.click(screen.getByTestId('mock-branch-changed'));

    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-branch').textContent).toContain('feat/after-checkout');
    });
    expect(mockGetGitBranch).toHaveBeenCalledWith(31415, 'p1', 'c1');
  });
});

describe('MainToolbar — show-sidebar button', () => {
  it('renders show-sidebar-button and calls onExpandSidebar when sidebarRendered is false', () => {
    const onExpandSidebar = vi.fn();
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={false}
        onExpandSidebar={onExpandSidebar}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    const btn = screen.getByTestId('show-sidebar-button');
    expect(btn).toBeDefined();

    fireEvent.click(btn);

    expect(onExpandSidebar).toHaveBeenCalledTimes(1);
  });

  it('does not render show-sidebar-button when sidebarRendered is true', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(screen.queryByTestId('show-sidebar-button')).toBeNull();
  });
});

describe('MainToolbar — launch controls', () => {
  it('renders an enabled launch picker; the run button is disabled until configs load', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    // No projectId → no configs fetched → run button has no target (disabled),
    // but the picker itself is now live (was a disabled stub before wiring).
    expect(screen.getByTestId('main-toolbar-launch')).not.toBeDisabled();
    expect(screen.getByTestId('main-toolbar-play')).toBeDisabled();
  });
});

describe('MainToolbar — search button', () => {
  it('search button is not disabled', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(screen.getByTestId('main-toolbar-search')).not.toBeDisabled();
  });

  it('clicking main-toolbar-search emits open-search-palette', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    fireEvent.click(screen.getByTestId('main-toolbar-search'));
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-search-palette' });
  });
});

describe('MainToolbar — inspector toggle', () => {
  it('inspector button is live (not disabled) and toggles the layout inspectorVisible flag', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    const btn = screen.getByTestId('main-toolbar-inspector');
    expect(btn).not.toBeDisabled();
    expect(useUiPrefs.getState().inspectorVisible).toBe(false);

    fireEvent.click(btn);
    expect(useUiPrefs.getState().inspectorVisible).toBe(true);

    fireEvent.click(btn);
    expect(useUiPrefs.getState().inspectorVisible).toBe(false);
  });
});

describe('MainToolbar — height 40px', () => {
  it('root element has h-[40px] class (artboard specifies height: 40)', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );
    const toolbar = screen.getByTestId('main-toolbar');
    expect(toolbar.className).toContain('h-[40px]');
  });
});

describe('MainToolbar — CMD+O hint chip in search button', () => {
  it('renders the ⌘O keyboard hint chip inside the search button', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );
    const hint = screen.getByTestId('main-toolbar-search-hint');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toBe('⌘O');
  });
});

describe('MainToolbar — theme toggle', () => {
  it('clicking main-toolbar-theme flips the theme mode from light to dark', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(useTheme.getState().mode).toBe('light');

    fireEvent.click(screen.getByTestId('main-toolbar-theme'));

    expect(useTheme.getState().mode).toBe('dark');
  });

  it('main-toolbar-theme is not disabled', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        windowStyle="glass"
        port={31415}
      />,
    );

    expect(screen.getByTestId('main-toolbar-theme')).not.toBeDisabled();
  });
});
