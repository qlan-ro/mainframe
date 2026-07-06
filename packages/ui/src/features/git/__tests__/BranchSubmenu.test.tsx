/**
 * BranchSubmenu.test.tsx — disabled states, action callbacks, testids.
 *
 * Behaviors covered:
 *  1. Renders data-testid="git-submenu".
 *  2. Checkout is disabled when isCurrent=true.
 *  3. Checkout is disabled when isWorktree=true.
 *  4. Checkout is enabled for a non-current, non-worktree local branch.
 *  5. Merge and Rebase are disabled when isCurrent=true.
 *  6. Rename is disabled when isWorktree=true.
 *  7. Delete is disabled when isCurrent=true or isWorktree=true.
 *  8. Clicking Checkout fires onCheckout(branch).
 *  9. Clicking Pull fires onPull(branch).
 * 10. Clicking Push fires onPush(branch).
 * 11. Clicking Merge fires onMerge(branch).
 * 12. Clicking Rebase fires onRebase(branch).
 * 13. Clicking Rename fires onRename(branch).
 * 14. Clicking Delete fires onDelete(branch, false) for a local branch.
 * 15. Clicking "New Branch from" fires onNewBranchFrom(branch).
 * 16. isWorktree=true: Delete Worktree button fires onDeleteWorktree(branch).
 * 17. isWorktree=true + onNewSession provided: New Session button fires onNewSession(branch).
 * 18. isRemote=true: only remote-specific items are rendered (Checkout, New Branch From, Merge, Rebase, Delete Remote).
 * 19. isRemote + Delete fires onDelete(branch, true).
 * 20. busy=true disables all action buttons.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchSubmenu, type BranchSubmenuProps } from '../BranchSubmenu';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<BranchSubmenuProps> = {}): BranchSubmenuProps {
  return {
    branch: 'feat/test',
    isCurrent: false,
    isRemote: false,
    isWorktree: false,
    onCheckout: vi.fn(),
    onPull: vi.fn(),
    onPush: vi.fn(),
    onMerge: vi.fn(),
    onRebase: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onNewBranchFrom: vi.fn(),
    onNewSession: undefined,
    onDeleteWorktree: undefined,
    busy: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Renders root testid
// ---------------------------------------------------------------------------

describe('BranchSubmenu — renders root testid', () => {
  it('renders data-testid="git-submenu"', () => {
    render(<BranchSubmenu {...makeProps()} />);
    expect(screen.getByTestId('git-submenu')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2–3. Checkout disabled when isCurrent or isWorktree
// ---------------------------------------------------------------------------

describe('BranchSubmenu — Checkout disabled states', () => {
  it('disables git-submenu-checkout when isCurrent=true', () => {
    render(<BranchSubmenu {...makeProps({ isCurrent: true })} />);
    expect(screen.getByTestId('git-submenu-checkout')).toBeDisabled();
  });

  it('disables git-submenu-checkout when isWorktree=true', () => {
    render(<BranchSubmenu {...makeProps({ isWorktree: true })} />);
    expect(screen.getByTestId('git-submenu-checkout')).toBeDisabled();
  });

  it('enables git-submenu-checkout for a normal non-current branch', () => {
    render(<BranchSubmenu {...makeProps({ isCurrent: false, isWorktree: false })} />);
    expect(screen.getByTestId('git-submenu-checkout')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 4. Merge and Rebase disabled when isCurrent
// ---------------------------------------------------------------------------

describe('BranchSubmenu — Merge/Rebase disabled for current branch', () => {
  it('disables git-submenu-merge and git-submenu-rebase when isCurrent=true', () => {
    render(<BranchSubmenu {...makeProps({ isCurrent: true })} />);
    expect(screen.getByTestId('git-submenu-merge')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-rebase')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 5. Rename disabled when isWorktree
// ---------------------------------------------------------------------------

describe('BranchSubmenu — Rename disabled for worktree branch', () => {
  it('disables git-submenu-rename when isWorktree=true', () => {
    render(<BranchSubmenu {...makeProps({ isWorktree: true })} />);
    expect(screen.getByTestId('git-submenu-rename')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 6. Delete disabled when isCurrent or isWorktree
// ---------------------------------------------------------------------------

describe('BranchSubmenu — Delete disabled states', () => {
  it('disables git-submenu-delete when isCurrent=true', () => {
    render(<BranchSubmenu {...makeProps({ isCurrent: true })} />);
    expect(screen.getByTestId('git-submenu-delete')).toBeDisabled();
  });

  it('disables git-submenu-delete when isWorktree=true', () => {
    render(<BranchSubmenu {...makeProps({ isWorktree: true })} />);
    expect(screen.getByTestId('git-submenu-delete')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 7–15. Action callbacks
// ---------------------------------------------------------------------------

describe('BranchSubmenu — action callbacks', () => {
  it('clicking Checkout fires onCheckout("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-checkout'));
    expect(props.onCheckout).toHaveBeenCalledWith('feat/test');
  });

  it('clicking Pull fires onPull("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-pull'));
    expect(props.onPull).toHaveBeenCalledWith('feat/test');
  });

  it('clicking Push fires onPush("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-push'));
    expect(props.onPush).toHaveBeenCalledWith('feat/test');
  });

  it('clicking Merge fires onMerge("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-merge'));
    expect(props.onMerge).toHaveBeenCalledWith('feat/test');
  });

  it('clicking Rebase fires onRebase("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-rebase'));
    expect(props.onRebase).toHaveBeenCalledWith('feat/test');
  });

  it('clicking Rename fires onRename("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-rename'));
    expect(props.onRename).toHaveBeenCalledWith('feat/test');
  });

  it('clicking Delete fires onDelete("feat/test", false) for a local branch', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-delete'));
    expect(props.onDelete).toHaveBeenCalledWith('feat/test', false);
  });

  it('clicking "New Branch from" fires onNewBranchFrom("feat/test")', async () => {
    const props = makeProps();
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-new-branch-from'));
    expect(props.onNewBranchFrom).toHaveBeenCalledWith('feat/test');
  });
});

// ---------------------------------------------------------------------------
// 16. isWorktree + Delete Worktree
// ---------------------------------------------------------------------------

describe('BranchSubmenu — isWorktree=true shows Delete Worktree', () => {
  it('renders git-submenu-delete-worktree and fires onDeleteWorktree when clicked', async () => {
    const onDeleteWorktree = vi.fn();
    render(<BranchSubmenu {...makeProps({ isWorktree: true, onDeleteWorktree })} />);

    const btn = screen.getByTestId('git-submenu-delete-worktree');
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    expect(onDeleteWorktree).toHaveBeenCalledWith('feat/test');
  });
});

// ---------------------------------------------------------------------------
// 17. isWorktree + New Session
// ---------------------------------------------------------------------------

describe('BranchSubmenu — isWorktree=true + onNewSession fires callback', () => {
  it('renders git-submenu-new-session and fires onNewSession when clicked', async () => {
    const onNewSession = vi.fn();
    render(<BranchSubmenu {...makeProps({ isWorktree: true, onNewSession })} />);

    const btn = screen.getByTestId('git-submenu-new-session');
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    expect(onNewSession).toHaveBeenCalledWith('feat/test');
  });
});

// ---------------------------------------------------------------------------
// 18–19. isRemote=true — only remote-specific items
// ---------------------------------------------------------------------------

describe('BranchSubmenu — isRemote=true renders remote-specific items', () => {
  it('renders Checkout, New Branch from, Merge, Rebase, Delete Remote', () => {
    render(<BranchSubmenu {...makeProps({ isRemote: true })} />);
    expect(screen.getByTestId('git-submenu-checkout')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-new-branch-from')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-merge')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-rebase')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-delete')).toBeTruthy();
  });

  it('does NOT render Pull, Push, Rename for remote branches', () => {
    render(<BranchSubmenu {...makeProps({ isRemote: true })} />);
    expect(screen.queryByTestId('git-submenu-pull')).toBeNull();
    expect(screen.queryByTestId('git-submenu-push')).toBeNull();
    expect(screen.queryByTestId('git-submenu-rename')).toBeNull();
  });

  it('clicking Delete fires onDelete(branch, true) for a remote branch', async () => {
    const props = makeProps({ isRemote: true });
    render(<BranchSubmenu {...props} />);
    await userEvent.click(screen.getByTestId('git-submenu-delete'));
    expect(props.onDelete).toHaveBeenCalledWith('feat/test', true);
  });
});

// ---------------------------------------------------------------------------
// 20. busy=true disables all action buttons
// ---------------------------------------------------------------------------

describe('BranchSubmenu — busy=true disables all action buttons', () => {
  it('has all action buttons disabled when busy=true', () => {
    render(<BranchSubmenu {...makeProps({ busy: true })} />);

    // Checkout, Pull, Push, Merge, Rebase, Rename, Delete are all disabled
    expect(screen.getByTestId('git-submenu-checkout')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-pull')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-push')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-merge')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-rebase')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-rename')).toBeDisabled();
    expect(screen.getByTestId('git-submenu-delete')).toBeDisabled();
  });
});
