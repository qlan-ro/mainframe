/**
 * ReviewCommitRail — 280px right column: commit-message composer + commit action.
 * Mirrors the prototype ReviewModal commit rail (07-review.jsx 279-327):
 * title · textarea · suggestion chips · unviewed warning · Commit · Cancel,
 * plus a committed success state.
 *
 * Presentational: message + committed state live in ReviewPanel; this calls
 * onMessageChange / onCommit / onCancel.
 */
import { Check, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const SUGGESTIONS = ['feat: ', 'fix: ', 'refactor: ', 'chore: ', 'docs: '];

interface ReviewCommitRailProps {
  fileCount: number;
  totalLines: number;
  unviewedCount: number;
  message: string;
  onMessageChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  committing: boolean;
  committed: boolean;
  error: string | null;
}

export function ReviewCommitRail({
  fileCount,
  totalLines,
  unviewedCount,
  message,
  onMessageChange,
  onCommit,
  onCancel,
  committing,
  committed,
  error,
}: ReviewCommitRailProps) {
  const canCommit = message.trim().length > 0 && !committing && fileCount > 0;

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-l bg-card p-4">
      <div className="mb-3 text-sm font-semibold text-foreground">Commit</div>

      {committed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-success/10">
            <Check size={22} strokeWidth={2.4} className="text-success" aria-hidden />
          </span>
          <div className="text-sm font-semibold text-foreground">Changes committed</div>
          <div className="font-mono text-xs text-muted-foreground">
            {fileCount} {fileCount === 1 ? 'file' : 'files'} · {totalLines} lines
          </div>
          <Button size="sm" className="mt-1.5" data-testid="review-commit-done" onClick={onCancel}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <Textarea
            data-testid="review-commit-input"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder="Summary of changes…"
            spellCheck={false}
            className="mb-2 h-[76px] resize-none text-xs leading-snug"
          />

          <div className="mb-3.5 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                data-testid={`review-commit-suggestion-${s.trim().replace(/[^a-z]/gi, '')}`}
                onClick={() => onMessageChange(s)}
                className="h-6 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:border-primary"
              >
                {s.trim()}
              </Button>
            ))}
          </div>

          {unviewedCount > 0 && (
            <Alert
              data-testid="review-commit-unviewed-warning"
              className="mb-3 border-warning/30 bg-warning/10 px-2.5 py-2"
            >
              <TriangleAlert className="text-warning" aria-hidden />
              <AlertDescription className="text-xs leading-snug text-foreground">
                {unviewedCount} {unviewedCount === 1 ? 'file' : 'files'} not yet reviewed.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <div data-testid="review-commit-error" className="mb-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex-1" />

          <Button className="mb-2" data-testid="review-commit-submit" disabled={!canCommit} onClick={onCommit}>
            <Check strokeWidth={2.4} aria-hidden />
            {committing ? 'Committing…' : `Commit ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
          </Button>
          <Button size="sm" variant="outline" data-testid="review-commit-cancel" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
