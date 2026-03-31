import React from 'react';
import { Download, Upload, GitMerge, GitPullRequest, Pencil, Trash2, Plus, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

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
  busy: boolean;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separator?: false;
}

interface SeparatorItem {
  separator: true;
}

type MenuEntry = MenuItem | SeparatorItem;

export function BranchSubmenu({
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
  busy,
}: BranchSubmenuProps): React.ReactElement {
  const items: MenuEntry[] = isRemote
    ? [
        {
          label: 'Checkout',
          icon: <Check size={12} />,
          action: () => onCheckout(branch),
          disabled: busy,
        },
        {
          label: `New Branch from '${truncate(branch, 20)}'...`,
          icon: <Plus size={12} />,
          action: () => onNewBranchFrom(branch),
        },
        { separator: true },
        {
          label: 'Merge into Current Branch',
          icon: <GitMerge size={12} />,
          action: () => onMerge(branch),
          disabled: busy,
        },
        {
          label: 'Rebase Current onto This',
          icon: <GitPullRequest size={12} />,
          action: () => onRebase(branch),
          disabled: busy,
        },
        { separator: true },
        {
          label: 'Delete Remote Branch',
          icon: <Trash2 size={12} />,
          action: () => onDelete(branch, true),
          disabled: busy,
          destructive: true,
        },
      ]
    : [
        {
          label: `New Branch from '${truncate(branch, 20)}'...`,
          icon: <Plus size={12} />,
          action: () => onNewBranchFrom(branch),
        },
        { separator: true },
        {
          label: 'Checkout',
          icon: <Check size={12} />,
          action: () => onCheckout(branch),
          disabled: isCurrent || isWorktree || busy,
        },
        {
          label: 'Pull',
          icon: <Download size={12} />,
          action: () => onPull(branch),
          disabled: isWorktree || busy,
        },
        {
          label: 'Push',
          icon: <Upload size={12} />,
          action: () => onPush(branch),
          disabled: busy,
        },
        { separator: true },
        {
          label: 'Merge into Current Branch',
          icon: <GitMerge size={12} />,
          action: () => onMerge(branch),
          disabled: isCurrent || busy,
        },
        {
          label: 'Rebase Current onto This',
          icon: <GitPullRequest size={12} />,
          action: () => onRebase(branch),
          disabled: isCurrent || busy,
        },
        { separator: true },
        {
          label: 'Rename...',
          icon: <Pencil size={12} />,
          action: () => onRename(branch),
          disabled: isWorktree || busy,
        },
        {
          label: 'Delete Branch',
          icon: <Trash2 size={12} />,
          action: () => onDelete(branch, false),
          disabled: isCurrent || isWorktree || busy,
          destructive: true,
        },
      ];

  return (
    <div className="min-w-[220px]">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-mf-border">
        <span className="text-sm font-medium text-mf-text-primary truncate">{branch}</span>
      </div>

      {/* Menu items */}
      <div className="py-1">
        {items.map((item, idx) => {
          if (item.separator) {
            return <div key={`sep-${idx}`} className="border-t border-mf-border my-1" />;
          }
          return (
            <button
              key={item.label}
              onClick={item.action}
              disabled={item.disabled}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                'hover:bg-mf-hover rounded-sm transition-colors',
                item.disabled && 'opacity-40 cursor-not-allowed',
                item.destructive && !item.disabled && 'text-mf-destructive',
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
