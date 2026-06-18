/**
 * BranchSubmenu — per-branch flyout with checkout/pull/push/merge/rebase/
 * new-branch-from/rename/delete actions, plus optional worktree affordances.
 * Renders as a self-contained menu panel (positioned by the parent popover).
 */
import {
  ArrowLeft,
  Check,
  Download,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { MenuDivider, MenuRow } from '@/components/ui/menu';

export interface BranchSubmenuProps {
  branch: string;
  isCurrent: boolean;
  isRemote?: boolean;
  isWorktree?: boolean;
  onClose: () => void;
  onCheckout: (branch: string) => void;
  onPull: (branch: string) => void;
  onPush: (branch: string) => void;
  onMerge: (branch: string) => void;
  onRebase: (branch: string) => void;
  onRename: (branch: string) => void;
  onDelete: (branch: string, isRemote?: boolean) => void;
  onNewBranchFrom: (branch: string) => void;
  onNewSession?: (branch: string) => void;
  onDeleteWorktree?: (branch: string) => void;
  busy: boolean;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  testid: string;
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface SeparatorEntry {
  separator: true;
}

type MenuEntry = MenuItem | SeparatorEntry;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function buildItems(props: BranchSubmenuProps): MenuEntry[] {
  const {
    branch,
    isCurrent,
    isRemote,
    isWorktree,
    onCheckout,
    onPull,
    onPush,
    onMerge,
    onRebase,
    onRename,
    onDelete,
    onNewBranchFrom,
    onNewSession,
    onDeleteWorktree,
    busy,
  } = props;
  const label = truncate(branch, 20);

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
        icon: <Plus />,
        testid: 'git-submenu-new-branch-from',
        action: () => onNewBranchFrom(branch),
      },
      { separator: true },
      {
        label: 'Merge into Current Branch',
        icon: <GitMerge />,
        testid: 'git-submenu-merge',
        action: () => onMerge(branch),
        disabled: busy,
      },
      {
        label: 'Rebase Current onto This',
        icon: <GitPullRequest />,
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
      icon: <Plus />,
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
      icon: <Download />,
      testid: 'git-submenu-pull',
      action: () => onPull(branch),
      disabled: isWorktree || busy,
    },
    {
      label: 'Push',
      icon: <Upload />,
      testid: 'git-submenu-push',
      action: () => onPush(branch),
      disabled: busy,
    },
    { separator: true },
    {
      label: 'Merge into Current Branch',
      icon: <GitMerge />,
      testid: 'git-submenu-merge',
      action: () => onMerge(branch),
      disabled: isCurrent || busy,
    },
    {
      label: 'Rebase Current onto This',
      icon: <GitPullRequest />,
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
    if (onNewSession) {
      items.push({
        label: 'New Session on Worktree',
        icon: <Plus />,
        testid: 'git-submenu-new-session',
        action: () => onNewSession(branch),
      });
    }
    if (onDeleteWorktree) {
      items.push({
        label: 'Delete Worktree',
        icon: <Trash2 />,
        testid: 'git-submenu-delete-worktree',
        action: () => onDeleteWorktree(branch),
        destructive: true,
      });
    }
  }

  return items;
}

export function BranchSubmenu(props: BranchSubmenuProps) {
  const { branch, busy } = props;
  const items = buildItems(props);

  return (
    <div data-testid="git-submenu" className="min-w-[220px]">
      <div className="px-1.5 py-1.5 border-b border-border flex items-center gap-1.5">
        <button
          data-testid="git-submenu-back"
          type="button"
          onClick={props.onClose}
          aria-label="Back to branch list"
          className="flex-shrink-0 inline-flex items-center justify-center w-[22px] h-[22px] rounded hover:bg-accent text-muted-foreground transition-colors"
        >
          <ArrowLeft size={12} />
        </button>
        {props.isRemote ? (
          <Globe size={12} className="text-muted-foreground shrink-0" />
        ) : (
          <GitBranch size={12} className="text-muted-foreground shrink-0" />
        )}
        <span className="flex-1 truncate font-mono text-label font-semibold text-foreground">{branch}</span>
        {busy && <Loader2 size={11} className="animate-spin text-muted-foreground shrink-0" />}
      </div>
      <div className="py-1">
        {items.map((item, idx) => {
          if ('separator' in item && item.separator) {
            return <MenuDivider key={`sep-${idx}`} />;
          }
          const mi = item as MenuItem;
          return (
            <MenuRow
              key={mi.testid}
              data-testid={mi.testid}
              icon={mi.icon}
              label={mi.label}
              danger={mi.destructive}
              disabled={mi.disabled}
              onClick={mi.action}
            />
          );
        })}
      </div>
    </div>
  );
}
