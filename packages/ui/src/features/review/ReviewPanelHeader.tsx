/**
 * ReviewPanelHeader — diff glyph + title + branch chip, then file/line totals
 * and a viewed counter. Mirrors the prototype ReviewModal header
 * (07-review.jsx 187-214). No inline/split diff-mode toggle (CmDiffEditor is
 * MergeView-only).
 */
import { Check, GitBranch, GitCompare, X } from 'lucide-react';

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
    <div className="flex h-[52px] shrink-0 items-center gap-3.5 border-b border-border bg-background px-[16px]">
      <button
        type="button"
        data-testid="review-close"
        onClick={onClose}
        className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Close review"
      >
        <X className="size-[15px]" />
      </button>

      <div className="flex items-center gap-2.5">
        <GitCompare className="size-[16px] text-primary" aria-hidden />
        <h2 className="text-heading font-bold tracking-tight text-foreground">Review Changes</h2>
      </div>

      {branch && (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-mf-chip px-2.5 py-1">
          <GitBranch className="size-[11px] text-mf-text-3" aria-hidden />
          <span className="font-mono text-caption text-muted-foreground">{branch}</span>
        </span>
      )}

      <div className="flex-1" />

      <span className="text-caption text-mf-text-3">
        {fileCount} {fileCount === 1 ? 'file' : 'files'} ·{' '}
        <span className="font-semibold text-mf-success">+{totalAdditions}</span>{' '}
        <span className="font-semibold text-mf-diff-del-text">−{totalDeletions}</span>
      </span>

      <span
        className={`inline-flex items-center gap-1.5 text-caption ${allViewed ? 'text-mf-success' : 'text-mf-text-3'}`}
      >
        {allViewed && <Check className="size-[12px]" strokeWidth={2.4} aria-hidden />}
        {viewedCount}/{fileCount} viewed
      </span>
    </div>
  );
}
