/**
 * ReviewPanelHeader — worktree path label + close button.
 * No inline/split diff-mode toggle (CmDiffEditor is MergeView-only).
 */
import { XIcon } from 'lucide-react';

interface ReviewPanelHeaderProps {
  worktreePath?: string;
  onClose: () => void;
}

export function ReviewPanelHeader({ worktreePath, onClose }: ReviewPanelHeaderProps) {
  const label = worktreePath ? (worktreePath.split('/').pop() ?? worktreePath) : 'Working tree';

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-body font-semibold">Review changes</h2>
        <span className="text-caption text-muted-foreground truncate max-w-xs">{label}</span>
      </div>
      <button
        type="button"
        data-testid="review-close"
        onClick={onClose}
        className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Close review"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
