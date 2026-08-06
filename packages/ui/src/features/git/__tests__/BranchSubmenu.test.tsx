/**
 * BranchSubmenu.test.tsx — disabled states, action callbacks, testids, on the
 * native DropdownMenuSubContent build. Items are Radix menu items (divs with
 * aria-disabled), so disabled-ness is asserted via aria-disabled, and the
 * component renders inside a real DropdownMenu > Sub harness.
 *
 * Behaviors covered:
 *  1. Checkout is disabled when isCurrent=true or the branch is in a worktree.
 *  2. Merge and Rebase are disabled when isCurrent=true.
 *  3. Rename is disabled for a worktree branch.
 *  4. Delete is disabled when isCurrent=true or worktree.
 *  5. Clicking each action item fires its callback with the expected args — table-driven.
 *  6. worktree set: Delete Worktree fires onDeleteWorktree(worktreeDir, branch).
 *  7. worktree set + onNewSession: New Session fires onNewSession(worktreeDir, branch).
 *  8. isRemote=true: only remote-specific items are rendered.
 *  9. isRemote + Delete fires onDelete(branch, true).
 * 10. busy=true disables all action items.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The harness renders the menu structurally open (no trigger interaction), so
// Radix's modal body pointer-events:none is still in force; disable
// user-event's pointer-events assertion — the click path itself is Radix's.
const user = userEvent.setup({ pointerEventsCheck: 0 });
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
} from '@v2/components/ui/dropdown-menu';
import { BranchSubmenu, type BranchRowActions, type BranchSubmenuProps } from '../BranchSubmenu';

function makeActions(overrides: Partial<BranchRowActions> = {}): BranchRowActions {
  return {
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

function makeProps(overrides: Partial<BranchSubmenuProps> = {}): BranchSubmenuProps {
  return {
    branch: 'feat/test',
    isCurrent: false,
    isRemote: false,
    worktree: undefined,
    actions: makeActions(),
    ...overrides,
  };
}

/** SubContent needs the full menu context; both menu and sub render open. */
function renderSubmenu(props: BranchSubmenuProps) {
  return render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>feat/test</DropdownMenuSubTrigger>
          <BranchSubmenu {...props} />
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

const expectDisabled = (testId: string) => expect(screen.getByTestId(testId)).toHaveAttribute('aria-disabled', 'true');
const expectEnabled = (testId: string) => expect(screen.getByTestId(testId)).not.toHaveAttribute('aria-disabled');

describe('BranchSubmenu — Checkout disabled states', () => {
  it('disables git-submenu-checkout when isCurrent=true', () => {
    renderSubmenu(makeProps({ isCurrent: true }));
    expectDisabled('git-submenu-checkout');
  });

  it('disables git-submenu-checkout for a worktree branch', () => {
    renderSubmenu(makeProps({ worktree: 'wt-dir' }));
    expectDisabled('git-submenu-checkout');
  });

  it('enables git-submenu-checkout for a normal non-current branch', () => {
    renderSubmenu(makeProps());
    expectEnabled('git-submenu-checkout');
  });
});

describe('BranchSubmenu — Merge/Rebase disabled for current branch', () => {
  it('disables git-submenu-merge and git-submenu-rebase when isCurrent=true', () => {
    renderSubmenu(makeProps({ isCurrent: true }));
    expectDisabled('git-submenu-merge');
    expectDisabled('git-submenu-rebase');
  });
});

describe('BranchSubmenu — Rename disabled for worktree branch', () => {
  it('disables git-submenu-rename for a worktree branch', () => {
    renderSubmenu(makeProps({ worktree: 'wt-dir' }));
    expectDisabled('git-submenu-rename');
  });
});

describe('BranchSubmenu — Delete disabled states', () => {
  it('disables git-submenu-delete when isCurrent=true', () => {
    renderSubmenu(makeProps({ isCurrent: true }));
    expectDisabled('git-submenu-delete');
  });

  it('disables git-submenu-delete for a worktree branch', () => {
    renderSubmenu(makeProps({ worktree: 'wt-dir' }));
    expectDisabled('git-submenu-delete');
  });
});

describe('BranchSubmenu — action callbacks', () => {
  it.each([
    ['Checkout', 'git-submenu-checkout', 'onCheckout', ['feat/test']],
    ['Pull', 'git-submenu-pull', 'onPull', ['feat/test']],
    ['Push', 'git-submenu-push', 'onPush', ['feat/test']],
    ['Merge', 'git-submenu-merge', 'onMerge', ['feat/test']],
    ['Rebase', 'git-submenu-rebase', 'onRebase', ['feat/test']],
    ['Rename', 'git-submenu-rename', 'onRename', ['feat/test']],
    ['Delete', 'git-submenu-delete', 'onDelete', ['feat/test', false]],
    ['New Branch from', 'git-submenu-new-branch-from', 'onNewBranchFrom', ['feat/test']],
  ] as const)('clicking %s fires %s(%s)', async (_label, testId, callbackName, args) => {
    const actions = makeActions();
    renderSubmenu(makeProps({ actions }));
    await user.click(screen.getByTestId(testId));
    expect(actions[callbackName]).toHaveBeenCalledWith(...args);
  });
});

describe('BranchSubmenu — worktree branch shows Delete Worktree', () => {
  it('renders git-submenu-delete-worktree and fires onDeleteWorktree(worktreeDir, branch)', async () => {
    const onDeleteWorktree = vi.fn();
    renderSubmenu(makeProps({ worktree: 'wt-dir', actions: makeActions({ onDeleteWorktree }) }));

    const item = screen.getByTestId('git-submenu-delete-worktree');
    expect(item).toBeTruthy();
    await user.click(item);
    expect(onDeleteWorktree).toHaveBeenCalledWith('wt-dir', 'feat/test');
  });
});

describe('BranchSubmenu — worktree branch + onNewSession fires callback', () => {
  it('renders git-submenu-new-session and fires onNewSession(worktreeDir, branch)', async () => {
    const onNewSession = vi.fn();
    renderSubmenu(makeProps({ worktree: 'wt-dir', actions: makeActions({ onNewSession }) }));

    const item = screen.getByTestId('git-submenu-new-session');
    expect(item).toBeTruthy();
    await user.click(item);
    expect(onNewSession).toHaveBeenCalledWith('wt-dir', 'feat/test');
  });
});

describe('BranchSubmenu — isRemote=true renders remote-specific items', () => {
  it('renders Checkout, New Branch from, Merge, Rebase, Delete Remote', () => {
    renderSubmenu(makeProps({ isRemote: true }));
    expect(screen.getByTestId('git-submenu-checkout')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-new-branch-from')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-merge')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-rebase')).toBeTruthy();
    expect(screen.getByTestId('git-submenu-delete')).toBeTruthy();
  });

  it('does NOT render Pull, Push, Rename for remote branches', () => {
    renderSubmenu(makeProps({ isRemote: true }));
    expect(screen.queryByTestId('git-submenu-pull')).toBeNull();
    expect(screen.queryByTestId('git-submenu-push')).toBeNull();
    expect(screen.queryByTestId('git-submenu-rename')).toBeNull();
  });

  it('clicking Delete fires onDelete(branch, true) for a remote branch', async () => {
    const actions = makeActions();
    renderSubmenu(makeProps({ isRemote: true, actions }));
    await user.click(screen.getByTestId('git-submenu-delete'));
    expect(actions.onDelete).toHaveBeenCalledWith('feat/test', true);
  });
});

describe('BranchSubmenu — busy=true disables all action items', () => {
  it('has all action items disabled when busy=true', () => {
    renderSubmenu(makeProps({ actions: makeActions({ busy: true }) }));

    expectDisabled('git-submenu-checkout');
    expectDisabled('git-submenu-pull');
    expectDisabled('git-submenu-push');
    expectDisabled('git-submenu-merge');
    expectDisabled('git-submenu-rebase');
    expectDisabled('git-submenu-rename');
    expectDisabled('git-submenu-delete');
  });
});
