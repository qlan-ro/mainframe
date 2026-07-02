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
    <div className="flex w-[280px] shrink-0 flex-col border-l border-border bg-mf-content2 p-[16px]">
      <div className="mb-[12px] text-body font-bold tracking-tight text-foreground">Commit</div>

      {committed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px] text-center">
          <span className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-full bg-mf-success/10">
            <Check size={22} strokeWidth={2.4} className="text-mf-success" aria-hidden />
          </span>
          <div className="text-body font-semibold text-foreground">Changes committed</div>
          <div className="font-mono text-caption text-mf-text-3">
            {fileCount} {fileCount === 1 ? 'file' : 'files'} · {totalLines} lines
          </div>
          <button
            type="button"
            data-testid="review-commit-done"
            onClick={onCancel}
            className="mt-1.5 inline-flex h-[30px] items-center rounded-md bg-primary px-[14px] text-label font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <textarea
            data-testid="review-commit-input"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder="Summary of changes…"
            spellCheck={false}
            className="mb-[8px] h-[76px] resize-none rounded-md border border-border bg-background px-[11px] py-[9px] text-label leading-snug text-foreground outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />

          <div className="mb-[14px] flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`review-commit-suggestion-${s.trim().replace(/[^a-z]/gi, '')}`}
                onClick={() => onMessageChange(s)}
                className="rounded-[13px] border border-border bg-background px-[9px] py-[4px] text-micro text-muted-foreground transition-colors hover:border-primary"
              >
                {s.trim()}
              </button>
            ))}
          </div>

          {unviewedCount > 0 && (
            <div
              data-testid="review-commit-unviewed-warning"
              className="mb-[12px] flex items-start gap-[8px] rounded-md border border-mf-warning/30 bg-mf-warning/10 px-[10px] py-[9px]"
            >
              <TriangleAlert size={13} className="mt-px shrink-0 text-mf-warning" aria-hidden />
              <span className="text-caption leading-snug text-mf-warning">
                {unviewedCount} {unviewedCount === 1 ? 'file' : 'files'} not yet reviewed.
              </span>
            </div>
          )}

          {error && (
            <div data-testid="review-commit-error" className="mb-[12px] text-caption text-destructive">
              {error}
            </div>
          )}

          <div className="flex-1" />

          <button
            type="button"
            data-testid="review-commit-submit"
            disabled={!canCommit}
            onClick={onCommit}
            className={`mb-[8px] inline-flex h-[36px] items-center justify-center gap-1.5 rounded-md text-body font-bold tracking-tight transition-opacity ${
              canCommit
                ? 'bg-primary text-primary-foreground shadow-[0_1px_3px_color-mix(in_oklab,var(--primary)_40%,transparent)] hover:opacity-90'
                : 'cursor-not-allowed bg-mf-chip text-mf-text-3'
            }`}
          >
            <Check size={14} strokeWidth={2.4} aria-hidden />
            {committing ? 'Committing…' : `Commit ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
          </button>
          <button
            type="button"
            data-testid="review-commit-cancel"
            onClick={onCancel}
            className="inline-flex h-[30px] items-center justify-center rounded-md border border-border bg-transparent text-label font-semibold text-muted-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
