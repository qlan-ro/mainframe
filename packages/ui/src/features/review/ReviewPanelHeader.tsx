/**
 * ReviewPanelHeader — diff glyph + title + branch chip, then file/line totals
 * and a viewed counter. Mirrors the prototype ReviewModal header
 * (07-review.jsx 187-214). No inline/split diff-mode toggle (CmDiffEditor is
 * MergeView-only).
 */
import { Check, GitBranch, GitCompare, X } from 'lucide-react';
import { Badge } from '@v2/components/ui/badge';
import { Button } from '@v2/components/ui/button';

interface ReviewPanelHeaderProps {
  branch: string | null;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  viewedCount: number;
  onClose: () => void;
}

export function ReviewPanelHeader({
  branch,
  fileCount,
  totalAdditions,
  totalDeletions,
  viewedCount,
  onClose,
}: ReviewPanelHeaderProps) {
  const allViewed = fileCount > 0 && viewedCount === fileCount;

  return (
    // Close sits at the far RIGHT — every dialog closes on the right (stock
    // shadcn position); the old left-side X predates the port.
    <div className="flex h-[52px] shrink-0 items-center gap-3.5 border-b bg-background px-4">
      <div className="flex items-center gap-2.5">
        <GitCompare className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">Review Changes</h2>
      </div>

      {branch && (
        <Badge
          data-testid="review-branch-badge"
          variant="secondary"
          className="gap-1.5 font-mono text-xs font-normal text-muted-foreground"
        >
          <GitBranch aria-hidden />
          {branch}
        </Badge>
      )}

      <div className="flex-1" />

      <span data-testid="review-file-counts" className="text-xs text-muted-foreground">
        {fileCount} {fileCount === 1 ? 'file' : 'files'} ·{' '}
        <span className="font-semibold text-mf-diff-add-text">+{totalAdditions}</span>{' '}
        <span className="font-semibold text-mf-diff-del-text">−{totalDeletions}</span>
      </span>

      <span
        data-testid="review-viewed-counter"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        {allViewed && <Check className="size-3 text-success" strokeWidth={2.4} aria-hidden />}
        {viewedCount}/{fileCount} viewed
      </span>

      <Button variant="ghost" size="icon-sm" data-testid="review-close" onClick={onClose} aria-label="Close review">
        <X />
      </Button>
    </div>
  );
}
