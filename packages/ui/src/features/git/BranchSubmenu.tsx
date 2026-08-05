/**
 * BranchSubmenu — the per-branch action flyout, as a native DropdownMenu
 * SubContent: checkout/pull/push/merge/rebase/new-branch-from/rename/delete,
 * plus worktree affordances. Must render inside a DropdownMenuSub (BranchRow
 * owns the Sub + SubTrigger).
 */
import { ArrowDown, ArrowUp, Check, GitBranch, Pencil, Plus, Trash2 } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSubContent } from '@v2/components/ui/dropdown-menu';

/** Branch-level actions drilled from BranchPopover down to every row's flyout. */
export interface BranchRowActions {
  onCheckout: (branch: string) => void;
  onPull: (branch: string) => void;
  onPush: (branch: string) => void;
  onMerge: (branch: string) => void;
  onRebase: (branch: string) => void;
  onRename: (branch: string) => void;
  onDelete: (branch: string, isRemote?: boolean) => void;
  onNewBranchFrom: (branch: string) => void;
  onNewSession?: (worktreeDirName: string, branchName: string | undefined) => void;
  onDeleteWorktree?: (worktreeDirName: string, branchName: string | undefined) => void;
  busy: boolean;
}

export interface BranchSubmenuProps {
  branch: string;
  isCurrent: boolean;
  isRemote?: boolean;
  /** The worktree directory this branch is checked out in, if any. */
  worktree?: string;
  actions: BranchRowActions;
}

interface MenuItemDef {
  label: string;
  icon: React.ReactNode;
  testid: string;
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

type MenuEntry = MenuItemDef | { separator: true };

function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function buildItems({ branch, isCurrent, isRemote, worktree, actions }: BranchSubmenuProps): MenuEntry[] {
  const { onCheckout, onPull, onPush, onMerge, onRebase, onRename, onDelete, onNewBranchFrom, busy } = actions;
  const label = truncateLabel(branch, 20);
  const isWorktree = worktree != null;

  if (isRemote) {
    return [
      {
        label: 'Checkout',
        icon: <Check />,
        testid: 'git-submenu-checkout',
        action: () => onCheckout(branch),
        disabled: busy,
      },
      {
        label: `New Branch from '${label}'...`,
        icon: <GitBranch />,
        testid: 'git-submenu-new-branch-from',
        action: () => onNewBranchFrom(branch),
      },
      { separator: true },
      {
        label: 'Merge into Current Branch',
        icon: <ArrowDown />,
        testid: 'git-submenu-merge',
        action: () => onMerge(branch),
        disabled: busy,
      },
      {
        label: 'Rebase Current onto This',
        icon: <ArrowUp />,
        testid: 'git-submenu-rebase',
        action: () => onRebase(branch),
        disabled: busy,
      },
      { separator: true },
      {
        label: 'Delete Remote Branch',
        icon: <Trash2 />,
        testid: 'git-submenu-delete',
        action: () => onDelete(branch, true),
        disabled: busy,
        destructive: true,
      },
    ];
  }

  const items: MenuEntry[] = [
    {
      label: `New Branch from '${label}'...`,
      icon: <GitBranch />,
      testid: 'git-submenu-new-branch-from',
      action: () => onNewBranchFrom(branch),
    },
    { separator: true },
    {
      label: 'Checkout',
      icon: <Check />,
      testid: 'git-submenu-checkout',
      action: () => onCheckout(branch),
      disabled: isCurrent || isWorktree || busy,
    },
    {
      label: 'Pull',
      icon: <ArrowDown />,
      testid: 'git-submenu-pull',
      action: () => onPull(branch),
      disabled: isWorktree || busy,
    },
    { label: 'Push', icon: <ArrowUp />, testid: 'git-submenu-push', action: () => onPush(branch), disabled: busy },
    { separator: true },
    {
      label: 'Merge into Current Branch',
      icon: <ArrowDown />,
      testid: 'git-submenu-merge',
      action: () => onMerge(branch),
      disabled: isCurrent || busy,
    },
    {
      label: 'Rebase Current onto This',
      icon: <ArrowUp />,
      testid: 'git-submenu-rebase',
      action: () => onRebase(branch),
      disabled: isCurrent || busy,
    },
    { separator: true },
    {
      label: 'Rename...',
      icon: <Pencil />,
      testid: 'git-submenu-rename',
      action: () => onRename(branch),
      disabled: isWorktree || busy,
    },
    {
      label: 'Delete Branch',
      icon: <Trash2 />,
      testid: 'git-submenu-delete',
      action: () => onDelete(branch, false),
      disabled: isCurrent || isWorktree || busy,
      destructive: true,
    },
  ];

  if (isWorktree) {
    items.push({ separator: true });
    if (actions.onNewSession) {
      items.push({
        label: 'New Session on Worktree',
        icon: <Plus />,
        testid: 'git-submenu-new-session',
        action: () => actions.onNewSession!(worktree, branch),
      });
    }
    if (actions.onDeleteWorktree) {
      items.push({
        label: 'Delete Worktree',
        icon: <Trash2 />,
        testid: 'git-submenu-delete-worktree',
        action: () => actions.onDeleteWorktree!(worktree, branch),
        destructive: true,
      });
    }
  }

  return items;
}

export function BranchSubmenu(props: BranchSubmenuProps) {
  const items = buildItems(props);

  return (
    <DropdownMenuSubContent data-testid="git-submenu" className="min-w-[220px]">
      {items.map((item, idx) => {
        if ('separator' in item) return <DropdownMenuSeparator key={`sep-${idx}`} />;
        return (
          <DropdownMenuItem
            key={item.testid}
            data-testid={item.testid}
            variant={item.destructive ? 'destructive' : 'default'}
            disabled={item.disabled}
            onSelect={item.action}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuSubContent>
  );
}
