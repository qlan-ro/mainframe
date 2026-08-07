/**
 * ReviewPanelHeader — diff glyph + title + scope switcher + branch chip, then
 * file/line totals and a viewed counter. Mirrors the prototype ReviewModal
 * header (07-review.jsx 187-214). No inline/split diff-mode toggle (CmDiffEditor
 * is MergeView-only).
 *
 * One chip slot carries branch identity: the plain branch on the scopes that
 * describe one branch's working tree, and the comparison on `branch` — where a
 * badge repeating the branch beside "feat/x ↔ main" would say it twice.
 */
import { Check, GitBranch, GitCompare, X } from 'lucide-react';
import { Badge } from '@v2/components/ui/badge';
import { Button } from '@v2/components/ui/button';
import type { ChangeScope } from './use-working-changes';
import { scopeHeaderView } from './review-scope-view';
import { ReviewScopeSwitcher } from './ReviewScopeSwitcher';

interface ReviewPanelHeaderProps {
  scope: ChangeScope;
  onScopeChange: (scope: ChangeScope) => void;
  branch: string | null;
  baseBranch: string | null;
  mergeBase: string | null;
  fileCount: number;
  /** Undefined on the scopes the daemon reports no stat for — see review-scope-view. */
  totalAdditions?: number;
  totalDeletions?: number;
  viewedCount: number;
  onClose: () => void;
}

export function ReviewPanelHeader({
  scope,
  onScopeChange,
  branch,
  baseBranch,
  mergeBase,
  fileCount,
  totalAdditions,
  totalDeletions,
  viewedCount,
  onClose,
}: ReviewPanelHeaderProps) {
  const allViewed = fileCount > 0 && viewedCount === fileCount;
  const { showTotals, compareLine } = scopeHeaderView(scope, { branch, baseBranch, mergeBase });

  return (
    // Close sits at the far RIGHT — every dialog closes on the right (stock
    // shadcn position); the old left-side X predates the port.
    <div className="flex h-[52px] shrink-0 items-center gap-3.5 border-b bg-background px-4">
      <div className="flex items-center gap-2.5">
        <GitCompare className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">Review Changes</h2>
      </div>

      <ReviewScopeSwitcher scope={scope} onScopeChange={onScopeChange} />

      {compareLine ? (
        <Badge
          data-testid="review-scope-compare-line"
          variant="secondary"
          className="min-w-0 gap-1.5 text-xs font-normal text-muted-foreground"
        >
          <GitBranch aria-hidden />
          <span className="truncate">{compareLine}</span>
        </Badge>
      ) : (
        branch && (
          // Branch names are UI sans, never mono (2026-08-05) — the identifier
          // signal is the glyph and the chip, not the typeface.
          <Badge
            data-testid="review-branch-badge"
            variant="secondary"
            className="gap-1.5 text-xs font-normal text-muted-foreground"
          >
            <GitBranch aria-hidden />
            {branch}
          </Badge>
        )
      )}

      <div className="flex-1" />

      <span data-testid="review-file-counts" className="whitespace-nowrap text-xs text-muted-foreground">
        {fileCount} {fileCount === 1 ? 'file' : 'files'}
        {showTotals && (
          <>
            {' · '}
            <span className="font-semibold text-mf-diff-add-text">+{totalAdditions ?? 0}</span>{' '}
            <span className="font-semibold text-mf-diff-del-text">−{totalDeletions ?? 0}</span>
          </>
        )}
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
