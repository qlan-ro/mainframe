/**
 * SubmitReviewBar — the code/diff editor's "N agent notes / Submit review" bar.
 *
 * Extracted verbatim from use-comment-gutter.tsx so the hook stays under the
 * file-size limit; markup and testids are unchanged (CmEditorWithComments.test.tsx
 * and CmDiffEditorWithComments.test.tsx keep passing with no edits).
 */
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface SubmitReviewBarProps {
  count: number;
  filledCount: number;
  onSubmit: () => void;
}

export function SubmitReviewBar({ count, filledCount, onSubmit }: SubmitReviewBarProps) {
  return (
    <div
      data-testid="editor-submit-review"
      className="flex h-7.5 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
    >
      <MessageSquare className="size-3 shrink-0 text-primary" aria-hidden />
      <span className="text-xs text-muted-foreground">
        {count} agent {count === 1 ? 'note' : 'notes'}
      </span>
      <div className="flex-1" />
      <Button
        data-testid="editor-submit-review-btn"
        variant="secondary"
        size="xs"
        onClick={onSubmit}
        disabled={filledCount === 0}
      >
        Submit review ({count})
      </Button>
    </div>
  );
}
